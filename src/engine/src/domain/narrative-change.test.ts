import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { changeOperationSchema, detectFactDrift, pruneChangeOperations, replaceEntitySheet, replaceEventSheet, sceneSnapshots,
  validRewriteTargets, type NarrativeChangeOperation } from "./narrative-change";
import { applyChangePlan, reopenForRewrite, revertChange, revertProblem, settleAfterRewrite, settleChangeOperations } from "./narrative-change-flow";
import type { BookProject } from "./types";

const now = "2026-11-14T12:00:00.000Z";
function withOperation(book: BookProject, patch: Partial<NarrativeChangeOperation> = {}): NarrativeChangeOperation {
  const op: NarrativeChangeOperation = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, target: { kind: "entity", id: "character:elena" },
    targetLabel: "Elena", instruction: "Elena diventa impulsiva ed emotiva.", mode: "auto", state: "pending", before: { scenes: [] }, report: [], ...patch };
  book.changeOperations = [...(book.changeOperations ?? []), op];
  book.revision = { id: crypto.randomUUID(), instruction: "Modifica", beforePhase: "prose", affectedSceneIds: [], cursor: 0, changeOperationId: op.id };
  book.phase = "revision";
  return op;
}

describe("Motore di modifica: regole pure", () => {
  it("il controllo locale rileva nomi e numeri presenti in una sola versione", () => {
    expect(detectFactDrift("Elena aveva dodici anni e 3 chiavi.", "Elena aveva dodici anni e 3 chiavi, disse piano.", ["Elena", "Markus"])).toEqual([]);
    expect(detectFactDrift("Elena parla con Markus. Erano le 9.", "Elena parla da sola. Erano le 10.", ["Elena", "Markus"]))
      .toEqual(["«Markus» non compare più nella scena.", "Numeri o date cambiati: 9, 10."]);
  });
  it("il controllo locale vede anche i nomi propri senza scheda, non le maiuscole di inizio frase", () => {
    expect(detectFactDrift("Elena entra. La stanza è buia.", "Elena entra con Tommaso. La stanza è buia.", ["Elena"])).toEqual(["Nomi propri nuovi: Tommaso."]);
    expect(detectFactDrift("Sul tavolo c'è una lettera di Bianca.", "Sul tavolo c'è una lettera.", [])).toEqual(["Nomi propri spariti: Bianca."]);
    // Moving a known word to the start of a sentence, or a sentence-initial capital, is not a new name.
    expect(detectFactDrift("Corre verso Trieste. Piove.", "Trieste è lontana, corre. Piove ancora.", [])).toEqual([]);
  });
  it("il ripristino esatto riporta anche la revisione precedente del capitolo, se il testo torna identico", () => {
    const book = knowledgeBook();
    const op = withOperation(book, { target: { kind: "scene", id: "scene:002:002" }, targetLabel: "La prova" });
    op.before = { scenes: sceneSnapshots(book, ["scene:002:002"]), memoryJson: JSON.stringify(book.memory) };
    op.plan = { interpretation: "x", changeKind: "narrative", rationale: "x", direct: ["scene:002:002"], indirect: [], global: false, rewriteSceneIds: [], changedFacts: [] };
    const frozen = { frozenAt: book.chapters[1]!.frozenAt, summary: book.chapters[1]!.summary, book: book.bookSummary };
    applyChangePlan(book, op, now);
    expect(book.chapters.map(c => !!c.frozenAt)).toEqual([true, false]);
    book.chapters[1]!.scenes[1]!.text = "Elena capisce che la firma era del sindaco.";
    book.revision = undefined; book.phase = "prose";
    settleAfterRewrite(book, op, now);
    revertChange(book, op, now);
    expect(book.chapters[1]!.scenes[1]!.text).toContain("del Consiglio cittadino");
    // Chapter 2 is the last written chapter and its text is exactly the validated one again.
    expect(book.chapters[1]).toMatchObject({ frozenAt: frozen.frozenAt, summary: frozen.summary });
    expect(book.bookSummary).toBe(frozen.book);
    // A revert touching a chapter followed by other written chapters still sends them back to review.
    const earlier = knowledgeBook();
    const op2 = withOperation(earlier, { target: { kind: "scene", id: "scene:001:002" } });
    op2.before = { scenes: sceneSnapshots(earlier, ["scene:001:002"]), memoryJson: JSON.stringify(earlier.memory) };
    op2.plan = { interpretation: "x", changeKind: "narrative", rationale: "x", direct: ["scene:001:002"], indirect: [], global: false, rewriteSceneIds: [], changedFacts: [] };
    applyChangePlan(earlier, op2, now);
    earlier.revision = undefined; earlier.phase = "prose";
    settleAfterRewrite(earlier, op2, now);
    revertChange(earlier, op2, now);
    expect(earlier.chapters.map(c => !!c.frozenAt)).toEqual([false, false]);
  });
  it("le scene da riscrivere devono esistere, essere scritte e restano in ordine di libro", () => {
    const book = knowledgeBook();
    expect(validRewriteTargets(book, ["scene:002:002", "scene:001:002", "scene:001:002"])).toEqual(["scene:001:002", "scene:002:002"]);
    expect(validRewriteTargets(book, ["scene:001:002"], "scene:001:002")).toEqual([]);
    book.chapters[1]!.scenes[1]!.status = "planned";
    expect(() => validRewriteTargets(book, ["scene:002:002"])).toThrow(/non ancora scritte/);
    expect(() => validRewriteTargets(book, ["scene:404"])).toThrow(/inesistenti/);
  });
  it("una nuova versione della scheda conserva ID e storia; nomi in conflitto sono rifiutati", () => {
    const kb = knowledgeBook().knowledge!;
    const next = replaceEntitySheet(kb, "character:elena", { name: "Elena", summary: "Investigatrice impulsiva.",
      attributes: { personality: "Impulsiva, emotiva", role: "Protagonista" }, relationships: [{ target: "Markus", type: "alleata" }] }, now, "Modifica");
    const elena = next.entities.find(e => e.id === "character:elena")!;
    expect(elena).toMatchObject({ version: 2, origin: "author", status: "validated", summary: "Investigatrice impulsiva." });
    expect(elena.relationships).toEqual([{ targetId: "character:markus", type: "alleata" }]);
    expect(elena.history!.at(-1)!.snapshot.attributes.personality).toBe("Razionale e diffidente");
    expect(() => replaceEntitySheet(kb, "character:elena", { name: "Markus", summary: "x" }, now, "r")).toThrow(/Esiste già/);
    const event = replaceEventSheet(kb, "event:primo-indizio", { title: "Primo indizio", summary: "Una firma bruciata.", narration: "offscreen" }, now, "r")
      .events.find(e => e.id === "event:primo-indizio")!;
    expect(event).toMatchObject({ version: 2, summary: "Una firma bruciata.", narration: "offscreen", causes: ["event:scomparsa-del-fratello"] });
  });
  it("un piano narrativo riapre il capitolo toccato e i successivi; uno stilistico solo il capitolo", () => {
    const narrative = knowledgeBook();
    const op = withOperation(narrative);
    op.plan = { interpretation: "x", changeKind: "narrative", rationale: "Elena agisce prima di pensare.", direct: [], indirect: [], global: false,
      rewriteSceneIds: ["scene:001:002"], changedFacts: [], proposal: { entity: { name: "Elena", summary: "Impulsiva." } } };
    applyChangePlan(narrative, op, now);
    expect(narrative.chapters.map(c => !!c.frozenAt)).toEqual([false, false]);
    expect(narrative.revision!.affectedSceneIds).toEqual(["scene:001:002"]);
    expect(narrative.knowledge!.entities.find(e => e.id === "character:elena")!.summary).toBe("Impulsiva.");
    expect(op.state).toBe("rewriting");
    const style = knowledgeBook();
    reopenForRewrite(style, ["scene:001:002"], "single");
    expect(style.chapters.map(c => !!c.frozenAt)).toEqual([false, true]);
    expect(style.bookSummary).toBe("Elena incontra Markus, che sa del Consiglio.");
    // Reopening the last frozen chapter: its synopsis must not stand as the one «until the previous chapter».
    const last = knowledgeBook();
    reopenForRewrite(last, ["scene:002:001"], "single");
    expect(last.chapters.map(c => !!c.frozenAt)).toEqual([true, false]);
    expect(last.bookSummary).toBe("Elena cerca il fratello e trova un indizio.");
    // Legacy chapters with no snapshot and no synopsis never block a style edit: the synopsis stays as it was.
    const legacy = knowledgeBook();
    legacy.chapters[0]!.bookSummaryAtFreeze = undefined; legacy.chapters[0]!.summary = undefined;
    expect(() => reopenForRewrite(legacy, ["scene:002:001"], "single")).not.toThrow();
    expect(legacy.bookSummary).toBe("Elena incontra Markus, che sa del Consiglio.");
  });
  it("dopo le riscritture la modifica resta in revisione fino al nuovo congelamento, poi è completata", () => {
    const book = knowledgeBook();
    const op = withOperation(book, { state: "rewriting" });
    op.plan = { interpretation: "x", changeKind: "narrative", rationale: "x", direct: [], indirect: [], global: false, rewriteSceneIds: ["scene:002:001"], changedFacts: [] };
    op.before = { scenes: sceneSnapshots(book, ["scene:002:001"]), memoryJson: JSON.stringify(book.memory) };
    book.chapters[1]!.frozenAt = undefined;
    book.chapters[1]!.scenes[0]!.text = "Markus aspetta sul molo, nervoso.";
    book.revision = undefined;
    settleAfterRewrite(book, op, now);
    expect(op.state).toBe("reviewing");
    expect(op.after!.scenes[0]!.text).toBe("Markus aspetta sul molo, nervoso.");
    book.chapters[1]!.frozenAt = now;
    settleChangeOperations(book, now);
    expect(op).toMatchObject({ state: "completed", completedAt: now });
  });
  it("il ripristino riporta scene, scheda e memoria solo se nulla è cambiato dopo", () => {
    const book = knowledgeBook();
    const op = withOperation(book, { state: "completed" });
    op.before = { scenes: sceneSnapshots(book, ["scene:001:002"]), memoryJson: JSON.stringify(book.memory),
      entity: structuredClone(book.knowledge!.entities.find(e => e.id === "character:elena")) };
    op.plan = { interpretation: "x", changeKind: "narrative", rationale: "x", direct: [], indirect: [], global: false, rewriteSceneIds: ["scene:001:002"], changedFacts: [] };
    book.revision = undefined; book.phase = "prose";
    book.chapters[0]!.scenes[1]!.text = "Elena strappa il registro con rabbia.";
    book.knowledge = replaceEntitySheet(book.knowledge!, "character:elena", { name: "Elena", summary: "Impulsiva." }, now, "x");
    book.memory.characters.Elena = "Impulsiva.";
    op.after = { scenes: [{ sceneId: "scene:001:002", text: book.chapters[0]!.scenes[1]!.text }], memoryJson: JSON.stringify(book.memory), entityVersion: 2 };
    book.chapters[0]!.scenes[1]!.text += " Poi esce.";
    expect(revertProblem(book, op)).toMatch(/cambiata dopo/);
    book.chapters[0]!.scenes[1]!.text = "Elena strappa il registro con rabbia.";
    expect(revertProblem(book, op)).toBeUndefined();
    revertChange(book, op, now);
    expect(book.chapters[0]!.scenes[1]!.text).toContain("trova una firma cancellata");
    expect(book.memory.characters.Elena).toBe("Investigatrice, cerca il fratello.");
    const elena = book.knowledge!.entities.find(e => e.id === "character:elena")!;
    expect(elena.summary).toBe("Investigatrice protagonista.");
    expect(elena.version).toBe(3);
    expect(op.state).toBe("reverted");
    expect(book.chapters.map(c => !!c.frozenAt)).toEqual([false, false]);
  });
  it("le copie più vecchie vengono sfoltite per restare nei limiti, senza perdere i metadati", () => {
    const big = "x".repeat(1_400_000); // two copies fit in 3 million characters, three do not
    const ops = [0, 1, 2].map(i => ({ id: crypto.randomUUID(), createdAt: now, updatedAt: now, target: { kind: "scene" as const, id: "s" + i },
      targetLabel: "s", instruction: "Una richiesta.", mode: "auto" as const, state: "completed" as const, report: [],
      before: { scenes: [{ sceneId: "s" + i, chapterId: "c", text: big, status: "canon" as const }] } }));
    const pruned = pruneChangeOperations(ops);
    expect(pruned.map(op => !!op.before.pruned)).toEqual([true, false, false]);
    expect(pruned[0]!.before.scenes).toEqual([]);
    expect(changeOperationSchema.safeParse(pruned[0]).success).toBe(true);
  });
});
