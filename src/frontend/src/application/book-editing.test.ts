import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeBook } from "../domain/__fixtures__/knowledge";
import { DEFAULT_SETTINGS, type BookProject } from "../domain/types";
import { elementReviewState } from "../domain/book-edits";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { AutopilotRunner } from "./autopilot";
import { editBase, ElementChangedError, restoreEdit, saveSceneEdit, saveStructureEdit, skipElementReview } from "./book-editing";
import { cancelManualReview, decideReviewProposal, requestManualReview } from "./manual-review";
import { acceptAiEditChange, proposeAiEdit } from "./ai-edit";

const answer = (text: string) => ({ text, endpointId: "openai", modelId: "synthetic", inputTokens: 80, outputTokens: 20 });
const pass = JSON.stringify({ verdict: "pass", summary: "Coerente con schede e scene vicine.", findings: [] });
const calls: Array<{ kind: string; system: string; prompt: string }> = [];
function script(handler: (kind: string, prompt: string, system: string) => string) {
  modelCall.mockImplementation(async (kind: string, system: string, prompt: string) => {
    calls.push({ kind, system, prompt });
    return answer(handler(kind, prompt, system));
  });
}
const stored = async (id: string): Promise<BookProject> => (await getBook(id))!;
const sceneTarget = { kind: "scene" as const, id: "scene:002:001" };
async function editedBook(): Promise<BookProject> {
  const book = knowledgeBook();
  await saveBook(book, false);
  await saveSceneEdit(book.id, "scene:002:001", editBase(book, sceneTarget, "Il molo"), { text: "Markus aspetta sul molo al tramonto. Dice di conoscere il Consiglio cittadino." });
  return stored(book.id);
}

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset(); writerGuard.mockReset(); calls.length = 0;
  writerGuard.mockImplementation(async (_b, _r, _c, callback) => callback({ assertActive: async () => {}, failure: () => undefined }));
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, action: (lock: object) => Promise<void>) => action({}) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Modifiche dell'autore salvate in sicurezza", () => {
  it("si salvano anche con l'autopilot in esecuzione, senza review e con una voce nelle Attività", async () => {
    const book = knowledgeBook(); book.status = "running"; await saveBook(book, false);
    const { edit } = await saveSceneEdit(book.id, "scene:001:001", editBase(book, { kind: "scene", id: "scene:001:001" }, "Il ricordo"), { title: "La notte" });
    const saved = await stored(book.id);
    expect(saved.chapters[0]!.scenes[0]!.title).toBe("La notte");
    expect(saved.status).toBe("running");
    expect(edit.reviewState).toBe("modified_unreviewed");
    const audit = (await listActivities(book.id))[0]!;
    expect(audit).toMatchObject({ title: "Modifica manuale: Cap. 1 · 1. La notte", aiRequested: false, status: "succeeded" });
    expect(audit.nextStep).toMatch(/Nessuna review avviata/);
  });
  it("rifiuta di sovrascrivere un elemento cambiato dopo l'apertura dell'editor, ma salva se il resto del libro è cambiato", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    const base = editBase(book, sceneTarget, "Il molo");
    const other = await stored(book.id);
    other.chapters[0]!.title = "Cambiato dall'autopilot"; await saveBook(other, false);
    await saveSceneEdit(book.id, sceneTarget.id, base, { title: "Il molo di sera" });
    const changed = await stored(book.id);
    changed.chapters[1]!.scenes[0]!.text += " Piove."; await saveBook(changed, false);
    await expect(saveSceneEdit(book.id, sceneTarget.id, base, { title: "Altro" })).rejects.toBeInstanceOf(ElementChangedError);
    expect((await stored(book.id)).chapters[1]!.scenes[0]!.title).toBe("Il molo di sera");
  });
  it("struttura, ripristino e review saltata sono registrati e reversibili", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    const { edit } = await saveStructureEdit(book.id, editBase(book, { kind: "structure", id: "book" }, "Struttura"), { op: "deleteScene", sceneId: "scene:001:002" });
    expect((await stored(book.id)).chapters[0]!.scenes).toHaveLength(1);
    await restoreEdit(book.id, edit.id);
    expect((await stored(book.id)).chapters[0]!.scenes.map(s => s.id)).toEqual(["scene:001:001", "scene:001:002"]);
    await skipElementReview(book.id, [{ kind: "structure", id: "book" }]);
    expect(elementReviewState(await stored(book.id), { kind: "structure", id: "book" })).toBe("review_skipped");
  });
});

describe("Review eseguita dall'autopilot su richiesta", () => {
  it("con il libro in pausa esegue solo la review e lo rimette in pausa", async () => {
    const book = await editedBook();
    const { review } = await requestManualReview(book.id, { scope: "targeted", mode: "check", targets: [sceneTarget] });
    expect(review.pauseAfter).toBe(true);
    script(kind => { expect(kind).toBe("chapterAudit"); return pass; });
    await new AutopilotRunner().run(book.id, async () => undefined);
    const saved = await stored(book.id);
    expect(calls).toHaveLength(1);
    expect(saved.status).toBe("paused");
    expect(saved.phase).toBe("prose");
    expect(elementReviewState(saved, sceneTarget)).toBe("review_passed");
    expect(saved.chapters[1]!.reviewStale).toBeUndefined();
    const titles = (await listActivities(book.id)).map(a => a.title);
    expect(titles).toEqual(expect.arrayContaining(["Review avviata: review mirata", "Review 1/1: Cap. 2 · 1. Il molo", "Review completata: review mirata"]));
  });
  it("un libro completato torna completato; le proposte si approvano dopo", async () => {
    const book = await editedBook();
    const done = await stored(book.id); done.status = "completed"; done.phase = "completed"; await saveBook(done, false);
    await requestManualReview(book.id, { scope: "targeted", mode: "propose", targets: [sceneTarget] });
    script(kind => kind === "chapterAudit" ? JSON.stringify({ verdict: "issues", summary: "Un problema.", findings: [{ sceneId: sceneTarget.id, severity: "minor",
      category: "style", evidence: "Markus aspetta sul molo", issue: "Il tramonto contraddice l'ora del capitolo.", suggestion: "Togli il tramonto." }] })
      : "Markus aspetta sul molo. Dice di conoscere il Consiglio cittadino.");
    await new AutopilotRunner().run(book.id, async () => undefined);
    let saved = await stored(book.id);
    expect(saved.status).toBe("completed");
    expect(calls.map(c => c.kind)).toEqual(["chapterAudit", "chapterRepair"]);
    const review = saved.manualReviews![0]!;
    expect(saved.chapters[1]!.scenes[0]!.text).toContain("tramonto");
    await decideReviewProposal(book.id, review.id, review.proposals[0]!.id, true);
    saved = await stored(book.id);
    expect(saved.chapters[1]!.scenes[0]!.text).not.toContain("tramonto");
    expect(saved.edits!.at(-1)).toMatchObject({ origin: "ai", reviewState: "modified_unreviewed" });
  });
  it("annullata durante la chiamata: la risposta è scartata, nulla cambia e il libro torna in pausa", async () => {
    const book = await editedBook();
    const { review } = await requestManualReview(book.id, { scope: "targeted", mode: "check", targets: [sceneTarget] });
    script(() => pass);
    modelCall.mockImplementationOnce(async (kind: string, system: string, prompt: string) => {
      calls.push({ kind, system, prompt });
      await cancelManualReview(book.id, review.id);
      return answer(pass);
    });
    await new AutopilotRunner().run(book.id, async () => undefined);
    const saved = await stored(book.id);
    expect(calls).toHaveLength(1);
    expect(saved.status).toBe("paused");
    expect(saved.manualReviews![0]!.status).toBe("cancelled");
    expect(elementReviewState(saved, sceneTarget)).toBe("modified_unreviewed");
    // The cancel paused the book (it was paused when the review was asked): the reply is not applied.
    const cancelled = (await listActivities(book.id)).find(a => a.title.startsWith("Review 1/1"))!;
    expect(cancelled).toMatchObject({ status: "cancelled", aiRequested: true, inputTokens: 80 });
  });
});

describe("Modifica solo questo, con l'AI", () => {
  it("propone una nuova versione di un passaggio selezionato: niente cambia finché non la accetti", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    const text = book.chapters[1]!.scenes[0]!.text;
    const start = text.indexOf("Dice"), end = text.length;
    script((kind, prompt) => { expect(kind).toBe("revision"); expect(prompt).toContain("[[INIZIO SELEZIONE]]Dice"); return "Sussurra di conoscere il Consiglio cittadino."; });
    const proposal = await proposeAiEdit(book.id, { kind: "scene", id: sceneTarget.id, selection: { start, end } }, "Rendi la frase più misteriosa", new AbortController());
    expect(proposal.changes).toHaveLength(1);
    expect(proposal.changes[0]!.after).toBe("Markus aspetta sul molo. Sussurra di conoscere il Consiglio cittadino.");
    expect((await stored(book.id)).chapters[1]!.scenes[0]!.text).toBe(text);
    const activity = (await listActivities(book.id))[0]!;
    expect(activity).toMatchObject({ status: "succeeded", aiRequested: true, inputTokens: 80 });
    await acceptAiEditChange(book.id, proposal, proposal.changes[0]!);
    const saved = await stored(book.id);
    expect(saved.chapters[1]!.scenes[0]!.text).toContain("Sussurra");
    expect(saved.edits!.at(-1)).toMatchObject({ origin: "ai", prompt: "Rendi la frase più misteriosa", aiActivityId: activity.id, reviewState: "modified_unreviewed" });
    expect(saved.manualReviews).toBeUndefined();
  });
  it("una scheda: i nomi citati dall'AI devono esistere; accettare su una scheda cambiata è rifiutato", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    script(() => JSON.stringify({ name: "Markus", importance: "main", summary: "Informatore che teme il Consiglio.", relationships: [{ target: "Elena", type: "protegge" }] }));
    const proposal = await proposeAiEdit(book.id, { kind: "entity", id: "character:markus" }, "Rendilo protettivo verso Elena", new AbortController());
    expect(proposal.changes[0]!.after).toContain("protegge → Elena");
    script(() => JSON.stringify({ name: "Markus", relationships: [{ target: "Personaggio inventato", type: "fratello" }] }));
    await expect(proposeAiEdit(book.id, { kind: "entity", id: "character:markus" }, "Dagli un fratello", new AbortController())).rejects.toThrow(/non è fra le schede/);
    const current = await stored(book.id);
    current.knowledge!.entities.find(e => e.id === "character:markus")!.summary = "Cambiato nel frattempo.";
    await saveBook(current, false);
    await expect(acceptAiEditChange(book.id, proposal, proposal.changes[0]!)).rejects.toBeInstanceOf(ElementChangedError);
  });
});
