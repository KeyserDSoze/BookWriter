import type { BookProject } from "./types";
import { parseJsonReply } from "./json-reply";
import { assertScenePlausible } from "./prose-sanity";
import { writerInstructions } from "./editorial-profiles";
import { currentContent, currentStamp, elementReviewState, findScene, pendingElements, setReviewState,
  type BookEdit, type EditTarget, type ReviewState } from "./book-edits";
import { assertEditable, editScene } from "./book-editing";
import { createEditorialCycle } from "./editorial-board";
import { markDownstreamContinuity } from "./cross-chapter-continuity";
import { synopsisBeforeChapter } from "./editorial-summary";
import { activeManualReview, boardReviewChapters, boardReviewUnits, buildReviewUnits, correctionPrompt, correctionTargets, impactPrompt, manualReviewSchema, MAX_REVIEWS,
  MAX_SCENE_CHARS_FOR_CHECK, REVIEW_ENGINES, REVIEW_MODE_LABELS, REVIEW_MODES, REVIEW_SCOPE_LABELS, REVIEW_SCOPES, reviewSystem, reviewUnitPrompt,
  validateImpactReply, validateReviewReply, type ManualReview, type ReviewEngine, type ReviewMode, type ReviewScope, type ReviewUnit } from "./manual-review";

/** The author's review workflow as a small state machine. The runner executes the AI
 * steps (same budget, audit, live view and retries as every task); everything else is
 * local. A review never changes the text in "check" mode and only touches scenes it
 * checked in "auto" mode. */
export const MAX_REVIEW_CORRECTIONS = 60;
export class ManualReviewChanged extends Error {
  constructor() { super("La review è stata annullata o modificata mentre il modello lavorava: risposta scartata."); this.name = "ManualReviewChanged"; }
}
export interface ManualReviewRequest { scope: ReviewScope; mode: ReviewMode; targets: EditTarget[];
  /** Full review only: the editorial board instead of the verifier. */
  engine?: ReviewEngine;
  /** A subset of the selected elements' pending edits (default: all of them). */
  editIds?: string[] }
const sameTarget = (a: EditTarget, b: EditTarget) => a.kind === b.kind && a.id === b.id;
const unitTarget = (unit: ReviewUnit): EditTarget => ({ kind: unit.kind, id: unit.targetId });

/** The board reopens every reviewed chapter from the first frozen one, like «Rivaluta»:
 * the runner then reviews and freezes them again one by one. */
function reopenForBoardReview(book: BookProject): void {
  const chapters = boardReviewChapters(book);
  const first = chapters[0];
  if (!first) return;
  markDownstreamContinuity(book, first, "author_reopen", first.scenes.map(s => s.id));
  first.lastContinuityReview = undefined;
  for (const chapter of book.chapters) if (chapter.number >= first.number) {
    chapter.frozenAt = undefined; chapter.summary = undefined; chapter.bookSummaryAtFreeze = undefined;
  }
  book.bookSummary = synopsisBeforeChapter(book.chapters, first.number);
  book.editorialCycle = createEditorialCycle(first.id, book);
  book.phase = "chapterReview";
  book.currentSceneId = undefined;
  if (book.remote) book.remote.autoSync = false;
}

export function createManualReview(book: BookProject, request: ManualReviewRequest, now: string): ManualReview {
  if (activeManualReview(book)) throw new Error("C'è già una review in corso: attendi che finisca o annullala.");
  if (!REVIEW_SCOPES.includes(request.scope) || !REVIEW_MODES.includes(request.mode)) throw new Error("Tipo di review non valido.");
  const engine = request.engine ?? "verifier";
  if (!REVIEW_ENGINES.includes(engine)) throw new Error("Tipo di review non valido.");
  if (book.editorialReviewSceneIds?.length) throw new Error("Prima conferma le scene fuse nella pagina Libro: l'autopilot non riparte finché attendono.");
  if (engine === "board") {
    if (request.scope !== "full") throw new Error("La redazione completa rilegge tutto il libro: scegli la review completa.");
    if (book.editorialCycle) throw new Error("Una redazione di capitolo è già in corso: attendi che finisca prima di una review completa con la redazione.");
    if (book.revision) throw new Error("Completa prima la revisione o la modifica in corso.");
    if (!boardReviewChapters(book).length) throw new Error("Nessun capitolo revisionato da rileggere: la redazione lavora già capitolo per capitolo durante la scrittura.");
  }
  const targets: EditTarget[] = [];
  for (const target of request.targets) if (!targets.some(t => sameTarget(t, target))) targets.push({ kind: target.kind, id: target.id });
  // A full review reads the whole book: every pending change is settled by it, not only the selected ones.
  if (request.scope === "full") for (const { target } of pendingElements(book))
    if (target.kind !== "profiles" && target.kind !== "memory" && !targets.some(t => sameTarget(t, target)) && targets.length < 200) targets.push({ kind: target.kind, id: target.id });
  if (targets.length > 200) throw new Error("Massimo 200 elementi per review.");
  if (request.scope !== "full" && !targets.length) throw new Error("Scegli almeno un elemento modificato da controllare.");
  if (targets.some(t => t.kind === "profiles")) throw new Error("Le impostazioni degli agenti non si rivedono con una review narrativa.");
  if (targets.some(t => t.kind === "memory")) throw new Error("La memoria narrativa non ha un testo da controllare: usa «Rivedi e aggiorna il libro» dalla modifica, oppure salta la review.");
  const units = request.scope === "impact" ? [] : engine === "board" ? boardReviewUnits(book) : buildReviewUnits(book, request.scope, targets);
  if (request.scope !== "impact" && !units.length) throw new Error("Niente da controllare: gli elementi scelti non hanno testo scritto o non esistono più.");
  const pending = pendingElements(book);
  const all = [...new Set(targets.flatMap(t => pending.find(p => sameTarget(p.target, t))?.edits.map(e => e.id) ?? []))];
  // The author may review only some of an element's changes: the others stay «da rivedere».
  let editIds = all;
  const subset = !!request.editIds && request.scope !== "full";
  if (subset) {
    const chosen = new Set(request.editIds);
    if (request.editIds!.some(id => !all.includes(id))) throw new Error("Una modifica scelta non è più da rivedere: aggiorna la pagina e scegli di nuovo.");
    editIds = all.filter(id => chosen.has(id));
    for (const target of targets) {
      const own = pending.find(p => sameTarget(p.target, target));
      if (own?.edits.length && !own.edits.some(e => chosen.has(e.id))) throw new Error(`Per «${own.label}» scegli almeno una modifica, oppure togli l'elemento.`);
    }
  }
  const review = manualReviewSchema.parse({
    id: crypto.randomUUID(), createdAt: now, scope: request.scope, mode: request.scope === "impact" ? "check" : request.mode,
    ...(engine === "board" ? { engine } : {}),
    targets: targets.map(t => ({ ...t, stamp: currentStamp(book, t) })), editIds, units, stage: "check", cursor: 0, status: "pending",
    findings: [], proposals: [], pauseAfter: book.status !== "running",
  } satisfies ManualReview);
  // Older finished reviews give way first; the active one is always the newest.
  book.manualReviews = [...(book.manualReviews ?? []), review].slice(-MAX_REVIEWS);
  const state = request.scope === "impact" ? "impact_pending" : "review_pending";
  if (subset && editIds.length !== all.length) {
    for (const edit of book.edits ?? []) if (editIds.includes(edit.id)) { edit.reviewState = state; edit.reviewId = review.id; delete edit.reviewedStamp; }
  } else setReviewState(book, targets, state, review.id);
  if (engine === "board") reopenForBoardReview(book);
  return review;
}

/** Edits that belong to a review: their state changes only through it. */
function reviewEdits(book: BookProject, review: ManualReview, target?: EditTarget): BookEdit[] {
  return (book.edits ?? []).filter(edit => (edit.reviewId === review.id || review.editIds.includes(edit.id)) && (!target || sameTarget(edit.target, target)));
}
function markEdits(edits: readonly BookEdit[], state: ReviewState, reviewId: string, stamp?: string): void {
  for (const edit of edits) {
    edit.reviewState = state; edit.reviewId = reviewId;
    if (stamp && (state === "review_passed" || state === "review_skipped")) edit.reviewedStamp = stamp;
    else delete edit.reviewedStamp;
  }
}
/** What the book does when the review ends: back to where the author left it. */
function settleRun(book: BookProject, review: ManualReview): void {
  if (!review.pauseAfter || book.status !== "running") return;
  book.status = book.phase === "completed" ? "completed" : "paused";
  book.previousError = undefined;
}

export function cancelManualReview(book: BookProject, reviewId: string, now: string): void {
  const review = book.manualReviews?.find(r => r.id === reviewId);
  if (!review || (review.status !== "pending" && review.status !== "in_progress")) throw new Error("Questa review non è più in corso.");
  review.status = "cancelled"; review.stage = "done"; review.completedAt = now;
  markEdits(reviewEdits(book, review).filter(e => ["impact_pending", "review_pending", "review_in_progress"].includes(e.reviewState)), "modified_unreviewed", review.id);
  settleRun(book, review);
}

/** Close the review: per-element states bound to the exact content that was read. */
function finalize(book: BookProject, review: ManualReview, now: string): string {
  review.stage = "done"; review.status = "completed"; review.completedAt = now;
  if (review.engine === "board") {
    // The board froze again every chapter it reread: what it read is validated.
    review.outcome = "passed";
    for (const unit of review.units) { unit.status = "done"; unit.stamp = currentStamp(book, unitTarget(unit)); }
    for (const target of review.targets) markEdits(reviewEdits(book, review, target), "review_passed", review.id, currentStamp(book, target));
    const rounds = review.units.reduce((n, u) => n + (book.chapters.find(c => c.id === u.targetId)?.editorialRounds?.length ? 1 : 0), 0);
    review.summary = `La redazione ha riletto e congelato di nuovo ${review.units.length} ${review.units.length === 1 ? "capitolo" : "capitoli"}` +
      (rounds ? ": rapporti e giudizi sono nella Redazione di ciascun capitolo." : ".");
    // A finished book goes back to «completed», as the author left it.
    if (book.chapters.length && !book.revision && book.chapters.every(c => !!c.frozenAt && c.scenes.every(s => s.status === "canon"))) book.phase = "completed";
    settleRun(book, review);
    return review.summary;
  }
  if (review.scope === "impact") {
    review.outcome = "analysis";
    markEdits(reviewEdits(book, review).filter(e => e.reviewState === "impact_pending"), "modified_unreviewed", review.id);
    settleRun(book, review);
    return review.summary ?? "Analisi d'impatto completata.";
  }
  const anyFinding = review.findings.length > 0;
  review.outcome = anyFinding ? "failed" : "passed";
  for (const target of review.targets) {
    const unit = review.units.find(u => sameTarget(unitTarget(u), target));
    const edits = reviewEdits(book, review, target);
    if (unit && unit.status !== "done") { markEdits(edits, "modified_unreviewed", review.id); continue; }
    const checked = unit?.stamp ?? target.stamp;
    if (!unit && currentStamp(book, target) !== checked) { markEdits(edits, "modified_unreviewed", review.id); continue; }
    const own = unit ? review.findings.some(f => f.unitKey === unit.key) : anyFinding;
    const failed = own || (review.scope === "extended" && anyFinding);
    markEdits(edits, failed ? "review_failed" : "review_passed", review.id, checked);
  }
  // A frozen chapter's validation is current again only when every listed edit passed.
  for (const chapter of book.chapters) {
    if (!chapter.reviewStale) continue;
    const open = chapter.reviewStale.editIds.filter(id => {
      const edit = book.edits?.find(e => e.id === id);
      return edit ? elementReviewState(book, edit.target) !== "review_passed" : false;
    });
    if (open.length) chapter.reviewStale = { ...chapter.reviewStale, editIds: open };
    else delete chapter.reviewStale;
  }
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const finding of review.findings) counts[finding.severity]++;
  const checkedUnits = review.units.filter(u => u.status === "done").length;
  const skipped = review.units.length - checkedUnits;
  const proposals = review.proposals.filter(p => p.status === "proposed").length;
  const applied = review.proposals.filter(p => p.status === "applied").length;
  review.summary = [
    `${checkedUnits} ${checkedUnits === 1 ? "elemento controllato" : "elementi controllati"}` + (skipped ? `, ${skipped} non controllabili` : "") + ".",
    anyFinding ? `${review.findings.length} ${review.findings.length === 1 ? "problema" : "problemi"} (${counts.critical} critici, ${counts.major} importanti, ${counts.minor} minori).` : "Nessun problema trovato.",
    proposals ? `${proposals} ${proposals === 1 ? "correzione da approvare" : "correzioni da approvare"}.` : "",
    applied ? `${applied} ${applied === 1 ? "scena corretta automaticamente" : "scene corrette automaticamente"}: restano da rivedere.` : "",
  ].filter(Boolean).join(" ");
  settleRun(book, review);
  return review.summary;
}

export interface ManualReviewLocalStep { type: "local"; title: string; reason: string; nextStep: string; run: (book: BookProject, now: string) => string }
export interface ManualReviewAiStep {
  type: "ai"; kind: "revision" | "chapterAudit" | "chapterRepair"; title: string; reason: string; nextStep: string;
  system: string; prompt: string; apply: (book: BookProject, text: string, now: string) => void;
}
export type ManualReviewStep = ManualReviewLocalStep | ManualReviewAiStep;

/** The review in the book being changed, still at the step the prompt was built for. */
function current(book: BookProject, id: string, stage: ManualReview["stage"], cursor: number): ManualReview {
  const review = book.manualReviews?.find(r => r.id === id);
  if (!review || review.status !== "in_progress" || review.stage !== stage || review.cursor !== cursor) throw new ManualReviewChanged();
  return review;
}
const correctionsOf = (review: ManualReview) => correctionTargets(review).slice(0, MAX_REVIEW_CORRECTIONS);

/** Next step of the active review, or undefined. Never throws for content problems:
 * an element that cannot be checked is skipped with a note. */
export function nextManualReviewStep(book: BookProject): ManualReviewStep | undefined {
  const review = activeManualReview(book);
  if (!review) return undefined;
  const scope = REVIEW_SCOPE_LABELS[review.scope].label, id = review.id;
  if (review.status === "pending") return { type: "local", title: "Review avviata: " + scope.toLowerCase(),
    reason: "Richiesta dall'autore dopo le sue modifiche (" + REVIEW_MODE_LABELS[review.mode].label.toLowerCase() + ").",
    nextStep: review.scope === "impact" ? "Analisi delle conseguenze delle modifiche." : `Controllo di ${review.units.length} elementi.`,
    run: b => {
      const r = b.manualReviews!.find(x => x.id === id)!;
      r.status = "in_progress";
      if (r.scope !== "impact") markEdits(reviewEdits(b, r).filter(e => e.reviewState === "review_pending"), "review_in_progress", id);
      return "Review avviata.";
    } };
  // The board review runs as ordinary board steps; it ends when every reread chapter is frozen again.
  if (review.engine === "board") {
    const settled = !book.editorialCycle && review.units.every(u => { const ch = book.chapters.find(c => c.id === u.targetId); return !ch || !!ch.frozenAt; });
    if (!settled) return undefined;
    return { type: "local", title: "Review completata: redazione completa", reason: "Ogni capitolo riletto è stato congelato di nuovo dalla redazione.",
      nextStep: review.pauseAfter ? "Il libro torna come l'avevi lasciato." : "L'autopilot riprende il suo lavoro.",
      run: (b, now) => finalize(b, current(b, id, "check", review.cursor), now) };
  }
  if (review.stage === "check" && review.scope === "impact") return {
    type: "ai", kind: "revision", title: "Analisi d'impatto delle tue modifiche",
    reason: "Trova le conseguenze possibili prima di qualunque review o riscrittura.", nextStep: "Rapporto d'impatto: decidi tu cosa controllare.",
    system: "Sei l'editor che valuta l'impatto delle modifiche dell'autore su un romanzo. Non riscrivi e non correggi nulla. Rispondi solo nel formato richiesto.",
    prompt: impactPrompt(book, review),
    apply: (b, text, now) => {
      const r = current(b, id, "check", review.cursor);
      const result = validateImpactReply(b, r, parseJsonReply(text));
      r.impacts = result.impacts; r.summary = result.summary;
      for (const edit of b.edits ?? []) { const kind = result.kinds.get(edit.id); if (kind) edit.changeKind = kind; }
      finalize(b, r, now);
    },
  };
  if (review.stage === "check") {
    const unit = review.units[review.cursor];
    if (!unit) {
      const corrections = review.mode !== "check" ? correctionsOf(review) : [];
      if (corrections.length) return { type: "local", title: "Review: inizio delle correzioni",
        reason: `Il controllo ha trovato problemi in ${corrections.length} ${corrections.length === 1 ? "scena" : "scene"}.`,
        nextStep: review.mode === "auto" ? "Correzione automatica delle scene della review." : "Preparazione delle proposte da approvare.",
        run: b => { const r = current(b, id, "check", review.cursor); r.stage = "correct"; r.cursor = 0; return "Controllo completato, inizio delle correzioni."; } };
      return { type: "local", title: "Review completata: " + scope.toLowerCase(), reason: "Esito per ogni elemento, legato alla versione controllata.",
        nextStep: review.pauseAfter ? "Il libro torna come l'avevi lasciato." : "L'autopilot riprende il suo lavoro.",
        run: (b, now) => finalize(b, current(b, id, "check", review.cursor), now) };
    }
    const cursor = review.cursor;
    let prompt: ReturnType<typeof reviewUnitPrompt>;
    try { prompt = reviewUnitPrompt(book, review, unit); }
    catch (error) {
      const note = (error instanceof Error ? error.message : "Elemento non controllabile.").slice(0, 500);
      return { type: "local", title: "Review: elemento saltato — " + unit.label, reason: note, nextStep: "Prossimo elemento della review.",
        run: b => { const r = current(b, id, "check", cursor); const u = r.units[cursor]!; u.status = "failed"; u.note = note; r.cursor++; return note; } };
    }
    return {
      type: "ai", kind: "chapterAudit", title: `Review ${cursor + 1}/${review.units.length}: ${unit.label}`,
      reason: unit.edited ? "Elemento modificato: verifica di coerenza con la checklist e il direttore." : "Elemento collegato alle modifiche: possibili conseguenze.",
      nextStep: cursor + 1 < review.units.length ? "Prossimo elemento della review." : "Esito della review.",
      system: reviewSystem(book), prompt: prompt.prompt,
      apply: (b, text) => {
        const r = current(b, id, "check", cursor);
        const u = r.units[cursor]!;
        if (u.key !== unit.key) throw new ManualReviewChanged();
        const result = validateReviewReply(b, u, prompt.sceneIds, parseJsonReply(text), prompt.summaryFor);
        r.findings = [...r.findings, ...result.findings].slice(0, 800);
        u.status = "done"; u.note = result.summary.slice(0, 500);
        if (result.sceneSummary && prompt.summaryFor) {
          const found = findScene(b, prompt.summaryFor);
          if (found) { found.scene.summary = result.sceneSummary; delete found.scene.summaryStale; }
        }
        // The review is bound to exactly what it read (including a summary it refreshed).
        u.stamp = currentStamp(b, unitTarget(u));
        r.cursor++;
      },
    };
  }
  if (review.stage === "correct") {
    const corrections = correctionsOf(review);
    const target = corrections[review.cursor];
    const cursor = review.cursor;
    if (!target) return { type: "local", title: "Review completata: " + scope.toLowerCase(), reason: "Esito per ogni elemento e correzioni registrate.",
      nextStep: review.pauseAfter ? "Il libro torna come l'avevi lasciato." : "L'autopilot riprende il suo lavoro.",
      run: (b, now) => finalize(b, current(b, id, "correct", cursor), now) };
    const found = findScene(book, target.sceneId);
    const unit = review.units.find(u => u.kind === "scene" && u.targetId === target.sceneId);
    let skip = "";
    if (!found) skip = "La scena non esiste più.";
    else if (unit && unit.stamp !== currentStamp(book, unitTarget(unit))) skip = "La scena è cambiata dopo il controllo: nessuna correzione sul testo nuovo.";
    else if (found.scene.text.length > MAX_SCENE_CHARS_FOR_CHECK) skip = "Scena troppo lunga per una correzione singola.";
    else { try { assertEditable(book, [target.sceneId]); } catch (error) { skip = error instanceof Error ? error.message : "Scena non modificabile ora."; } }
    if (skip) return { type: "local", title: "Review: correzione saltata", reason: skip, nextStep: "Prossima correzione della review.",
      run: b => { current(b, id, "correct", cursor).cursor++; return skip; } };
    const label = `Cap. ${found!.chapter.number} · ${found!.scene.number}. ${found!.scene.title}`;
    return {
      type: "ai", kind: "chapterRepair", title: `Correzione ${cursor + 1}/${corrections.length}: ${label}`,
      reason: `${target.findings.length} ${target.findings.length === 1 ? "problema trovato" : "problemi trovati"} dalla review.`,
      nextStep: review.mode === "auto" ? "La correzione viene applicata e resta annullabile." : "La proposta attende la tua approvazione.",
      system: ["Sei il romanziere che corregge una scena dopo una review chiesta dall'autore. Correggi solo i problemi indicati e restituisci SOLO la prosa completa della scena.",
        writerInstructions(book.editorialProfiles), book.writingStyle ? "Stile del libro: " + book.writingStyle : ""].filter(Boolean).join("\n"),
      prompt: correctionPrompt(book, target.sceneId, target.findings),
      apply: (b, text, now) => {
        const r = current(b, id, "correct", cursor);
        const scene = findScene(b, target.sceneId)?.scene;
        if (!scene) throw new ManualReviewChanged();
        assertScenePlausible(text, scene.text);
        const corrected = text.trim();
        const base = { id: crypto.randomUUID(), sceneId: target.sceneId, beforeStamp: currentStamp(b, { kind: "scene", id: target.sceneId }),
          text: corrected, findingIds: target.findings.map(f => f.id).slice(0, 60) };
        if (corrected !== scene.text.trim()) {
          if (r.mode === "auto") {
            editScene(b, target.sceneId, { text: corrected }, { now, origin: "ai",
              prompt: "Correzione automatica della review: " + target.findings.map(f => f.issue).join(" · ").slice(0, 3500) });
            r.proposals.push({ ...base, status: "applied" });
          } else r.proposals.push({ ...base, status: "proposed" });
        }
        r.cursor++;
      },
    };
  }
  return undefined;
}

/** Apply or discard one proposed correction. Applying is an AI edit (unreviewed). */
export function decideReviewProposal(book: BookProject, reviewId: string, proposalId: string, accept: boolean, now: string): BookEdit | undefined {
  const review = book.manualReviews?.find(r => r.id === reviewId);
  const proposal = review?.proposals.find(p => p.id === proposalId);
  if (!review || !proposal || proposal.status !== "proposed") throw new Error("Proposta non più disponibile.");
  if (!accept) { proposal.status = "rejected"; return undefined; }
  if (currentContent(book, { kind: "scene", id: proposal.sceneId }) === undefined) throw new Error("La scena non esiste più.");
  if (currentStamp(book, { kind: "scene", id: proposal.sceneId }) !== proposal.beforeStamp)
    throw new Error("La scena è cambiata dopo la proposta: non la applico per non perdere le modifiche. Rifai la review.");
  const findings = review.findings.filter(f => proposal.findingIds.includes(f.id)).map(f => f.issue).join(" · ");
  const edit = editScene(book, proposal.sceneId, { text: proposal.text }, { now, origin: "ai", prompt: ("Correzione approvata dalla review: " + findings).slice(0, 4000) });
  proposal.status = "applied";
  return edit;
}

/** An archive or repository never resumes a review by itself: it is interrupted and its
 * edits are unreviewed again. The author can request it anew. */
export function interruptImportedReviews(book: BookProject, now: string): void {
  for (const review of book.manualReviews ?? []) {
    if (review.status !== "pending" && review.status !== "in_progress") continue;
    review.status = "cancelled"; review.stage = "done"; review.completedAt = now;
    review.error = "Review interrotta dall'importazione: richiedila di nuovo se serve.";
  }
  for (const edit of book.edits ?? [])
    if (["impact_pending", "review_pending", "review_in_progress"].includes(edit.reviewState)) { edit.reviewState = "modified_unreviewed"; delete edit.reviewedStamp; }
}

/** Plain-language view of the active review, for the dashboard. */
export function describeManualReview(book: BookProject, review: ManualReview): { headline: string; detail: string } {
  const mode = REVIEW_MODE_LABELS[review.mode].label;
  if (review.engine === "board") {
    const frozen = review.units.filter(u => book.chapters.find(c => c.id === u.targetId)?.frozenAt).length;
    return { headline: `Review completa con la redazione: ${frozen} di ${review.units.length} ${review.units.length === 1 ? "capitolo congelato" : "capitoli congelati"} di nuovo.`,
      detail: "Specialisti, lettori e direttore rileggono un capitolo alla volta; le correzioni passano dal loro giudizio." };
  }
  if (review.scope === "impact") return { headline: "Analisi d'impatto delle tue modifiche.", detail: "Trova le conseguenze possibili; non cambia il testo." };
  if (review.stage === "correct") {
    const total = correctionsOf(review).length;
    return { headline: `Correzioni della review: ${Math.min(review.cursor + 1, total)} di ${total}.`,
      detail: review.mode === "auto" ? "Le correzioni vengono applicate e restano annullabili." : "Le proposte attendono la tua approvazione." };
  }
  const unit = review.units[review.cursor];
  return { headline: unit ? `Review richiesta da te: elemento ${review.cursor + 1} di ${review.units.length} — ${unit.label}.` : "Review richiesta da te: esito in preparazione.",
    detail: REVIEW_SCOPE_LABELS[review.scope].label + " · " + mode + "." };
}
