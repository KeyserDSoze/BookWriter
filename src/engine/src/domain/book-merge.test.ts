import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  applyBookMerge, buildMergeConflictPrompt, chooseMerge, isMergeReady, mergeSessionSchema, planBookMerge,
  toMergeConflicts, unresolvedConflicts, type MergeSession,
} from "./book-merge";

const TEXT = ["Apertura.", "Il faro era spento.", "Mara salì le scale.", "Parlò con Elio.", "Chiusura."].join("\n");
function sample() {
  const base = newBook("Premessa", "Il faro", "Sobrio", "Adulti");
  base.chapters = [
    { id: "ch:1", number: 1, title: "Il ponte", purpose: "p", frozenAt: "2026-01-01T00:00:00.000Z", summary: "riassunto", scenes: [
      { id: "s:1", number: 1, title: "Incontro", objective: "o", text: TEXT, status: "canon", summary: "s" }] },
    { id: "ch:2", number: 2, title: "Il molo", purpose: "p", frozenAt: "2026-01-02T00:00:00.000Z", summary: "riassunto 2", scenes: [
      { id: "s:2", number: 1, title: "Partenza", objective: "o", text: "Salpano.", status: "canon", summary: "s" }] },
  ];
  base.memory.characters.Mara = "Mara ha la chiave.";
  return { base, ours: structuredClone(base), theirs: structuredClone(base) };
}
const scene = (book: BookProject, id = "s:1") => book.chapters.flatMap(c => c.scenes).find(s => s.id === id)!;

describe("unione di due versioni del libro", () => {
  it("prende da sola ciò che è cambiato solo nell'altro ramo e riapre dal primo capitolo toccato", () => {
    const { base, ours, theirs } = sample();
    theirs.memory.characters.Mara = "Mara ha perso la chiave.";
    scene(theirs, "s:2").text = "Salpano all'alba.";
    const plan = planBookMerge(ours, theirs, base);
    expect(plan.conflicts).toEqual([]);
    expect(plan.theirsOnly.map(u => u.kind).sort()).toEqual(["entity", "scene"]);
    const merged = applyBookMerge(ours, theirs, plan, [], "Unione");
    expect(merged.memory.characters.Mara).toBe("Mara ha perso la chiave.");
    expect(scene(merged, "s:2").text).toBe("Salpano all'alba.");
    expect(merged.chapters.every(c => c.frozenAt === undefined)).toBe(true);
    expect(merged.status).toBe("paused");
    expect(merged.previousError).toBe("Unione");
  });

  it("modifiche in punti diversi della stessa scena si uniscono per righe, senza AI", () => {
    const { base, ours, theirs } = sample();
    scene(ours).text = TEXT.replace("Il faro era spento.", "Il faro era spento da anni.");
    scene(theirs).text = TEXT.replace("Chiusura.", "Chiusura, di notte.");
    const plan = planBookMerge(ours, theirs, base);
    expect(plan.conflicts).toEqual([]);
    expect(plan.textMerged).toHaveLength(1);
    const merged = applyBookMerge(ours, theirs, plan, [], "Unione");
    expect(scene(merged).text).toContain("spento da anni");
    expect(scene(merged).text).toContain("di notte");
    expect(scene(merged).status).toBe("draft");
    expect(merged.editorialReviewSceneIds).toBeUndefined();
  });

  it("la stessa riga cambiata da entrambi è un conflitto e senza decisione l'unione rifiuta", () => {
    const { base, ours, theirs } = sample();
    scene(ours).text = TEXT.replace("Parlò con Elio.", "Tacque.");
    scene(theirs).text = TEXT.replace("Parlò con Elio.", "Urlò.");
    const plan = planBookMerge(ours, theirs, base);
    expect(plan.conflicts.map(c => c.kind)).toEqual(["scene"]);
    expect(() => applyBookMerge(ours, theirs, plan, [], "Unione")).toThrow("senza decisione");
    const conflicts = toMergeConflicts(plan, base);
    expect(conflicts[0]).toMatchObject({ origin: "both-changed", baseText: TEXT });
    const decided = structuredClone(conflicts);
    decided[0]!.choice = "theirs";
    expect(scene(applyBookMerge(ours, theirs, plan, decided, "Unione")).text).toContain("Urlò.");
    decided[0]!.choice = "ours";
    expect(scene(applyBookMerge(ours, theirs, plan, decided, "Unione")).text).toContain("Tacque.");
  });

  it("senza antenato comune ogni differenza è un conflitto: nessuna deduzione di chi ha cambiato", () => {
    const { ours, theirs } = sample();
    theirs.memory.characters.Mara = "Altra versione.";
    const plan = planBookMerge(ours, theirs);
    expect(plan.theirsOnly).toEqual([]);
    expect(plan.conflicts.map(c => c.id)).toEqual(["entity:characters:\"Mara\""]);
  });

  it("le schede narrative cambiate solo dall'altro ramo passano; se cambiate da entrambi si decide", () => {
    const { base, ours, theirs } = sample();
    base.knowledge = { schemaVersion: 1, entities: [], events: [], timelines: [] } as unknown as BookProject["knowledge"];
    ours.knowledge = structuredClone(base.knowledge); theirs.knowledge = structuredClone(base.knowledge);
    (theirs.knowledge as unknown as { entities: unknown[] }).entities = [{ id: "character:mara" }];
    let plan = planBookMerge(ours, theirs, base);
    expect(plan.theirsOnly.map(u => u.kind)).toEqual(["knowledge"]);
    expect(applyBookMerge(ours, theirs, plan, [], "Unione").knowledge).toEqual(theirs.knowledge);
    (ours.knowledge as unknown as { events: unknown[] }).events = [{ id: "event:x" }];
    plan = planBookMerge(ours, theirs, base);
    expect(plan.conflicts.map(u => u.kind)).toEqual(["knowledge"]);
  });

  it("la proposta di testo vale solo per una scena presente nei due rami ed è limitata", () => {
    const { base, ours, theirs } = sample();
    scene(ours).text = TEXT.replace("Parlò con Elio.", "Tacque.");
    scene(theirs).text = TEXT.replace("Parlò con Elio.", "Urlò.");
    theirs.memory.characters.Mara = "x"; ours.memory.characters.Mara = "y";
    const plan = planBookMerge(ours, theirs, base);
    const session = { conflicts: toMergeConflicts(plan, base) } as MergeSession;
    expect(unresolvedConflicts(session)).toHaveLength(2);
    const sceneId = session.conflicts.find(c => c.kind === "scene")!.id;
    const entityId = session.conflicts.find(c => c.kind === "entity")!.id;
    expect(() => chooseMerge(session, entityId, "proposal", "testo")).toThrow("solo su una scena");
    expect(() => chooseMerge(session, sceneId, "proposal", "")).toThrow("vuota");
    expect(() => chooseMerge(session, sceneId, "proposal", "x".repeat(180_001))).toThrow("troppo lunga");
    chooseMerge(session, sceneId, "proposal", "Parlarono piano.");
    chooseMerge(session, entityId, "ours");
    expect(isMergeReady(session)).toBe(true);
    const merged = applyBookMerge(ours, theirs, plan, session.conflicts, "Unione");
    expect(scene(merged).text).toBe("Parlarono piano.");
    expect(scene(merged).status).toBe("draft");
    expect(merged.memory.characters.Mara).toBe("y");
  });

  it("i conflitti oltre il limite non si salvano troncati", () => {
    const { base, ours, theirs } = sample();
    for (let i = 0; i < 401; i++) { ours.memory.characters["P" + i] = "a"; theirs.memory.characters["P" + i] = "b"; base.memory.characters["P" + i] = "c"; }
    expect(() => toMergeConflicts(planBookMerge(ours, theirs, base), base)).toThrow("Troppi conflitti");
  });

  it("la sessione è validata in modo stretto", () => {
    const valid = { id: crypto.randomUUID(), kind: "branch", mode: "author", oursBranch: "main", theirsBranch: "bozza",
      oursCommit: "a".repeat(40), theirsCommit: "b".repeat(40), oursStamp: "1:abcd1234", createdAt: new Date().toISOString(), conflicts: [] };
    expect(mergeSessionSchema.safeParse(valid).success).toBe(true);
    expect(mergeSessionSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(mergeSessionSchema.safeParse({ ...valid, theirsCommit: "main" }).success).toBe(false);
  });

  it("il prompt dell'autopilot tratta le scene come dati e include la base comune", () => {
    const { base, ours, theirs } = sample();
    scene(ours).text = TEXT.replace("Parlò con Elio.", "Tacque.");
    scene(theirs).text = TEXT.replace("Parlò con Elio.", "Urlò.");
    const [conflict] = toMergeConflicts(planBookMerge(ours, theirs, base), base);
    const { system, prompt } = buildMergeConflictPrompt(ours, conflict!, "main", "bozza");
    expect(system).toContain("NON ATTENDIBILE");
    expect(prompt).toContain("<versione_base>");
    expect(prompt).toContain("Tacque.");
    expect(prompt).toContain("Urlò.");
    expect(() => buildMergeConflictPrompt(ours, { ...conflict!, kind: "entity" }, "a", "b")).toThrow("due versioni");
  });
});
