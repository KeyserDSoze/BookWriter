import { z } from "zod";
import type { BookProject, Chapter } from "./types";
import { contentStamp, currentContent, currentStamp, findScene, pendingElements, type BookEdit, type EditChangeKind, type EditTarget, CHANGE_KINDS } from "./book-edits";
import { describeEntities, describeEvents } from "./knowledge";
import { dependentEvents, entityReferences, relevantKnowledge } from "./knowledge-index";
import { directorInstructions, writerInstructions, writerRules } from "./editorial-profiles";
import { chapterSegments, createEditorialCycle, cycleRoles } from "./editorial-board";

/** A review the AUTHOR asked for after editing. It never starts by itself.
 * Check: reads and reports, never changes the book. Propose: also prepares
 * corrected scenes for approval. Auto: applies those corrections inside its scope.
 * A review is bound to the exact content stamps it read. */
export const REVIEW_SCOPES = ["impact", "targeted", "extended", "full"] as const;
export type ReviewScope = typeof REVIEW_SCOPES[number];
export const REVIEW_MODES = ["check", "propose", "auto"] as const;
export type ReviewMode = typeof REVIEW_MODES[number];
export const REVIEW_SCOPE_LABELS: Record<ReviewScope, { label: string; hint: string }> = {
  impact: { label: "Analizza impatto", hint: "Trova le possibili conseguenze, senza controllare né cambiare il testo." },
  targeted: { label: "Review mirata", hint: "Controlla solo gli elementi modificati selezionati." },
  extended: { label: "Review estesa", hint: "Anche gli elementi collegati e le dipendenze indirette." },
  full: { label: "Review completa", hint: "Ogni scena scritta del libro, con la checklist e il direttore attivi." },
};
export const REVIEW_MODE_LABELS: Record<ReviewMode, { label: string; hint: string }> = {
  check: { label: "Solo controllo", hint: "Un rapporto con problemi e suggerimenti. Il testo non cambia." },
  propose: { label: "Proposte da approvare", hint: "Prepara le scene corrette: le applichi tu, una per una." },
  auto: { label: "Correzioni automatiche", hint: "Applica le correzioni alle scene della review; restano annullabili." },
};
export const MAX_REVIEW_UNITS = 400;
export const MAX_REVIEWS = 30;
export const MAX_SCENE_CHARS_FOR_CHECK = 60_000;
/** Who reads a full review: the single verifier (one call per scene) or the whole editorial
 * board, which reopens the reviewed chapters and freezes them again one by one. */
export const REVIEW_ENGINES = ["verifier", "board"] as const;
export type ReviewEngine = typeof REVIEW_ENGINES[number];
export const REVIEW_ENGINE_LABELS: Record<ReviewEngine, { label: string; hint: string }> = {
  verifier: { label: "Verificatore", hint: "Una chiamata per scena: controllo rapido con checklist e direttore." },
  board: { label: "Redazione completa", hint: "Specialisti, lettori e direttore rileggono ogni capitolo dal primo revisionato; possono correggere il testo." },
};
const iso = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const id = z.string().min(1).max(200);
const unitSchema = z.object({
  key: z.string().max(220), kind: z.enum(["scene", "entity", "event", "chapter"]), targetId: id, label: z.string().max(200),
  /** Content stamp when this unit was checked (or requested). */
  stamp: z.string().max(40),
  status: z.enum(["pending", "done", "failed", "skipped"]), note: z.string().max(500).optional(),
  /** Explicitly part of the author's edits (others are dependencies). */
  edited: z.boolean(),
}).strict();
const findingSchema = z.object({
  id: z.string().max(80), unitKey: z.string().max(220), severity: z.enum(["critical", "major", "minor"]),
  category: z.string().min(2).max(60), sceneId: id.optional(), evidence: z.string().max(1100).optional(),
  issue: z.string().min(8).max(1500), suggestion: z.string().min(4).max(1800), ruleId: z.string().max(80).optional(),
}).strict();
const impactSchema = z.object({
  targetKind: z.enum(["scene", "entity", "event", "chapter"]), targetId: id, label: z.string().max(200),
  risk: z.enum(["high", "medium", "low"]), reason: z.string().min(8).max(800),
}).strict();
const proposalSchema = z.object({
  id: z.string().uuid(), sceneId: id, beforeStamp: z.string().max(40), text: z.string().max(2_000_000),
  findingIds: z.array(z.string().max(80)).max(60), status: z.enum(["proposed", "applied", "rejected", "stale"]),
  activityId: z.string().max(300).optional(),
}).strict();
export const manualReviewSchema = z.object({
  id: z.string().uuid(), createdAt: iso, scope: z.enum(REVIEW_SCOPES), mode: z.enum(REVIEW_MODES),
  /** Absent: the verifier (reviews created before 0.22). */
  engine: z.enum(REVIEW_ENGINES).optional(),
  targets: z.array(z.object({ kind: z.enum(["scene", "chapter", "entity", "event", "timeline", "structure", "profiles", "memory"]), id,
    /** Content stamp when the author asked: what the review is about. */
    stamp: z.string().max(40) }).strict()).max(200),
  editIds: z.array(z.string().uuid()).max(400),
  units: z.array(unitSchema).max(MAX_REVIEW_UNITS),
  stage: z.enum(["check", "correct", "done"]), cursor: z.number().int().min(0).max(MAX_REVIEW_UNITS),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  outcome: z.enum(["passed", "failed", "analysis"]).optional(),
  findings: z.array(findingSchema).max(800),
  impacts: z.array(impactSchema).max(200).optional(),
  summary: z.string().max(3000).optional(),
  proposals: z.array(proposalSchema).max(200),
  /** The book was not running when the author asked: pause again at the end. */
  pauseAfter: z.boolean(),
  completedAt: iso.optional(), error: z.string().max(1000).optional(),
}).strict();
export type ManualReview = z.infer<typeof manualReviewSchema>;
export type ReviewUnit = z.infer<typeof unitSchema>;
export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewImpact = z.infer<typeof impactSchema>;
export type ReviewProposal = z.infer<typeof proposalSchema>;

export function activeManualReview(book: BookProject): ManualReview | undefined {
  return book.manualReviews?.find(r => r.status === "pending" || r.status === "in_progress");
}
const writtenScenes = (book: BookProject) => [...book.chapters].sort((a, b) => a.number - b.number)
  .flatMap(ch => [...ch.scenes].sort((a, b) => a.number - b.number).filter(s => s.status !== "planned" && s.text.trim()).map(scene => ({ chapter: ch, scene })));
function unitFor(book: BookProject, kind: ReviewUnit["kind"], targetId: string, edited: boolean): ReviewUnit | undefined {
  const target: EditTarget = { kind, id: targetId };
  if (currentContent(book, target) === undefined) return undefined;
  let label = targetId;
  if (kind === "scene") { const found = findScene(book, targetId)!; if (found.scene.status === "planned" || !found.scene.text.trim()) return undefined; label = `Cap. ${found.chapter.number} · ${found.scene.number}. ${found.scene.title}`; }
  if (kind === "chapter") { const ch = book.chapters.find(c => c.id === targetId)!; label = `Capitolo ${ch.number} — ${ch.title}`; }
  if (kind === "entity") label = book.knowledge?.entities.find(e => e.id === targetId)?.name ?? targetId;
  if (kind === "event") label = book.knowledge?.events.find(e => e.id === targetId)?.title ?? targetId;
  return { key: kind + "|" + targetId, kind, targetId, label: label.slice(0, 200), stamp: currentStamp(book, target), status: "pending", edited };
}
/** Deterministic, AI-free dependencies of edited elements (lexical/structural hints). */
export function dependencyUnits(book: BookProject, targets: readonly EditTarget[]): ReviewUnit[] {
  const out: ReviewUnit[] = [];
  const add = (kind: ReviewUnit["kind"], targetId: string) => {
    if (out.some(u => u.kind === kind && u.targetId === targetId) || targets.some(t => t.kind === kind && t.id === targetId)) return;
    const unit = unitFor(book, kind, targetId, false);
    if (unit) out.push(unit);
  };
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const flat = writtenScenes(book);
  for (const target of targets) {
    if (target.kind === "scene") {
      const index = flat.findIndex(x => x.scene.id === target.id);
      for (const next of flat.slice(index + 1, index + 3)) add("scene", next.scene.id);
      if (kb) for (const event of kb.events.filter(e => e.sceneIds.includes(target.id)))
        for (const dependent of dependentEvents(kb, event.id)) for (const sceneId of dependent.sceneIds) add("scene", sceneId);
    } else if (target.kind === "entity" && kb) {
      const entity = kb.entities.find(e => e.id === target.id);
      if (entity) for (const ref of entityReferences(book, kb, entity)) if (ref.via !== "event") add("scene", ref.sceneId);
      for (const related of kb.entities.filter(e => e.relationships.some(r => r.targetId === target.id))) add("entity", related.id);
    } else if (target.kind === "event" && kb) {
      const event = kb.events.find(e => e.id === target.id);
      if (event) for (const sceneId of event.sceneIds) add("scene", sceneId);
      for (const dependent of dependentEvents(kb, target.id)) { add("event", dependent.id); for (const sceneId of dependent.sceneIds) add("scene", sceneId); }
    } else if (target.kind === "chapter" || target.kind === "structure") {
      const chapters = target.kind === "chapter" ? book.chapters.filter(c => c.id === target.id) : [];
      for (const chapter of chapters) for (const scene of chapter.scenes) add("scene", scene.id);
    }
    if (out.length >= 60) break;
  }
  return out.slice(0, 60);
}
/** A structural edit is checked on what it touched: the moved or added scenes and their chapters. */
function structureUnits(book: BookProject): ReviewUnit[] {
  const related = new Set((pendingElements(book).find(p => p.target.kind === "structure")?.edits ?? []).flatMap(e => e.related));
  const units = [...book.chapters.filter(c => related.has(c.id)).map(c => unitFor(book, "chapter", c.id, true)),
    ...[...related].filter(id => findScene(book, id)).map(id => unitFor(book, "scene", id, true))];
  return units.filter((u): u is ReviewUnit => !!u);
}
/** The units a review will check, in book order: edited elements first. */
export function buildReviewUnits(book: BookProject, scope: ReviewScope, targets: readonly EditTarget[]): ReviewUnit[] {
  const units: ReviewUnit[] = [];
  const push = (unit: ReviewUnit | undefined) => { if (unit && !units.some(u => u.key === unit.key)) units.push(unit); };
  for (const target of targets) {
    if (target.kind === "scene" || target.kind === "entity" || target.kind === "event" || target.kind === "chapter") push(unitFor(book, target.kind, target.id, true));
    else if (target.kind === "timeline") for (const event of book.knowledge?.events.filter(e => e.timelineIds.includes(target.id)) ?? []) push(unitFor(book, "event", event.id, true));
    else if (target.kind === "structure") for (const unit of structureUnits(book)) push(unit);
  }
  if (scope === "extended") for (const unit of dependencyUnits(book, targets)) push(unit);
  if (scope === "full") for (const { scene } of writtenScenes(book)) push(unitFor(book, "scene", scene.id, false));
  if (units.length > MAX_REVIEW_UNITS) throw new Error(`Troppi elementi da rivedere (${units.length}): massimo ${MAX_REVIEW_UNITS}. Scegli una review più mirata.`);
  return units;
}
/** AI calls a review will make at most (before corrections). */
export function estimateReviewCalls(book: BookProject, scope: ReviewScope, targets: readonly EditTarget[]): number {
  if (scope === "impact") return 1;
  try { return buildReviewUnits(book, scope, targets).length; } catch { return MAX_REVIEW_UNITS + 1; }
}
/** Chapters a board review rereads: from the first frozen chapter, every chapter whose scenes are
 * all canon (a chapter still being written is reviewed by the board when the writing ends). */
export function boardReviewChapters(book: BookProject): Chapter[] {
  const sorted = [...book.chapters].sort((a, b) => a.number - b.number);
  const first = sorted.find(c => c.frozenAt);
  if (!first) return [];
  return sorted.filter(c => c.number >= first.number && c.scenes.length > 0 && c.scenes.every(s => s.status === "canon" && s.text.trim()));
}
/** One unit per chapter the board rereads: its progress is the chapter frozen again. */
export function boardReviewUnits(book: BookProject): ReviewUnit[] {
  return boardReviewChapters(book).map(c => unitFor(book, "chapter", c.id, false)).filter((u): u is ReviewUnit => !!u);
}
/** Calls of one board pass (reviewers × segments, judge, synopsis): a floor, before corrections and new rounds. */
export function estimateBoardCalls(book: BookProject): number {
  let calls = 0;
  for (const chapter of boardReviewChapters(book)) {
    let segments = 1, roles = 12;
    try { segments = chapterSegments(chapter).length; roles = cycleRoles(book, createEditorialCycle(chapter.id, book)).length; } catch { /* estimate only */ }
    calls += segments * roles + 1 + segments;
  }
  return calls;
}

/* ---------------------------------- prompts --------------------------------- */

const REVIEW_REPLY = '{"verdict":"pass|issues","summary":"sintesi del controllo","findings":[{"sceneId":"ID della scena se il problema è nel testo","severity":"critical|major|minor","category":"continuity|timeline|secrets|character|style|rule|knowledge","evidence":"citazione LETTERALE di 12+ caratteri dalla scena indicata","issue":"cosa non va","suggestion":"come correggerlo","ruleId":"id della regola, solo per le regole dello scrittore"}],"sceneSummary":"riassunto fedele della scena in 2-4 frasi, solo se richiesto"}';
export function reviewSystem(book: BookProject): string {
  const profiles = book.editorialProfiles;
  return [
    "Sei il verificatore editoriale indipendente di un romanzo. Controlli contenuti che l'autore (o l'AI su sua richiesta) ha modificato, senza riscriverli.",
    "Usa insieme queste lenti: continuità e fatti rispetto alle schede e alle scene vicine, cronologia, segreti e spoiler prematuri, voce e comportamento dei personaggi, stile e regole dello scrittore.",
    "Le scelte dell'autore sono la nuova verità: segnala solo incongruenze concrete che ne derivano o che restano nel testo, non preferenze personali, e non chiedere di annullare la modifica.",
    "Ogni rilievo su un testo cita letteralmente (12+ caratteri) la scena indicata con sceneId; un rilievo sulla sola scheda omette sceneId ed evidence.",
    "Rispondi SOLO con JSON valido: " + REVIEW_REPLY,
    writerInstructions(profiles, true), directorInstructions(profiles),
  ].filter(Boolean).join("\n");
}
const bounded = (text: string, max: number) => text.length <= max ? text : text.slice(0, max) + "\n[…]";
function editLines(edits: readonly BookEdit[]): string {
  return edits.slice(-8).map(edit => `- ${edit.origin === "ai" ? "Modifica AI" : "Modifica manuale"} (${edit.field}, ${edit.changeKind})` +
    (edit.prompt ? ` con la richiesta «${edit.prompt.slice(0, 300)}»` : "") + ` il ${edit.at.slice(0, 16).replace("T", " ")}`).join("\n");
}
function windowsAround(text: string, names: readonly string[], max = 1500): string {
  if (text.length <= max * 2) return text;
  const lower = text.toLocaleLowerCase("it");
  const hit = names.map(n => lower.indexOf(n.toLocaleLowerCase("it"))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - max / 2);
  return (start > 0 ? "[…] " : "") + text.slice(start, start + max) + " […]";
}
export interface ReviewPrompt { prompt: string; sceneIds: string[]; summaryFor?: string }
/** Prompt for one unit. Throws (without truncating) when the scene is too long to check alone. */
export function reviewUnitPrompt(book: BookProject, review: ManualReview, unit: ReviewUnit): ReviewPrompt {
  const edits = (book.edits ?? []).filter(e => review.editIds.includes(e.id) && e.target.kind === unit.kind && e.target.id === unit.targetId);
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const constraints = book.authorConstraints.length ? "VINCOLI DELL'AUTORE:\n" + book.authorConstraints.join("\n") : "";
  if (unit.kind === "scene") {
    const found = findScene(book, unit.targetId);
    if (!found) throw new Error("Scena non più presente.");
    const { chapter, scene } = found;
    if (scene.text.length > MAX_SCENE_CHARS_FOR_CHECK) throw new Error("Scena troppo lunga per una verifica singola: usa la redazione completa del capitolo.");
    const flat = writtenScenes(book), index = flat.findIndex(x => x.scene.id === scene.id);
    const previous = flat[index - 1], next = flat[index + 1];
    const found2 = kb ? relevantKnowledge(book, kb, scene.text.slice(0, 60_000), scene.id, chapter.number) : undefined;
    const before = edits.find(e => e.before)?.before;
    let previousText = "";
    if (before) { try { previousText = (JSON.parse(before) as { text?: string }).text ?? ""; } catch { previousText = ""; } }
    // Only automatic corrections may refresh an outdated summary; a check changes nothing.
    const summaryFor = review.mode === "auto" && (scene.summaryStale || !scene.summary?.trim()) ? scene.id : undefined;
    return { sceneIds: [scene.id], ...(summaryFor ? { summaryFor } : {}), prompt: [
      edits.length ? "MODIFICHE DA VERIFICARE SU QUESTA SCENA:\n" + editLines(edits) : "Scena controllata come dipendenza di altre modifiche o nella review completa.",
      `SCENA DA VERIFICARE — sceneId ${scene.id}, capitolo ${chapter.number} «${chapter.title}», scena ${scene.number} «${scene.title}»:\n${scene.text}`,
      previousText && previousText !== scene.text ? "VERSIONE PRECEDENTE (solo per capire cosa è cambiato; non va ripristinata):\n" + bounded(previousText, 8000) : "",
      previous ? "FINE DELLA SCENA PRECEDENTE (contesto, non da verificare):\n" + previous.scene.text.slice(-2000) : "",
      next ? "INIZIO DELLA SCENA SUCCESSIVA (contesto, non da verificare):\n" + next.scene.text.slice(0, 2000) : "",
      found2 && kb && (found2.entities.length || found2.events.length) ? "SCHEDE PERTINENTI (canone strutturato; le prospettive distinguono ciò che un personaggio sa):\n" +
        describeEntities(found2.entities, kb, 5000) + (found2.events.length ? "\nEventi:\n" + describeEvents(found2.events, kb, 3000) : "") : "",
      constraints,
      summaryFor ? `Il riassunto della scena è assente o non aggiornato: compila "sceneSummary".` : `Ometti "sceneSummary".`,
    ].filter(Boolean).join("\n\n") };
  }
  if (unit.kind === "chapter") {
    const chapter = book.chapters.find(c => c.id === unit.targetId);
    if (!chapter) throw new Error("Capitolo non più presente.");
    return { sceneIds: [], prompt: [
      edits.length ? "MODIFICHE DA VERIFICARE SUL CAPITOLO:\n" + editLines(edits) : "",
      `CAPITOLO ${chapter.number} — titolo «${chapter.title}». Scopo: ${chapter.purpose}\nRiassunto: ${chapter.summary ?? "assente"}`,
      "RIASSUNTI DELLE SCENE:\n" + chapter.scenes.map(s => `- ${s.number}. ${s.title}: ${s.summary ?? s.objective}`).join("\n"),
      "Verifica che titolo, scopo e riassunto siano coerenti con le scene. I rilievi riguardano il capitolo: ometti sceneId ed evidence.", constraints,
      `Ometti "sceneSummary".`,
    ].filter(Boolean).join("\n\n") };
  }
  if (!kb) throw new Error("Le schede del libro non sono disponibili.");
  const isEntity = unit.kind === "entity";
  const entity = isEntity ? kb.entities.find(e => e.id === unit.targetId) : undefined;
  const event = !isEntity ? kb.events.find(e => e.id === unit.targetId) : undefined;
  if (!entity && !event) throw new Error("Elemento non più presente nelle schede.");
  const sceneIds = entity ? entityReferences(book, kb, entity).filter(r => r.via !== "event").map(r => r.sceneId)
    : [...new Set([...event!.sceneIds, ...dependentEvents(kb, event!.id).flatMap(e => e.sceneIds)])];
  const shown = sceneIds.slice(0, 8);
  const names = entity ? [entity.name, ...entity.aliases] : [event!.title];
  const before = edits.find(e => e.before)?.before;
  return { sceneIds: shown, prompt: [
    edits.length ? "MODIFICHE DA VERIFICARE:\n" + editLines(edits) : "",
    entity ? "SCHEDA ATTUALE:\n" + describeEntities([entity], kb, 5000) : "EVENTO ATTUALE:\n" + describeEvents([event!], kb, 3000),
    before ? "VERSIONE PRECEDENTE DELLA SCHEDA (JSON, solo riferimento):\n" + bounded(before, 4000) : "",
    shown.length ? "SCENE IN CUI COMPARE (estratti; cita solo da qui usando sceneId):\n" + shown.map(sid => {
      const found = findScene(book, sid)!;
      return `[sceneId ${sid} — capitolo ${found.chapter.number}, scena ${found.scene.number} «${found.scene.title}»]\n${windowsAround(found.scene.text, names)}`;
    }).join("\n\n") : "Non compare ancora in scene scritte.",
    sceneIds.length > shown.length ? `(Altre ${sceneIds.length - shown.length} scene omesse: la verifica è un campione.)` : "",
    "Verifica che la scheda sia coerente con sé stessa, con le altre schede e con le scene: dialoghi, comportamenti, eventi e relazioni che contraddicono la versione attuale.",
    constraints, `Ometti "sceneSummary".`,
  ].filter(Boolean).join("\n\n") };
}

const replySchema = z.object({
  verdict: z.enum(["pass", "issues"]), summary: z.string().max(2000),
  findings: z.array(z.object({
    sceneId: z.string().optional(), severity: z.enum(["critical", "major", "minor"]), category: z.string().min(2).max(60),
    evidence: z.string().max(1100).optional(), issue: z.string().min(8).max(1500), suggestion: z.string().min(4).max(1800), ruleId: z.string().max(80).optional(),
  })).max(30),
  sceneSummary: z.string().max(800).optional(),
});
const fold = (value: string) => value.normalize("NFC").toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
/** Untrusted reply: evidence must be literally in the cited scene, rules must exist. */
export function validateReviewReply(book: BookProject, unit: ReviewUnit, allowedSceneIds: readonly string[], raw: unknown, summaryFor?: string):
  { findings: ReviewFinding[]; summary: string; sceneSummary?: string } {
  const reply = replySchema.parse(raw);
  if (reply.verdict === "pass" && reply.findings.length) throw new Error("Esito «pass» con rilievi: rispondi «issues» oppure togli i rilievi.");
  if (reply.verdict === "issues" && !reply.findings.length) throw new Error("Esito «issues» senza rilievi.");
  const rules = new Set(writerRules(book.editorialProfiles).map(r => r.id));
  const findings = reply.findings.map((finding, index): ReviewFinding => {
    if (finding.ruleId && !rules.has(finding.ruleId)) throw new Error(`Regola «${finding.ruleId}» sconosciuta.`);
    if (finding.sceneId !== undefined) {
      if (!allowedSceneIds.includes(finding.sceneId)) throw new Error("Il rilievo cita una scena non fornita per questa verifica.");
      const scene = findScene(book, finding.sceneId)!.scene;
      if (!finding.evidence || finding.evidence.trim().length < 12 || !fold(scene.text).includes(fold(finding.evidence)))
        throw new Error("Prova non presente letteralmente nella scena citata: cita 12+ caratteri esatti.");
    }
    return { id: unit.key.slice(0, 60) + ":" + index, unitKey: unit.key, severity: finding.severity, category: finding.category.trim(),
      ...(finding.sceneId ? { sceneId: finding.sceneId, evidence: finding.evidence!.trim() } : {}),
      issue: finding.issue.trim(), suggestion: finding.suggestion.trim(), ...(finding.ruleId ? { ruleId: finding.ruleId } : {}) };
  });
  const sceneSummary = summaryFor && reply.sceneSummary?.trim() && reply.sceneSummary.trim().length >= 20 ? reply.sceneSummary.trim() : undefined;
  return { findings, summary: reply.summary.trim(), ...(sceneSummary ? { sceneSummary } : {}) };
}

/* --------------------------------- impact ---------------------------------- */

export function impactPrompt(book: BookProject, review: ManualReview): string {
  const edits = (book.edits ?? []).filter(e => review.editIds.includes(e.id)).slice(-40);
  const candidates = dependencyUnits(book, review.targets).slice(0, 80);
  const excerpt = (value: string | null) => value === null ? "(nessuna)" : bounded(value, 1200);
  return [
    "L'autore ha fatto queste modifiche e vuole sapere quali conseguenze possono avere sul resto del libro, PRIMA di qualunque review o riscrittura. Non correggere nulla.",
    "Per ogni modifica scegli il tipo: style (solo forma), descriptive (dati descrittivi), behavior (comportamento dei personaggi), event (eventi narrativi), structural (struttura con conseguenze globali).",
    "Poi elenca gli elementi che potrebbero risultare incoerenti, con rischio high|medium|low e un motivo concreto. Usa SOLO gli ID forniti; non presumere che serva riscrivere tutto il libro.",
    'Rispondi SOLO JSON: {"summary":"sintesi","editKinds":[{"editId":"...","changeKind":"style|descriptive|behavior|event|structural"}],"impacts":[{"targetId":"ID","risk":"high|medium|low","reason":"..."}]}',
    "MODIFICHE:\n" + edits.map(edit => `- editId ${edit.id}: ${edit.label} (${edit.field}, ${edit.origin === "ai" ? "AI" : "manuale"}${edit.prompt ? ", richiesta «" + edit.prompt.slice(0, 200) + "»" : ""})\n  PRIMA: ${excerpt(edit.before)}\n  DOPO: ${excerpt(edit.after)}`).join("\n"),
    "ELEMENTI COLLEGATI (indizi lessicali e strutturali, non prove):\n" + (candidates.map(u => `- ${u.kind}:${u.targetId} — ${u.label}`).join("\n") || "nessuno trovato"),
    "ALTRE SCENE SCRITTE:\n" + writtenScenes(book).slice(0, 200).map(x => `- scene:${x.scene.id} — Cap. ${x.chapter.number} · ${x.scene.number}. ${x.scene.title}`).join("\n"),
  ].join("\n\n");
}
const impactReplySchema = z.object({
  summary: z.string().min(8).max(3000),
  editKinds: z.array(z.object({ editId: z.string(), changeKind: z.enum(CHANGE_KINDS) })).max(400).optional(),
  impacts: z.array(z.object({ targetId: z.string(), risk: z.enum(["high", "medium", "low"]), reason: z.string().min(8).max(800) })).max(200),
});
export function validateImpactReply(book: BookProject, review: ManualReview, raw: unknown): { summary: string; impacts: ReviewImpact[]; kinds: Map<string, EditChangeKind> } {
  const reply = impactReplySchema.parse(raw);
  const kinds = new Map<string, EditChangeKind>();
  for (const item of reply.editKinds ?? []) if (review.editIds.includes(item.editId)) kinds.set(item.editId, item.changeKind);
  const impacts = reply.impacts.map(item => {
    const raw = item.targetId.replace(/^(scene|entity|event|chapter):(?=(scene|character|location|item|faction|event|chapter):)/, "");
    const scene = findScene(book, raw.replace(/^scene:(?=scene:)/, ""));
    if (scene) return { targetKind: "scene" as const, targetId: scene.scene.id, label: `Cap. ${scene.chapter.number} · ${scene.scene.number}. ${scene.scene.title}`, risk: item.risk, reason: item.reason.trim() };
    const entity = book.knowledge?.entities.find(e => e.id === raw);
    if (entity) return { targetKind: "entity" as const, targetId: entity.id, label: entity.name, risk: item.risk, reason: item.reason.trim() };
    const event = book.knowledge?.events.find(e => e.id === raw);
    if (event) return { targetKind: "event" as const, targetId: event.id, label: event.title, risk: item.risk, reason: item.reason.trim() };
    const chapter = book.chapters.find(c => c.id === raw);
    if (chapter) return { targetKind: "chapter" as const, targetId: chapter.id, label: `Capitolo ${chapter.number} — ${chapter.title}`, risk: item.risk, reason: item.reason.trim() };
    throw new Error(`L'analisi cita «${item.targetId}», che non esiste nel libro.`);
  });
  return { summary: reply.summary.trim(), impacts, kinds };
}

/* ------------------------------- corrections ------------------------------- */

export function correctionPrompt(book: BookProject, sceneId: string, findings: readonly ReviewFinding[]): string {
  const found = findScene(book, sceneId);
  if (!found) throw new Error("Scena non più presente.");
  return [
    `Correggi la scena ${sceneId} risolvendo SOLO i problemi elencati. Conserva tutto il resto: fatti, eventi, rivelazioni, voce, lunghezza e le scelte dell'autore. Restituisci SOLO la prosa completa della scena corretta.`,
    "PROBLEMI DA RISOLVERE:\n" + findings.map(f => `- [${f.severity}] ${f.issue}${f.evidence ? ` (testo: «${f.evidence}»)` : ""}. Suggerimento: ${f.suggestion}`).join("\n"),
    `SCENA (capitolo ${found.chapter.number}, scena ${found.scene.number} «${found.scene.title}»):\n${found.scene.text}`,
  ].join("\n\n");
}
/** Scenes of a review that have findings worth a correction (text findings only). */
export function correctionTargets(review: ManualReview): Array<{ sceneId: string; findings: ReviewFinding[] }> {
  const map = new Map<string, ReviewFinding[]>();
  for (const finding of review.findings) if (finding.sceneId) map.set(finding.sceneId, [...(map.get(finding.sceneId) ?? []), finding]);
  return [...map.entries()].map(([sceneId, findings]) => ({ sceneId, findings }));
}

/** Pending edits the author can include in a review (one entry per element). */
export function reviewableTargets(book: BookProject): EditTarget[] {
  return pendingElements(book).map(p => p.target).filter(t => t.kind !== "profiles");
}
export function stampOfUnit(book: BookProject, unit: ReviewUnit): string {
  return currentStamp(book, { kind: unit.kind, id: unit.targetId });
}
export { contentStamp };
