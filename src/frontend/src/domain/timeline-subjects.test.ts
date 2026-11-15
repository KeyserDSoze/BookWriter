import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { mergeKnowledgeReply, parseKnowledge } from "./knowledge";
import { deleteEntity, editTimeline, restoreBefore, type EditContext } from "./book-editing";
import { timelineOrders } from "./knowledge-index";
import { aiEditCalls, applyAiEditChange } from "./ai-edit";
import { projectBook } from "./narrarium";
import { readNarrarium } from "./narrarium-reader";

const ctx: EditContext = { now: "2026-11-14T10:00:00.000Z", origin: "manual" };
const id = "timeline:indagine-sulle-sparizioni";

describe("Timeline che seguono schede, una sola globale", () => {
  it("una timeline segue schede e ne mostra anche gli eventi; schede inesistenti rifiutate; eliminare la scheda la toglie", () => {
    const book = knowledgeBook();
    editTimeline(book, id, { subjectIds: ["character:markus"] }, ctx);
    expect(book.knowledge!.timelines[0]!.subjectIds).toEqual(["character:markus"]);
    // «Incontro con l'informatore» involves Markus but is not tagged with the timeline.
    expect(timelineOrders(book, book.knowledge!, id).story.map(e => e.title)).toContain("Incontro con l'informatore");
    expect(() => editTimeline(book, id, { subjectIds: ["character:nessuno"] }, ctx)).toThrow(/inesistente/);
    expect(() => parseKnowledge({ ...book.knowledge!, timelines: [{ ...book.knowledge!.timelines[0]!, subjectIds: ["character:nessuno"] }] })).toThrow();
    deleteEntity(book, "character:markus", ctx);
    expect(book.knowledge!.timelines[0]!.subjectIds).toBeUndefined();
  });
  it("ripristinare la versione precedente toglie anche le schede seguite aggiunte dopo", () => {
    const book = knowledgeBook();
    const edit = editTimeline(book, id, { subjectIds: ["character:elena"] }, ctx);
    restoreBefore(book, edit.id, ctx);
    expect(book.knowledge!.timelines[0]!.subjectIds).toBeUndefined();
  });
  it("una sola timeline globale: l'autore cambia prima quella esistente, l'AI ne crea una seconda come arco", () => {
    const book = knowledgeBook();
    editTimeline(book, undefined, { title: "Cronologia", kind: "global", summary: "" }, ctx);
    expect(() => editTimeline(book, id, { kind: "global" }, ctx)).toThrow(/globale «Cronologia»/);
    const merged = mergeKnowledgeReply(book.knowledge!, { timelines: [{ title: "Altra globale", kind: "global", subjects: ["Elena"] }] },
      { origin: "written", reason: "r", now: ctx.now });
    expect(merged.timelines.find(t => t.title === "Altra globale")).toMatchObject({ kind: "arc", subjectIds: ["character:elena"] });
    expect(() => mergeKnowledgeReply(book.knowledge!, { timelines: [{ title: "Linea X", subjects: ["Nessuno"] }] },
      { origin: "written", reason: "r", now: ctx.now })).toThrow(/Nessuno/);
  });
  it("le schede seguite passano dal Markdown e tornano uguali; un capitolo previsto tolto non ricompare", () => {
    const book = knowledgeBook();
    editTimeline(book, id, { subjectIds: ["character:elena", "faction:consiglio-cittadino"] }, ctx);
    const first = projectBook(book, []).files;
    const markdown = Object.fromEntries(Object.entries(first).filter(([path]) => path.endsWith(".md")));
    const imported = readNarrarium(markdown, crypto.randomUUID(), book.updatedAt);
    expect(imported.knowledge!.timelines.find(t => t.id === id)!.subjectIds).toEqual(["character:elena", "faction:consiglio-cittadino"]);
    // Removing the subjects (and the event's planned chapter) must not resurrect them from the previous files.
    imported.markdownSource = { ...imported.markdownSource, ...markdown };
    editTimeline(imported, id, { subjectIds: [] }, ctx);
    const again = readNarrarium(Object.fromEntries(Object.entries(projectBook(imported, []).files).filter(([path]) => path.endsWith(".md"))), crypto.randomUUID(), book.updatedAt);
    expect(again.knowledge!.timelines.find(t => t.id === id)!.subjectIds).toBeUndefined();
  });
  it("«Modifica solo questo» su una timeline: i nomi diventano schede, i nomi sconosciuti rifiutano la proposta", () => {
    const book = knowledgeBook();
    const [call] = aiEditCalls(book, { kind: "timeline", id }, "Fai seguire a questa timeline anche Markus.");
    expect(call!.prompt).toContain("TIMELINE ATTUALE");
    const parsed = call!.parse(JSON.stringify({ title: "Indagine sulle sparizioni", kind: "arc", summary: "L'indagine di Elena.", subjects: ["Elena", "Markus"] }), book)!;
    expect(parsed.after).toContain("Segue: Elena, Markus");
    const edit = applyAiEditChange(book, { key: call!.key, target: call!.target, label: call!.label, baseStamp: "", before: parsed.before, after: parsed.after,
      patch: parsed.patch, status: "proposed" }, { ...ctx, origin: "ai" });
    expect(edit).toMatchObject({ origin: "ai", target: { kind: "timeline", id } });
    expect(book.knowledge!.timelines[0]!.subjectIds).toEqual(["character:elena", "character:markus"]);
    expect(() => call!.parse(JSON.stringify({ title: "Indagine sulle sparizioni", subjects: ["Ignoto"] }), book)).toThrow(/non è fra le schede/);
  });
});
