import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, beginNextRound, blockedByRoundLimit, chapterSegments, createEditorialCycle,
  forceCloseCycle, validateJudgment, validateReport,
} from "./editorial-board";
import {
  AUTHOR_CONSTRAINTS_LIMIT, blockedReviewItems, blockedReviewSource, composeBlockedInstruction, constraintsRoom, emptyDraft,
  followDirectorOnAll, itemReady, reviewProgress,
} from "./blocked-review";
import { editorialRecoveryProblem } from "./editorial-recovery";

/** A chapter whose third round (one style finding, rejected by the director) used up the round limit. */
function blockedBook(): BookProject {
  const book = newBook("Mara incontra il guardiano del castello.", "Il segreto del portone", "Sobrio", "Adulti");
  book.phase = "chapterReview"; book.status = "paused";
  book.chapters = [{ id: "c1", number: 1, title: "Il portone", purpose: "Incontrare il guardiano",
    scenes: [{ id: "s1", number: 1, title: "L'arrivo", objective: "Introdurre il mistero",
      text: "Mara incontra il guardiano davanti al portone del castello.", status: "canon" }] }];
  const chapter = book.chapters[0]!;
  const cycle = createEditorialCycle(chapter.id);
  cycle.round = 3;
  const segments = chapterSegments(chapter);
  for (const role of EDITORIAL_ROLES) for (const segment of segments) {
    const finding = role === "style";
    cycle.reports.push(validateReport(cycle, role, segment, segments.length, JSON.stringify(finding ? {
      verdict: "issues", summary: "Lo stile del primo incontro merita un controllo.", memoryNote: "",
      findings: [{ sceneId: segment.sceneId, category: "stile", severity: "minor", evidence: "Mara incontra il guardiano",
        reason: "L'incipit può risultare troppo esplicito nel ritmo.", remediation: "Valutare un'apertura più atmosferica." }],
    } : { verdict: "pass", summary: "Nessun problema narrativo dimostrato.", memoryNote: "", findings: [] }), chapter, book));
  }
  cycle.judgment = validateJudgment(cycle, JSON.stringify({
    reasoning: "La battuta introduttiva è intenzionale e la critica non richiede intervento.",
    decisions: [{ findingId: "3:style:0:0", action: "reject", rationale: "Il ritmo serve ad aprire il mistero senza introdurre un errore.", remediation: "" }],
  }), chapter, book);
  beginNextRound(cycle);
  book.editorialCycle = cycle;
  return book;
}

describe("Tornata bloccata: elenco dei rilievi", () => {
  it("al limite delle tornate la sorgente è l'ultima tornata archiviata", () => {
    const book = blockedBook();
    expect(book.editorialCycle?.stage).toBe("blocked");
    expect(blockedByRoundLimit(book.editorialCycle!)).toBe(true);
    const source = blockedReviewSource(book)!;
    expect(source.kind).toBe("limit");
    expect(source.round).toBe(3);
    const items = blockedReviewItems(book);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: "stile", severity: "minor", sceneLabel: "Scena 1 · L'arrivo", director: { action: "reject" } });
  });
  it("senza ciclo bloccato non c'è nulla da esaminare", () => {
    const book = blockedBook(); book.editorialCycle = undefined;
    expect(blockedReviewSource(book)).toBeUndefined();
    expect(blockedReviewItems(book)).toEqual([]);
  });
});

describe("Bozza e istruzione composta", () => {
  it("la scelta del direttore conta come deciso, una nota personale vuota no", () => {
    const book = blockedBook(); const items = blockedReviewItems(book);
    let draft = emptyDraft("c1", 3);
    expect(reviewProgress(items, draft)).toEqual({ decided: 0, total: 1, complete: false });
    draft = { ...draft, decisions: { [items[0]!.findingId]: { choice: "custom", note: "corto" } } };
    expect(itemReady(draft.decisions[items[0]!.findingId])).toBe(false);
    expect(reviewProgress(items, draft).complete).toBe(false);
    draft = followDirectorOnAll(items, { ...draft, decisions: {} });
    expect(reviewProgress(items, draft).complete).toBe(true);
  });
  it("«accetto tutte» non sovrascrive ciò che l'autore ha già scritto", () => {
    const items = blockedReviewItems(blockedBook());
    const draft = followDirectorOnAll(items, { ...emptyDraft("c1", 3), decisions: { [items[0]!.findingId]: { choice: "custom", note: "Tieni questa apertura così." } } });
    expect(draft.decisions[items[0]!.findingId]?.choice).toBe("custom");
  });
  it("seguire il direttore pesa una riga sola; eccezioni e note viaggiano per intero", () => {
    const book = blockedBook(); const items = blockedReviewItems(book);
    const follow = composeBlockedInstruction(book, items, { ...emptyDraft("c1", 3), decisions: { [items[0]!.findingId]: { choice: "follow_director", note: "" } } });
    expect(follow.text.split("\n")).toHaveLength(2);
    expect(follow.fits).toBe(true);
    const mine = composeBlockedInstruction(book, items, { ...emptyDraft("c1", 3), generalNote: "Più tensione nel finale.",
      decisions: { [items[0]!.findingId]: { choice: "custom", note: "Tieni l'incipit, cambia solo il ritmo." } } });
    expect(mine.text).toContain("Tieni l'incipit, cambia solo il ritmo.");
    expect(mine.text).toContain("Più tensione nel finale.");
    const exception = composeBlockedInstruction(book, items, { ...emptyDraft("c1", 3), decisions: { [items[0]!.findingId]: { choice: "accept_as_is", note: "" } } });
    expect(exception.text).toContain("ACCETTATO COSÌ");
  });
  it("non tronca mai: un testo troppo lungo non entra e lo dichiara", () => {
    const book = blockedBook(); const items = blockedReviewItems(book);
    const long = "x".repeat(AUTHOR_CONSTRAINTS_LIMIT);
    const result = composeBlockedInstruction(book, items, { ...emptyDraft("c1", 3), generalNote: long, decisions: {} });
    expect(result.fits).toBe(false);
    expect(result.text).toContain(long);
  });
  it("lo spazio dei vincoli tiene conto di ciò che c'è già", () => {
    const book = blockedBook();
    const empty = constraintsRoom(book);
    book.authorConstraints = ["y".repeat(3000)];
    expect(constraintsRoom(book)).toBe(empty - 3000);
  });
});

describe("Chiusura senza altra verifica", () => {
  it("manda il capitolo alla sinossi registrando chi ha deciso, senza far scattare il recupero", () => {
    const book = blockedBook(); const cycle = book.editorialCycle!;
    forceCloseCycle(cycle, "author", "Va bene così.", "2026-01-01T00:00:00.000Z");
    expect(cycle.stage).toBe("summary");
    expect(cycle.summaryCursor).toBe(0);
    expect(cycle.forcedClose).toEqual({ at: "2026-01-01T00:00:00.000Z", by: "author", note: "Va bene così." });
    expect(cycle.blockedReason).toBeUndefined();
    expect(editorialRecoveryProblem(book)).toBeUndefined();
  });
  it("senza la chiusura esplicita un riepilogo senza giudizio resta un checkpoint non valido", () => {
    const book = blockedBook(); const cycle = book.editorialCycle!;
    cycle.stage = "summary"; cycle.summaryCursor = 0; delete cycle.blockedReason;
    expect(editorialRecoveryProblem(book)).toBeDefined();
  });
  it("solo un ciclo bloccato si può chiudere così", () => {
    const book = blockedBook(); const cycle = book.editorialCycle!;
    cycle.stage = "review";
    expect(() => forceCloseCycle(cycle, "director", "x", "2026-01-01T00:00:00.000Z")).toThrow(/non è bloccata/);
  });
  it("una nuova tornata cancella la chiusura forzata", () => {
    const book = blockedBook(); const cycle = book.editorialCycle!;
    cycle.stage = "adjudicate"; cycle.forcedClose = { at: "2026-01-01T00:00:00.000Z", by: "director", note: "n" };
    cycle.judgment = { reasoning: "r", decisions: [], verdict: "repair", createdAt: "2026-01-01T00:00:00.000Z" };
    cycle.round = 1;
    beginNextRound(cycle);
    expect(cycle.forcedClose).toBeUndefined();
  });
});
