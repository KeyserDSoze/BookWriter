import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  applyBookMerge, buildMergeConflictPrompt, chooseMerge, isMergeReady, mergeSessionSchema, mergeShape, planBookMerge,
  toMergeConflicts, unresolvedConflicts, validateMergeProposal, type MergeSession,
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

  it("la proposta di testo vale solo per contenuto presente nei due rami ed è limitata", () => {
    const { base, ours, theirs } = sample();
    scene(ours).text = TEXT.replace("Parlò con Elio.", "Tacque.");
    scene(theirs).text = TEXT.replace("Parlò con Elio.", "Urlò.");
    ours.chapters[0]!.title = "Il ponte A"; theirs.chapters[0]!.title = "Il ponte B";
    const plan = planBookMerge(ours, theirs, base);
    const session = { conflicts: toMergeConflicts(plan, base) } as MergeSession;
    expect(unresolvedConflicts(session)).toHaveLength(2);
    const sceneId = session.conflicts.find(c => c.kind === "scene")!.id;
    const metaId = session.conflicts.find(c => c.kind === "chapterMeta")!.id;
    expect(() => chooseMerge(session, metaId, "proposal", "testo")).toThrow("solo su una scena");
    expect(() => chooseMerge(session, sceneId, "proposal", "")).toThrow("vuota");
    expect(() => chooseMerge(session, sceneId, "proposal", "x".repeat(180_001))).toThrow("troppo lunga");
    chooseMerge(session, sceneId, "proposal", "Parlarono piano.");
    chooseMerge(session, metaId, "ours");
    expect(isMergeReady(session)).toBe(true);
    const merged = applyBookMerge(ours, theirs, plan, session.conflicts, "Unione");
    expect(scene(merged).text).toBe("Parlarono piano.");
    expect(scene(merged).status).toBe("draft");
    expect(merged.chapters[0]!.title).toBe("Il ponte A");
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

/** All the text-like units changed on both sides, with a common ancestor. */
function textUnits() {
  const { base } = sample();
  base.memory.currentState = "Inizio"; base.memory.timeline = ["E1"]; base.authorConstraints = ["A"];
  const ours = structuredClone(base), theirs = structuredClone(base);
  ours.brief = "Premessa A"; theirs.brief = "Premessa B";
  ours.title = "Il faro A"; theirs.title = "Il faro B";
  ours.authorConstraints = ["A", "B"]; theirs.authorConstraints = ["A", "C"];
  ours.memory.characters.Mara = "Mara ha tenuto la chiave."; theirs.memory.characters.Mara = "Mara ha perso la chiave.";
  ours.memory.currentState = "Di notte"; theirs.memory.currentState = "All'alba";
  ours.memory.timeline = ["E1", "E2"]; theirs.memory.timeline = ["E1", "E3"];
  const plan = planBookMerge(ours, theirs, base);
  const session = { conflicts: toMergeConflicts(plan, base) } as MergeSession;
  const id = (kind: string, part = "") => session.conflicts.find(c => c.kind === kind && c.id.includes(part))!.id;
  return { base, ours, theirs, plan, session, id };
}

describe("unione dei contenuti di testo che non sono scene", () => {
  it("campo, scheda, stato e timeline si uniscono con una proposta e riaprono dal primo capitolo", () => {
    const { base, ours, theirs, plan, session, id } = textUnits();
    expect(plan.conflicts.map(c => c.id).sort()).toEqual(
      ["currentState", "entity:characters:\"Mara\"", "field:authorConstraints", "field:brief", "field:title", "timeline"]);
    const baseOf = (unitId: string) => session.conflicts.find(c => c.id === unitId)!.baseText;
    expect(baseOf("field:brief")).toBe("Premessa");
    expect(baseOf("field:authorConstraints")).toBe(JSON.stringify(["A"]));
    expect(baseOf("entity:characters:\"Mara\"")).toBe("Mara ha la chiave.");
    expect(baseOf("currentState")).toBe("Inizio");
    expect(baseOf("timeline")).toBe(JSON.stringify(["E1"]));

    chooseMerge(session, id("field", "title"), "proposal", "Il faro AB");
    chooseMerge(session, id("field", "brief"), "proposal", "Premessa A e B");
    chooseMerge(session, id("field", "authorConstraints"), "proposal", "```json\n[\"A\", \"B\", \"C\"]\n```");
    chooseMerge(session, id("entity"), "proposal", "Mara ha perso e ritrovato la chiave.");
    chooseMerge(session, id("currentState"), "proposal", "Di notte, all'alba.");
    chooseMerge(session, id("timeline"), "proposal", "[\"E1\",\"E2\",\"E3\"]");
    expect(session.conflicts.find(c => c.id === "field:authorConstraints")!.proposal).toBe(JSON.stringify(["A", "B", "C"]));
    expect(isMergeReady(session)).toBe(true);

    const merged = applyBookMerge(ours, theirs, plan, session.conflicts, "Unione");
    expect(merged.title).toBe("Il faro AB");
    expect(merged.brief).toBe("Premessa A e B");
    expect(merged.authorConstraints).toEqual(["A", "B", "C"]);
    expect(merged.memory.characters.Mara).toBe("Mara ha perso e ritrovato la chiave.");
    expect(merged.memory.currentState).toBe("Di notte, all'alba.");
    expect(merged.memory.timeline).toEqual(["E1", "E2", "E3"]);
    expect(merged.chapters.every(c => c.frozenAt === undefined && c.summary === undefined)).toBe(true);
    expect(merged.status).toBe("paused");
    expect(ours.brief).toBe("Premessa A");
    expect(ours.authorConstraints).toEqual(["A", "B"]);
    expect(base.memory.timeline).toEqual(["E1"]);
  });

  it("una scelta «ours»/«theirs» sulle stesse unità resta quella di sempre", () => {
    const { ours, theirs, plan, session } = textUnits();
    for (const conflict of session.conflicts) chooseMerge(session, conflict.id, conflict.id === "timeline" ? "theirs" : "ours");
    const merged = applyBookMerge(ours, theirs, plan, session.conflicts, "Unione");
    expect(merged.brief).toBe("Premessa A");
    expect(merged.memory.timeline).toEqual(["E1", "E3"]);
  });

  it("un array non valido è rifiutato per intero e non decide il conflitto", () => {
    const { session, id } = textUnits();
    const listId = id("field", "authorConstraints");
    const long = Array.from({ length: 46 }, (_, i) => String(i % 10).repeat(4000));
    const replies = ["", "non è json", "Ecco: [\"A\"]", "[\"A\"] e basta", "{\"a\":1}", "[]", "[\"A\", 1]", "[\"A\", \"  \"]", "[\"A\", null]",
      JSON.stringify(["x".repeat(4001)]), JSON.stringify(Array.from({ length: 401 }, () => "a")), JSON.stringify(long),
      "```json\n[\"A\"]\n```\n```json\n[\"B\"]\n```", "```json\n[\"A\"]\n``` fine", "Risultato:\n```\n[\"A\"]\n```"];
    for (const reply of replies) {
      expect(() => chooseMerge(session, listId, "proposal", reply), reply.slice(0, 30)).toThrow();
      expect(() => validateMergeProposal(session.conflicts.find(c => c.id === listId)!, reply)).toThrow();
    }
    const conflict = session.conflicts.find(c => c.id === listId)!;
    expect(conflict.choice).toBeUndefined();
    expect(conflict.proposal).toBeUndefined();
    expect(JSON.parse(validateMergeProposal(conflict, JSON.stringify(Array.from({ length: 400 }, () => "a"))))).toHaveLength(400);
    expect(validateMergeProposal(conflict, "```\n[\"A\",\" B \"]\n```")).toBe(JSON.stringify(["A", "B"]));
  });

  it("un testo vuoto, troppo lungo o un titolo su più righe sono rifiutati", () => {
    const { session, id } = textUnits();
    for (const kind of ["currentState", "entity", "field"]) {
      const target = kind === "field" ? id("field", "brief") : id(kind);
      expect(() => chooseMerge(session, target, "proposal", "  ")).toThrow("vuota");
      expect(() => chooseMerge(session, target, "proposal", "x".repeat(180_001))).toThrow("troppo lunga");
    }
    expect(() => chooseMerge(session, id("field", "title"), "proposal", "Il faro\nA")).toThrow("una sola riga");
    chooseMerge(session, id("field", "title"), "proposal", "  Il faro AB ");
    expect(session.conflicts.find(c => c.id === "field:title")!.proposal).toBe("Il faro AB");
  });

  it("unità presenti da un solo lato, capitoli e schede narrative restano all'autore", () => {
    const { base, ours, theirs } = sample();
    for (const book of [base, ours, theirs]) { book.ideas = "idee base"; book.memory.characters.Elio = "c"; }
    ours.ideas = "idee nostre"; delete theirs.ideas;
    ours.memory.characters.Elio = "a"; delete theirs.memory.characters.Elio;
    ours.chapters[0]!.title = "A"; theirs.chapters[0]!.title = "B";
    base.knowledge = { schemaVersion: 1, entities: [], events: [], timelines: [] } as unknown as BookProject["knowledge"];
    ours.knowledge = structuredClone(base.knowledge); theirs.knowledge = structuredClone(base.knowledge);
    (ours.knowledge as unknown as { events: unknown[] }).events = [{ id: "event:x" }];
    (theirs.knowledge as unknown as { entities: unknown[] }).entities = [{ id: "character:mara" }];
    const plan = planBookMerge(ours, theirs, base);
    const session = { conflicts: toMergeConflicts(plan, base) } as MergeSession;
    expect(session.conflicts.map(c => c.kind).sort()).toEqual(["chapterMeta", "entity", "field", "knowledge"]);
    for (const conflict of session.conflicts) {
      expect(mergeShape(conflict), conflict.id).toBeUndefined();
      expect(conflict.baseText).toBeUndefined();
      expect(() => chooseMerge(session, conflict.id, "proposal", "testo"), conflict.id).toThrow("solo su una scena");
      expect(() => buildMergeConflictPrompt(ours, conflict, "a", "b"), conflict.id).toThrow("due versioni");
      const forged = session.conflicts.map(c => ({ id: c.id, choice: c.id === conflict.id ? "proposal" as const : "ours" as const, proposal: "testo" }));
      expect(() => applyBookMerge(ours, theirs, plan, forged, "Unione"), conflict.id).toThrow();
    }
    const forged = session.conflicts.map(c => ({ id: c.id, choice: c.kind === "knowledge" ? "proposal" as const : "ours" as const, proposal: "testo" }));
    expect(() => applyBookMerge(ours, theirs, plan, forged, "Unione")).toThrow("schede narrative");
  });

  it("le chiavi con nomi di prototipo sono dati, mai assegnazioni", () => {
    const { base, ours, theirs } = sample();
    const define = (book: BookProject, name: string, value: string) =>
      Object.defineProperty(book.memory.characters, name, { value, enumerable: true, writable: true, configurable: true });
    for (const name of ["__proto__", "constructor"]) { define(base, name, "base"); define(ours, name, "nostra"); define(theirs, name, "loro"); }
    const plan = planBookMerge(ours, theirs, base);
    const session = { conflicts: toMergeConflicts(plan, base) } as MergeSession;
    expect(session.conflicts).toHaveLength(2);
    for (const conflict of session.conflicts) {
      expect(conflict.baseText).toBe("base");
      chooseMerge(session, conflict.id, "proposal", "unita " + conflict.label);
    }
    const merged = applyBookMerge(ours, theirs, plan, session.conflicts, "Unione");
    expect(Object.getPrototypeOf(merged.memory.characters)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(merged.memory.characters, "__proto__")?.value).toBe("unita __proto__");
    expect(Object.getOwnPropertyDescriptor(merged.memory.characters, "constructor")?.value).toBe("unita constructor");
  });

  it("il prompt per tipo include base, entrambe le versioni e dichiara il contenuto non attendibile", () => {
    const { ours, session, id } = textUnits();
    const conflict = (unitId: string) => session.conflicts.find(c => c.id === unitId)!;
    const entity = buildMergeConflictPrompt(ours, conflict(id("entity")), "main", "bozza");
    expect(entity.system).toContain("NON ATTENDIBILE");
    expect(entity.prompt).toContain("«Mara»");
    expect(entity.prompt).toContain("<versione_base>\nMara ha la chiave.\n</versione_base>");
    expect(entity.prompt).toContain("«main»:\n<versione_a>\nMara ha tenuto la chiave.\n</versione_a>");
    expect(entity.prompt).toContain("«bozza»:\n<versione_b>\nMara ha perso la chiave.\n</versione_b>");
    const list = buildMergeConflictPrompt(ours, conflict(id("timeline")), "main", "bozza");
    expect(list.system).toContain("NON ATTENDIBILE");
    expect(list.system).toContain("array JSON");
    expect(list.prompt).toContain("<versione_base>\n[\"E1\"]\n</versione_base>");
    expect(list.prompt).toContain("<versione_a>\n[\"E1\",\"E2\"]\n</versione_a>");
    expect(list.prompt).toContain("<versione_b>\n[\"E1\",\"E3\"]\n</versione_b>");
    expect(buildMergeConflictPrompt(ours, conflict(id("field", "title")), "main", "bozza").system).toContain("una sola riga");
    for (const unitId of ["field:brief", "currentState"]) {
      const { prompt } = buildMergeConflictPrompt(ours, conflict(unitId), "main", "bozza");
      expect(prompt).toContain("<versione_base>");
      expect(prompt).toContain("<versione_a>");
      expect(prompt).toContain("<versione_b>");
    }
    const big = { ...conflict(id("currentState")), ours: "x".repeat(20_001) };
    expect(() => buildMergeConflictPrompt(ours, big, "main", "bozza")).toThrow("troppo lungo");
    expect(() => buildMergeConflictPrompt(ours, { ...conflict("timeline"), baseText: "y".repeat(20_001) }, "main", "bozza")).toThrow("troppo lungo");
  });
});
