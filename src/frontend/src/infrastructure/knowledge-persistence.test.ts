import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { knowledgeBook } from "../domain/__fixtures__/knowledge";
import { projectBook } from "../domain/narrarium";
import { readNarrarium } from "../domain/narrarium-reader";
import { readMarkdownDocument } from "../domain/markdown-document";
import { summarizeBook } from "../domain/cloud-profile";
import { createBackup, readBackup } from "./backup";
import { getDb, saveBook } from "./db";

const markdownOnly = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith(".md")));

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta", "settings", "mergeDrafts"]) await db.clear(store);
});

describe("Knowledge base nel formato Markdown", () => {
  it("schede, eventi e timeline sono leggibili e tornano identici negli aspetti strutturati", () => {
    const book = knowledgeBook();
    const files = projectBook(book, []).files;
    const elena = readMarkdownDocument(files["characters/elena.md"]!);
    expect(elena.metadata).toMatchObject({ type: "character", id: "character:elena", importance: "main", attr_speech: "Frasi brevi, domande dirette",
      relations: ["alleato | character:markus", "antagonista | faction:consiglio-cittadino"], aliases: ["Elena Voss"] });
    expect(elena.body).toBe(book.memory.characters.Elena);
    // A planned sheet without memory is written, but marked so no memory is invented on import.
    expect(readMarkdownDocument(files["factions/consiglio-cittadino.md"]!).metadata.knowledge_only).toBe(true);
    const event = readMarkdownDocument(files["events/incontro-con-l-informatore.md"]!);
    expect(event.metadata).toMatchObject({ type: "event", story_order: 5, causes: ["event:primo-indizio"], scenes: ["scene:002:001"],
      perspectives: ["conceals | character:markus | Lavora per il Consiglio", "unaware | character:elena"] });
    expect(files["timelines/timeline-indagine-sulle-sparizioni.md"]).toContain("type: \"timeline\"");
    const imported = readNarrarium(markdownOnly(files), crypto.randomUUID(), book.updatedAt);
    const strip = (kb: NonNullable<typeof book.knowledge>) => ({
      entities: kb.entities.map(({ id, type, name, aliases, importance, summary, attributes, relationships, status }) => ({ id, type, name, aliases, importance, summary, attributes, relationships, status }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      events: kb.events.map(({ id, title, summary, storyOrder, narration, involves, causes, sceneIds, secret, perspectives, timelineIds }) =>
        ({ id, title, summary, storyOrder, narration, involves, causes, sceneIds, secret, perspectives, timelineIds })),
      timelines: kb.timelines,
    });
    expect(strip(imported.knowledge!)).toEqual(strip(book.knowledge!));
    // The memory timeline is one Markdown document by contract; the other memory is identical.
    expect({ ...imported.memory, timeline: [] }).toEqual({ ...book.memory, timeline: [] });
    expect(imported.knowledge!.entities.every(e => e.origin === "imported")).toBe(true);
  });
  it("gli ID già presenti nei Markdown restano stabili anche se le schede nascono dopo", () => {
    const book = knowledgeBook();
    const kb = book.knowledge!; delete book.knowledge;
    const legacy = markdownOnly(projectBook(book, []).files);
    legacy["characters/elena.md"] = legacy["characters/elena.md"]!.replace('"character:elena"', '"character:elena-voss"');
    const imported = readNarrarium(legacy, crypto.randomUUID(), book.updatedAt);
    expect(imported.knowledge).toBeUndefined();
    imported.knowledge = kb; // generated later by the autopilot, with slug IDs
    const reread = readNarrarium(markdownOnly(projectBook(imported, []).files), imported.id, imported.updatedAt);
    expect(reread.knowledge!.entities.find(e => e.name === "Elena")!.id).toBe("character:elena-voss");
    expect(reread.knowledge!.events.find(e => e.title === "Primo indizio")!.involves).toContain("character:elena-voss");
    expect(reread.knowledge!.entities.find(e => e.name === "Markus")!.relationships).toEqual([]);
  });
  it("eventi con riferimenti rotti o scene inesistenti falliscono chiusi", () => {
    const files = markdownOnly(projectBook(knowledgeBook(), []).files);
    const broken = { ...files, "events/primo-indizio.md": files["events/primo-indizio.md"]!.replace('"character:elena"', '"character:nessuno"') };
    expect(() => readNarrarium(broken, crypto.randomUUID(), "2026-11-14T00:00:00.000Z")).toThrow(/scheda inesistente/);
    const ghost = { ...files, "events/primo-indizio.md": files["events/primo-indizio.md"]!.replace('"scene:001:002"', '"scene:404"') };
    expect(() => readNarrarium(ghost, crypto.randomUUID(), "2026-11-14T00:00:00.000Z")).toThrow(/scena inesistente/);
  });
  it("JSON Schema versionati e report leggibili delle modifiche, solo nel formato 2", () => {
    const book = knowledgeBook();
    book.changeOperations = [{ id: crypto.randomUUID(), createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
      target: { kind: "entity", id: "character:elena" }, targetLabel: "Elena", instruction: "Elena diventa impulsiva.", mode: "auto", state: "completed",
      plan: { interpretation: "Reagisce d'istinto.", changeKind: "narrative", rationale: "Scene dell'archivio.", direct: ["scene:001:002"], indirect: [], global: false,
        rewriteSceneIds: ["scene:001:002"], changedFacts: ["Carattere impulsivo"] }, before: { scenes: [] }, report: [{ sceneId: "scene:001:002", at: "x", drift: ["Numeri o date cambiati: 9."] }] }];
    const files = projectBook(book, []).files;
    const schema = JSON.parse(files["schemas/entity.schema.json"]!);
    expect(schema).toMatchObject({ title: "entity", "x-bookwriter-schema-version": 1, type: "object", additionalProperties: false });
    expect(schema.required).toEqual(expect.arrayContaining(["id", "type", "name", "version", "status"]));
    for (const name of ["knowledge", "event", "timeline", "editorial-profiles", "change-operation"]) expect(files["schemas/" + name + ".schema.json"]).toBeTruthy();
    const report = Object.entries(files).find(([path]) => path.startsWith("changes/2026-11-14-"))![1];
    expect(report).toContain("Richiesta dell'autore: Elena diventa impulsiva.");
    expect(report).toContain("scene:001:002: Numeri o date cambiati: 9.");
    const legacy = projectBook(book, [], 1).files;
    expect(Object.keys(legacy).some(p => p.startsWith("events/") || p.startsWith("schemas/") || p.startsWith("changes/"))).toBe(false);
    expect(readMarkdownDocument(legacy["characters/elena.md"]!).metadata.importance).toBeUndefined();
  });
  it("le schede non entrano nel profilo cloud", () => {
    const summary = JSON.stringify(summarizeBook(knowledgeBook(), { id: crypto.randomUUID(), name: "PC" }, "2026-11-14T00:00:00.000Z"));
    for (const secret of ["knowledge", "Investigatrice protagonista", "Lavora per il Consiglio", "changeOperations"]) expect(summary).not.toContain(secret);
  });
});

describe("Knowledge base e modifiche negli ZIP", () => {
  it("round-trip content/full e rifiuto di dati ostili", async () => {
    const book = knowledgeBook();
    const opId = crypto.randomUUID();
    book.changeOperations = [{ id: opId, createdAt: book.createdAt, updatedAt: book.createdAt, target: { kind: "scene", id: "scene:001:001" },
      targetLabel: "Il ricordo", instruction: "Più tensione.", mode: "auto", state: "pending", before: { scenes: [] }, report: [] }];
    book.revision = { id: crypto.randomUUID(), instruction: "Modifica", beforePhase: "prose", affectedSceneIds: [], cursor: 0, changeOperationId: opId };
    book.phase = "revision"; book.changeMode = "confirm";
    await saveBook(book, false);
    for (const kind of ["content", "full"] as const) {
      const file = await createBackup(kind, kind === "full" ? "synthetic-long-password" : undefined);
      const data = await readBackup(file as File, kind === "full" ? "synthetic-long-password" : undefined);
      expect(data.books[0]!.knowledge).toEqual(book.knowledge);
      expect(data.books[0]!.changeOperations).toEqual(book.changeOperations);
      expect(data.books[0]!.changeMode).toBe("confirm");
    }
    const zip = await createBackup("content"), parts = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    for (const corrupt of [
      (b: Record<string, any>) => { b.knowledge.events[0].causes = [b.knowledge.events[3].id]; },
      (b: Record<string, any>) => { b.knowledge.entities[0].relationships = [{ targetId: "character:fantasma", type: "amico" }]; },
      (b: Record<string, any>) => { b.knowledge.entities[0].hostile = "x"; },
      (b: Record<string, any>) => { b.revision.changeOperationId = crypto.randomUUID(); },
      (b: Record<string, any>) => { b.changeOperations[0].state = "teleported"; },
    ]) {
      const data = JSON.parse(strFromU8(parts["content.json"]!)); corrupt(data.books[0]);
      const file = new Blob([new Uint8Array(zipSync({ "manifest.json": parts["manifest.json"]!, "content.json": strToU8(JSON.stringify(data)) }))]) as File;
      await expect(readBackup(file)).rejects.toThrow(/Schema backup/);
    }
  });
});
