import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject, type TaskKind } from "@engine/domain/types";
import { planBookMerge, toMergeConflicts } from "@engine/domain/book-merge";
import { emptyKnowledge } from "@engine/domain/knowledge";

const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("@engine/infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("@engine/application/writer-guard", () => ({ withWriterGuard: writerGuard }));
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner } from "@engine/application/autopilot";

const TEXT = ["Apertura.", "Il faro era spento.", "Mara salì le scale.", "Parlò con Elio.", "Chiusura."].join("\n");
type Call = { kind: TaskKind; prompt: string };
const calls: Call[] = [];

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  calls.length = 0;
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_b, _r, _c, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
});

const reply = (text: string) => ({ text, endpointId: "openai", modelId: "test-model", inputTokens: 10, outputTokens: 5 });
function script(answer: (prompt: string) => string) {
  modelCall.mockImplementation(async (kind: TaskKind, _system: string, prompt: string) => {
    calls.push({ kind, prompt });
    return reply(answer(prompt));
  });
}

/** A book waiting in an unfinished merge, as the server leaves it after `pull`. */
async function mergingBook(options: { scene?: boolean; entity?: boolean; knowledge?: boolean; timeline?: boolean; mode?: "author" | "autopilot" }): Promise<BookProject> {
  const base = newBook("Premessa", "Il faro", "Sobrio", "Adulti");
  base.status = "paused"; base.phase = "completed";
  base.chapters = [{ id: "ch:1", number: 1, title: "Il ponte", purpose: "p", frozenAt: "2026-01-01T00:00:00.000Z", summary: "r",
    scenes: [{ id: "s:1", number: 1, title: "Incontro", objective: "o", text: TEXT, status: "canon", summary: "s" }] }];
  base.memory.characters.Mara = "Mara ha la chiave.";
  base.memory.timeline = ["E1"];
  base.knowledge = emptyKnowledge();
  const ours = structuredClone(base), theirs = structuredClone(base);
  if (options.scene) {
    ours.chapters[0]!.scenes[0]!.text = TEXT.replace("Parlò con Elio.", "Tacque.");
    theirs.chapters[0]!.scenes[0]!.text = TEXT.replace("Parlò con Elio.", "Urlò.");
  }
  if (options.entity) { ours.memory.characters.Mara = "Mara tiene la chiave."; theirs.memory.characters.Mara = "Mara perde la chiave."; }
  if (options.timeline) { ours.memory.timeline = ["E1", "E2"]; theirs.memory.timeline = ["E1", "E3"]; }
  if (options.knowledge) {
    (ours.knowledge as unknown as { events: unknown[] }).events = [{ id: "event:x" }];
    (theirs.knowledge as unknown as { entities: unknown[] }).entities = [{ id: "character:mara" }];
  }
  ours.mergeSession = { id: crypto.randomUUID(), kind: "branch", mode: options.mode ?? "autopilot", oursBranch: "main", theirsBranch: "bozza",
    oursCommit: "a".repeat(40), theirsCommit: "b".repeat(40), baseCommit: "c".repeat(40), oursStamp: "1:abcd1234",
    createdAt: new Date().toISOString(), conflicts: toMergeConflicts(planBookMerge(ours, theirs, base), base) };
  await saveBook(ours, false);
  return ours;
}

describe("L'autopilot cura i conflitti di testo di un'unione", () => {
  it("propone scena e scheda in due chiamate e lascia all'autore le schede narrative", async () => {
    const book = await mergingBook({ scene: true, entity: true, knowledge: true });
    script(prompt => prompt.includes("Scena:") ? "Parlarono piano." : "Mara tiene e perde la chiave.");
    await new AutopilotRunner().run(book.id, async () => undefined);

    expect(calls.map(c => c.kind)).toEqual(["merge", "merge"]);
    expect(calls[0]!.prompt).toContain("Scena: Incontro");
    expect(calls[1]!.prompt).toContain("Elemento da unire: «Mara»");
    expect(calls[1]!.prompt).toContain("<versione_base>\nMara ha la chiave.\n</versione_base>");
    const saved = (await getBook(book.id))!;
    const byKind = (kind: string) => saved.mergeSession!.conflicts.find(c => c.kind === kind)!;
    expect(byKind("scene")).toMatchObject({ choice: "proposal", proposal: "Parlarono piano." });
    expect(byKind("entity")).toMatchObject({ choice: "proposal", proposal: "Mara tiene e perde la chiave." });
    expect(byKind("knowledge").choice).toBeUndefined();
    expect(saved.mergeSession!.stalled).toBeUndefined();
    expect(saved.status).toBe("paused");
    expect(saved.previousError).toContain("1 conflitti da decidere");
    // The merged text only exists in the session: the book itself is untouched until the merge is published.
    expect(saved.chapters).toEqual(book.chapters);
    expect(saved.memory.characters.Mara).toBe("Mara tiene la chiave.");
    const merges = (await listActivities(book.id)).filter(a => a.aiRequested);
    expect(merges).toHaveLength(2);
    expect(merges.every(a => a.status === "succeeded" && a.title.startsWith("Unione dei branch:"))).toBe(true);
  });

  it("una risposta non valida per una lista non decide il conflitto; una valida, anche in un blocco ```, sì", async () => {
    const book = await mergingBook({ timeline: true });
    script(() => "Ecco la timeline unita: E1, E2, E3");
    await new AutopilotRunner().run(book.id, async () => undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain("Elemento da unire: «Cronologia degli eventi»");
    expect(calls[0]!.prompt).toContain("<versione_base>\n[\"E1\"]\n</versione_base>");
    let saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.mergeSession!.conflicts[0]!.choice).toBeUndefined();
    expect(saved.mergeSession!.conflicts[0]!.proposal).toBeUndefined();
    expect(saved.memory.timeline).toEqual(["E1", "E2"]);
    const failed = (await listActivities(book.id)).filter(a => a.aiRequested);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: "failed", inputTokens: 10, outputTokens: 5 });

    calls.length = 0;
    script(() => "```json\n[\"E1\", \"E2\", \"E3\"]\n```");
    await new AutopilotRunner().run(book.id, async () => undefined);
    expect(calls).toHaveLength(1);
    saved = (await getBook(book.id))!;
    expect(saved.mergeSession!.conflicts[0]).toMatchObject({ choice: "proposal", proposal: JSON.stringify(["E1", "E2", "E3"]) });
    expect(saved.status).toBe("paused");
    expect(saved.previousError).toContain("Unione pronta");
  });

  it("un array con una voce non stringa o oltre i limiti è respinto per intero", async () => {
    for (const bad of ["[\"E1\", 2]", "[]", JSON.stringify(Array.from({ length: 401 }, () => "E"))]) {
      const book = await mergingBook({ timeline: true });
      calls.length = 0;
      script(() => bad);
      await new AutopilotRunner().run(book.id, async () => undefined);
      expect(calls).toHaveLength(1);
      const saved = (await getBook(book.id))!;
      expect(saved.status).toBe("error");
      expect(saved.mergeSession!.conflicts[0]!.choice).toBeUndefined();
    }
  });

  it("in modalità «autore» l'autopilot non chiama l'AI e aspetta le decisioni", async () => {
    const book = await mergingBook({ entity: true, timeline: true, mode: "author" });
    script(() => "non deve essere chiamato");
    await new AutopilotRunner().run(book.id, async () => undefined);
    expect(calls).toHaveLength(0);
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("paused");
    expect(saved.previousError).toContain("2 conflitti da decidere");
  });
});
