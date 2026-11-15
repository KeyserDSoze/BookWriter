import { z } from "zod";
import type { Activity, BookProject, Chapter, NarrativeMemory, Phase, RevisionRequest, Scene, TaskKind } from "../domain/types";
import type { ModelAnswer } from "../infrastructure/ai";
import { launchModelCall, ReviewCallPool, startLiveFor, type LaunchInput } from "./model-call";
import { finishLiveAi } from "../infrastructure/ai-observability";
import { taskReasoningChoice } from "../domain/task-reasoning";
import { ProviderResponseReadError } from "../infrastructure/ai-completion-response";
import { keepObservedUsageOnRejectedReply, TruncatedProviderContentError } from "../infrastructure/ai-provider-error";
import { assertScenePlausible } from "../domain/prose-sanity";
import { applyMemoryResponse, assertCompactionShrinks, DELTA_REPLY_RULE, DELTA_REPLY_RULE_NO_SUMMARY,
  memoryNeedsCompaction, memorySchema } from "../domain/memory-delta";
import { AUTO_RETRY_BACKOFF, DEFAULT_AUTO_RETRIES, endpointAutoRetry, isAutoRetryable, retryDelay } from "./auto-retry";
import { correctiveRetryNote, ReplyRejectedError } from "./reply-rejected";
import { PromptExceedsContextError } from "./context-guard";
import { parseJsonReply } from "../domain/json-reply";
import { BookRevisionConflict, getBook, loadSettings, saveActivity, saveBook, saveBookAndActivity } from "../infrastructure/db";
import { withWriterGuard } from "./writer-guard";
import { RemoteWriterLost } from "../infrastructure/github-lease";
import { acceptedRepairs, adjudicationPrompt, archiveEditorialRound, assertCurrentEditorialReconcileStep, assertEditorialReviewCoverage, assertSavedEditorialFreezeJudgmentIntegrity, assertCurrentEditorialSummaryStep, beginNextRound, blockOnMandatoryRules, captureEditorialReconcileStep, chapterSegments, createEditorialCycle, cycleRoles, nextReviewSlot, repairPrompt, reviewConcurrency, reviewerPrompt, reviewerTask, reviewSlotAt, validateJudgment, validateReport } from "../domain/editorial-board";
import { assertCurrentHistoricalPromptDossier, captureHistoricalPromptDossier } from "../domain/historical-research";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { assertPriorChaptersFrozen, completeContinuityRecheck } from "../domain/cross-chapter-continuity";
import { routeFor } from "../domain/types";
import { AiBudgetStop } from "../domain/ai-budget";
import { markAuthorNotesApplied, pendingAuthorNotes, taskAcceptsAuthorNotes, withAuthorNotes } from "../domain/author-interventions";
import { formatAuthorSynopsis } from "../domain/book-start";
import { recordAuthorIntervention } from "./author-intervention";
import { isReaderRole, parseEditorialProfiles, profileStamp, writerInstructions } from "../domain/editorial-profiles";
import { formatResearchResults, parseResearchRequest, researchAgentForKind, researchEnabledFor, researchRule,
  type ResearchAgent, type ResearchEntry, type ResearchRequest } from "../domain/web-research";
import { persistResearchLog, runResearchQueries } from "./web-research";
import { ManualReviewChanged, nextManualReviewStep, type ManualReviewAiStep } from "../domain/manual-review-flow";
import { describeEntities, describeEvents, emptyKnowledge, KNOWLEDGE_REPLY_SHAPE, mergeKnowledgeReply, syncKnowledgeWithMemory,
  MEMORY_FOLDER, findEntity, type KnowledgeBase } from "../domain/knowledge";
import { analyzeImpact, dependentEvents, relevantKnowledge, timelineEvents } from "../domain/knowledge-index";
import { activeChange, changeAnalysisSchema, changeById, detectFactDrift, knownNames, replaceEntitySheet, replaceEventSheet,
  replaceTimelineSheet, sceneComparisonSchema, sceneSnapshots, validRewriteTargets } from "../domain/narrative-change";
import { applyChangePlan, captureFreezeState, reopenForRewrite, settleAfterRewrite, settleChangeOperations } from "../domain/narrative-change-flow";
import { timelineText } from "../domain/ai-edit";
import { applySceneSummaries, sceneSummariesPrompt, scenesNeedingSummary, summaryBatch } from "../domain/scene-summaries";
import { memoryValue, settleChapterEdits } from "../domain/book-edits";

const chapterSchema = z.object({
  chapters: z.array(z.object({
    title: z.string().min(2),
    purpose: z.string().min(8),
    scenes: z.array(z.object({
      title: z.string().min(2),
      objective: z.string().min(8),
    })).min(1).max(50),
  })).min(1).max(80),
});
// The editorial board never truncates canon: it refuses oversized memory.
// Every memory update must therefore keep entries short and merged.
const MEMORY_COMPACTION_RULE = "Mantieni la memoria COMPATTA: ogni voce di characters/locations/factions/items/secrets al massimo 900 caratteri (stato attuale, non cronaca), unisci i duplicati, timeline con al massimo 60 eventi essenziali (riassumi i più vecchi), currentState al massimo 2500 caratteri.";
// A non-empty JSON string can still contain only whitespace. Do not let
// apparent length from spaces/newlines become a frozen, unusable synopsis.
const meaningfulSummary = (maximum: number) => z.string().max(maximum)
  .refine(value => value.trim().length >= 25,
    "La sinossi deve contenere almeno 25 caratteri significativi.");
const editorialSummarySchema = z.object({
  chapterSummary: meaningfulSummary(6000),
  bookSummary: meaningfulSummary(9000),
});
const impactSchema = z.object({
  rationale: z.string(),
  affectedSceneIds: z.array(z.string()),
});

const PERSONAS = [
  "lettore appassionato del genere che ricerca originalità, tensione e ritmo",
  "lettore generalista che pretende chiarezza, emozione e orientamento",
  "lettore critico di logica, realismo, causalità e credibilità",
  "lettore attento a personaggi, dialoghi, relazioni e motivazioni",
  "lettore che cerca misteri costruiti bene, payoff e coerenza tra capitoli",
];

type Work = {
  system?: string;
  /** Task-internal housekeeping: pending author notes must stay pending. */
  noAuthorNotes?: boolean;
  /** Web research group of this task; null = never, absent = derived from the kind. */
  researchAgent?: ResearchAgent | null;
  phase: Phase;
  kind: TaskKind;
  title: string;
  reason: string;
  nextStep: string;
  prompt: string;
  /** Set on reviewer calls: the position lets later reviewers be started ahead of time (opt-in). */
  reviewSlot?: { key: string; index: number; expected: number };
  apply: (book: BookProject, response: string) => void;
};

const reviewKey = (chapterId: string, round: number, index: number) => `${chapterId}:${round}:${index}`;
/** Blind readers and the writer's own review never research; specialists may. */
const reviewerResearchAgent = (role: string): ResearchAgent | null =>
  role === "writerReview" || isReaderRole(role) ? null : "specialists";
function workResearchAgent(work: Pick<Work, "researchAgent" | "kind">): ResearchAgent | undefined {
  return work.researchAgent === null ? undefined : work.researchAgent ?? researchAgentForKind(work.kind);
}
/** The system prompt a task gets when its agent may research (also for look-ahead reviewers). */
function withResearchRule(system: string, book: BookProject, agent: ResearchAgent | undefined, round: number): string {
  const config = book.webResearch;
  if (!config || !researchEnabledFor(book, agent)) return system;
  return system + "\n\n" + researchRule(config, round >= config.maxRounds);
}
/** Everything a task's validity depends on. Author metadata (research settings and log,
 * edit log, reviews, routing, budget, status) can change during a call without
 * invalidating the reply; any narrative change makes the runner redo the step. */
const VOLATILE_BOOK_KEYS = new Set(["updatedAt", "status", "previousError", "remote", "webResearch", "webResearchLog",
  "changeMode", "aiBudget", "modelRoutes", "taskReasoningEfforts", "authorInterventions", "edits", "manualReviews"]);
export function narrativeStateJson(book: BookProject): string {
  // Only top-level keys are volatile: a nested `status` (scene, cycle) is narrative state.
  return JSON.stringify(book, function (this: unknown, key: string, value: unknown) {
    return this === book && VOLATILE_BOOK_KEYS.has(key) ? undefined : value;
  });
}
class AuthorEditDuringTask extends Error {
  constructor(message = "Il libro è stato modificato mentre il modello lavorava: risposta scartata, il passo viene rifatto sulla versione aggiornata.") { super(message); this.name = "AuthorEditDuringTask"; }
}
/** A review the author asked for, run as an ordinary audited task. */
function manualReviewWork(book: BookProject, step: ManualReviewAiStep): Work {
  return { phase: book.phase, kind: step.kind, title: step.title, reason: step.reason, nextStep: step.nextStep,
    system: step.system, prompt: step.prompt, noAuthorNotes: true, researchAgent: "review",
    apply: (b, text) => step.apply(b, text, new Date().toISOString()) };
}
/** Runner bookkeeping (status, phase, new cycle) never overwrites a newer author edit. */
async function saveRunnerState(book: BookProject, expectedUpdatedAt: string, queue = false): Promise<boolean> {
  try { await saveBook(book, queue, expectedUpdatedAt); return true; }
  catch (error) { if (error instanceof BookRevisionConflict) return false; throw error; }
}
/** Re-read, change and CAS-save (with an optional activity), retrying on concurrent edits. */
async function markRunnerBook(bookId: string, mutate: (book: BookProject) => void, activity?: Activity): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const book = await getBook(bookId);
    if (!book) return false;
    const token = book.updatedAt;
    mutate(book);
    try {
      if (activity) await saveBookAndActivity(book, activity, token); else await saveBook(book, false, token);
      return true;
    } catch (error) { if (!(error instanceof BookRevisionConflict)) throw error; }
  }
  return false;
}

type LaunchBase = Omit<LaunchInput, "persisted" | "live">;
/** Start the reviewers that follow the current one, so up to `reviewConcurrency` run together.
 * Their text is applied strictly in order later; any problem here is left to the sequential path. */
async function launchReviewsAhead(
  pool: ReviewCallPool, base: LaunchBase, slot: NonNullable<Work["reviewSlot"]>,
): Promise<void> {
  const { book, settings, signal } = base;
  const cycle = book.editorialCycle;
  const ahead = reviewConcurrency(book) - 1;
  if (ahead < 1 || !cycle || cycle.stage !== "review") return;
  for (let step = 1; step <= ahead; step++) {
    const index = slot.index + step;
    if (index >= slot.expected) return;
    const key = reviewKey(cycle.chapterId, cycle.round, index);
    if (pool.has(key)) continue;
    try {
      const next = reviewSlotAt(book, cycle, index);
      if (!next) return;
      const prompt = reviewerPrompt(book, cycle, next.role, next.segment, next.segmentCount);
      const system = withResearchRule(prompt.system, book, reviewerResearchAgent(next.role) ?? undefined, 0);
      const kind = reviewerTask(next.role);
      const assignment = routeFor(kind, settings, book);
      const endpoint = settings.endpoints.find(e => e.id === assignment.endpointId);
      const requestedEffort = endpoint ? taskReasoningChoice(kind, settings, book, endpoint, assignment.modelId) : undefined;
      const title = "Redazione: " + next.role + " " + (index + 1) + "/" + slot.expected;
      const child = new AbortController();
      signal.addEventListener("abort", () => child.abort(), { once: true });
      const started: Activity = {
        id: crypto.randomUUID(), bookId: book.id, runId: base.runId, phase: "chapterReview", title,
        reason: "Una chat autonoma controlla solo la sua competenza, senza pareri degli altri agenti.",
        nextStep: "Prossimo revisore o giudizio critico della redazione", status: "running",
        createdAt: new Date().toISOString(), endpointId: assignment.endpointId, modelId: assignment.modelId,
        aiRequested: false,
        ...(requestedEffort === undefined ? {} : { requestedReasoningEffort: requestedEffort }),
      };
      const launched = await launchModelCall({
        ...base, kind, title, systemPrompt: system, userPrompt: prompt.prompt, started, assignment,
        configuredEndpoint: endpoint, signal: child.signal, persisted: false, live: false,
        ...(requestedEffort === undefined ? {} : { requestedEffort }),
      });
      pool.add({ key, system, user: prompt.prompt, started, promise: launched.promise, abort: child });
    } catch { return; }
  }
}

function parseJson(raw: string): unknown {
  return parseJsonReply(raw);
}
function outlineText(book: BookProject): string {
  return book.chapters.map(ch => `${ch.number}. ${ch.title}: ${ch.purpose}\n${ch.scenes.map(s => `  - ${s.id}: ${s.title}: ${s.objective}`).join("\n")}`).join("\n");
}
function recentCanon(book: BookProject): string {
  const previous = book.chapters.flatMap(chapter => chapter.scenes
    .filter(scene => scene.status === "canon")
    .map(scene => ({
      chapter: chapter.title, scene: scene.title,
      summary: scene.summary ?? scene.text.slice(0, 500),
    })));
  return previous.slice(-12).map(x => `- ${x.chapter} / ${x.scene}: ${x.summary}`).join("\n");
}
function authorSynopsisBlock(book: BookProject): string {
  if (book.startMode !== "synopsis" || !book.authorChapterSynopses?.length) return "";
  return "Sinossi dell'autore capitolo per capitolo (VINCOLANTE: stessi capitoli, stesso ordine, stessi eventi; puoi arricchire, non sostituire):\n" +
    formatAuthorSynopsis(book.authorChapterSynopses);
}
function bookHeader(book: BookProject): string[] {
  return [
    `Titolo: ${book.title}`, `Brief: ${book.brief || "(nessuna descrizione: sviluppa il libro a partire dal titolo)"}`,
    `Stile: ${book.writingStyle}`, `Audience: ${book.audience}`,
    `Vincoli inderogabili dell'autore:\n${(book.authorConstraints ?? []).join("\n") || "Nessuno"}`,
  ];
}
/** Ideation and outline need every critique produced before the plan. */
function context(book: BookProject): string {
  return [
    ...bookHeader(book),
    authorSynopsisBlock(book),
    book.startMode !== "synopsis" && book.targetChapterCount
      ? `Numero di capitoli richiesto dall'autore: ${book.targetChapterCount}` : "",
    `Idee:\n${book.ideas ?? "Da generare"}`,
    `Validazione:\n${book.validation ?? "Da svolgere"}`,
    `Review lettori:\n${book.audienceReviews.join("\n")}`,
    `Critica adversarial:\n${book.adversarial ?? "Da svolgere"}`,
    `Outline:\n${outlineText(book)}`,
    `Stato narrativo consolidato:\n${JSON.stringify(book.memory)}`,
    `Ultime scene canoniche:\n${recentCanon(book)}`,
  ].filter(Boolean).join("\n\n");
}
/** After the plan exists, the pre-outline critiques are already folded into
 * it: do not resend them with every scene (cost) — keep the long-term ideas. */
function writingContext(book: BookProject): string {
  return [
    ...bookHeader(book),
    ...(["prose", "review", "revision"].includes(book.phase) ? [writerInstructions(book.editorialProfiles)] : []),
    `Idee a lungo, medio e breve termine:\n${book.ideas ?? "Non disponibili"}`,
    `Outline:\n${outlineText(book)}`,
    `Stato narrativo consolidato:\n${JSON.stringify(book.memory)}`,
    `Ultime scene canoniche:\n${recentCanon(book)}`,
  ].join("\n\n");
}
/** Last characters of a scene, starting at a word boundary and never on a lone surrogate. */
function proseTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let tail = text.slice(-limit);
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
  const space = tail.search(/\s/);
  return "…" + (space >= 0 && space < 200 ? tail.slice(space + 1) : tail);
}
/** Chapter goal, binding author synopsis, exact end of the previous written
 * scene and the next planned scene: the writer needs them for transitions. */
function sceneFocus(book: BookProject, sceneId: string): string {
  const flat = book.chapters.flatMap(chapter => chapter.scenes.map(scene => ({ chapter, scene })));
  const index = flat.findIndex(entry => entry.scene.id === sceneId);
  const here = flat[index];
  if (!here) return "";
  const lines = [`Capitolo ${here.chapter.number} «${here.chapter.title}»: ${here.chapter.purpose}`];
  const synopsis = book.startMode === "synopsis"
    ? book.authorChapterSynopses?.[here.chapter.number - 1] : undefined;
  if (synopsis) lines.push(`Sinossi dell'autore per questo capitolo (VINCOLANTE): ${synopsis.synopsis}`);
  for (let i = index - 1; i >= 0; i--) {
    const previous = flat[i]!;
    if (!previous.scene.text.trim()) continue;
    lines.push(`Fine della scena precedente «${previous.scene.title}» (capitolo ${previous.chapter.number}), testo esatto per la continuità:\n${proseTail(previous.scene.text.trim(), 2400)}`);
    break;
  }
  const next = flat[index + 1];
  if (next) lines.push(`Scena successiva prevista: «${next.scene.title}» — ${next.scene.objective}`);
  // Structured sheets as the reference for names, voices, relations and planned events.
  const kb = book.knowledge;
  if (kb && !kb.pending && kb.entities.length) {
    const previousText = flat.slice(Math.max(0, index - 1), index).map(x => x.scene.text.slice(-2400)).join("\n");
    const found = relevantKnowledge(book, kb, [here.scene.title, here.scene.objective, here.chapter.purpose, previousText].join("\n"),
      here.scene.id, here.chapter.number);
    if (found.entities.length) lines.push("SCHEDE NARRATIVE PERTINENTI (riferimento per nomi, voci, relazioni; non sono testo da copiare):\n" + describeEntities(found.entities, kb));
    if (found.events.length) lines.push("EVENTI PREVISTI O GIÀ COLLEGATI A QUESTA SCENA (rispetta cause, prospettive e segreti):\n" + describeEvents(found.events, kb));
  }
  return lines.join("\n\n");
}
/** Judged rounds of a discarded active review stay in the chapter history (see narrative-change-flow). */
function allScenes(book: BookProject): Scene[] {
  return book.chapters.flatMap(x => x.scenes);
}
function targetScene(book: BookProject): Scene | undefined {
  return allScenes(book).find(x => x.id === book.currentSceneId);
}
function ensureScene(book: BookProject): Scene {
  const scene = targetScene(book);
  if (!scene) throw new Error("Checkpoint scena non valido: il target non esiste più.");
  return scene;
}

/** Books with more chapters than this are planned chapter by chapter. */
const STAGED_OUTLINE_FROM = 6;
const chapterListSchema = z.object({
  chapters: z.array(z.object({
    title: z.string().min(2), purpose: z.string().min(8),
    scenes: z.array(z.object({ title: z.string().min(2), objective: z.string().min(8) })).max(50).optional(),
  })).min(1).max(80),
});
const chapterScenesSchema = z.object({
  scenes: z.array(z.object({ title: z.string().min(2), objective: z.string().min(8) })).min(1).max(50),
});
const chapterIdFor = (index: number) => `chapter:${String(index + 1).padStart(3, "0")}`;
const scenesFor = (chapterIndex: number, scenes: Array<{ title: string; objective: string }>): Scene[] =>
  scenes.map((scene, si): Scene => ({
    id: `scene:${String(chapterIndex + 1).padStart(3, "0")}:${String(si + 1).padStart(3, "0")}`,
    number: si + 1, title: scene.title, objective: scene.objective, text: "", status: "planned",
  }));
function finishOutline(b: BookProject): void {
  b.phase = "prose";
  // The sheets, events and timelines are generated right after the plan.
  if (!b.knowledge) b.knowledge = emptyKnowledge(true);
  // The author asked to read and approve the plan before any prose is written.
  if (b.pauseAfterOutline) b.status = "paused";
}
/** A complete plan in one reply (the original format, and the way small books are planned). */
function applyFullPlan(b: BookProject, parsed: z.infer<typeof chapterSchema>): void {
  const required = b.startMode === "synopsis" ? b.authorChapterSynopses ?? [] : [];
  if (required.length && parsed.chapters.length !== required.length)
    throw new Error(`Il piano deve avere esattamente ${required.length} capitoli come la tua sinossi, ma il modello ne ha proposti ${parsed.chapters.length}. Nessun piano applicato: riprendi per ripeterlo, eventualmente con un'indicazione.`);
  b.chapters = parsed.chapters.map((chapter, ci): Chapter => ({
    id: chapterIdFor(ci), number: ci + 1, title: required[ci]?.title ?? chapter.title, purpose: chapter.purpose,
    scenes: scenesFor(ci, chapter.scenes),
  }));
  finishOutline(b);
}
function outlineChapterListWork(book: BookProject, base: string, chapterRule: string,
  synopses: readonly unknown[]): Work {
  return {
    phase: "outline", kind: "outline", title: "Elenco dei capitoli",
    reason: "Prima l'elenco dei capitoli, poi le scene di ciascuno: una risposta piccola per volta, più facile da ripetere se va storta.",
    nextStep: "Scene del primo capitolo",
    prompt: `Elenca SOLO i capitoli del libro, con titolo e scopo narrativo di ciascuno (senza scene). Rispetta istruzioni e capitoli forniti dall'autore. ${chapterRule}${synopses.length ? "" : "Distribuisci archi, rivelazioni e payoff lungo tutto il libro. "}Restituisci ESCLUSIVAMENTE un oggetto JSON valido in questo formato: {"chapters":[{"title":"...","purpose":"..."}]}. Niente Markdown o testo extra.\n\n${base}`,
    apply: (b, text) => {
      const parsed = chapterListSchema.parse(parseJson(text));
      // A reply that already contains every chapter's scenes is a complete plan.
      if (parsed.chapters.every(ch => ch.scenes?.length))
        return applyFullPlan(b, chapterSchema.parse(parseJson(text)));
      const required = b.startMode === "synopsis" ? b.authorChapterSynopses ?? [] : [];
      const expected = required.length || b.targetChapterCount || 0;
      if (expected && parsed.chapters.length !== expected)
        throw new Error(`L'elenco deve avere esattamente ${expected} capitoli, ma il modello ne ha proposti ${parsed.chapters.length}. Nessun piano applicato: riprendi per ripeterlo.`);
      b.chapters = parsed.chapters.map((chapter, ci): Chapter => ({
        id: chapterIdFor(ci), number: ci + 1, title: required[ci]?.title ?? chapter.title,
        purpose: chapter.purpose, scenes: [],
      }));
    },
  };
}
function outlineChapterWork(book: BookProject, chapter: Chapter, base: string,
  synopses: ReadonlyArray<{ synopsis: string }>): Work {
  const synopsis = synopses[chapter.number - 1]?.synopsis;
  const total = book.chapters.length;
  return {
    phase: "outline", kind: "outline", title: `Scene del capitolo ${chapter.number}/${total}: ${chapter.title}`,
    reason: "Pianificare le scene di un solo capitolo, coerenti con l'elenco dei capitoli e con quelli già pianificati.",
    nextStep: chapter.number === total
      ? (book.pauseAfterOutline ? "Pausa per l'approvazione del piano da parte dell'autore" : "Scrittura della prima scena")
      : `Scene del capitolo ${chapter.number + 1}`,
    prompt: `Pianifica le scene SOLO del capitolo ${chapter.number} «${chapter.title}» (scopo: ${chapter.purpose}). ${synopsis ? `La sinossi dell'autore per questo capitolo è VINCOLANTE: distribuisci TUTTI i suoi eventi nelle scene, senza spostarli in altri capitoli: ${synopsis}. ` : ""}Più scene ("paragrafi" Narrarium), con obiettivo narrativo, conflitto, causa ed effetto, indizi distribuiti e payoff successivi, coerenti con gli altri capitoli del piano. Restituisci ESCLUSIVAMENTE un oggetto JSON valido in questo formato: {"scenes":[{"title":"...","objective":"..."}]}. Niente Markdown o testo extra.\n\n${base}`,
    apply: (b, text) => {
      const raw = parseJson(text) as { chapters?: unknown } | null;
      // A model that answers with the whole plan anyway is accepted as before.
      if (raw && typeof raw === "object" && Array.isArray(raw.chapters))
        return applyFullPlan(b, chapterSchema.parse(raw));
      const parsed = chapterScenesSchema.parse(raw);
      const index = b.chapters.findIndex(ch => ch.id === chapter.id);
      const target = b.chapters[index];
      if (!target || target.scenes.length) throw new Error("Il capitolo è cambiato durante la pianificazione.");
      target.scenes = scenesFor(index, parsed.scenes);
      if (b.chapters.every(ch => ch.scenes.length)) finishOutline(b);
    },
  };
}

function sceneIdsOf(book: BookProject): Set<string> {
  return new Set(allScenes(book).map(scene => scene.id));
}
function knowledgeIndexText(kb: KnowledgeBase): string {
  return [
    "Schede esistenti (riusa ESATTAMENTE questi nomi): " + (kb.entities.map(e => `${e.name} [${e.type}]`).join("; ") || "nessuna"),
    "Eventi esistenti: " + (kb.events.map(e => e.title).join("; ") || "nessuno"),
    "Timeline esistenti: " + (kb.timelines.map(t => t.title).join("; ") || "nessuna"),
  ].join("\n").slice(0, 9000);
}
/** Sheets, events and timelines right after the plan (or on the author's request for an older book). */
function knowledgeGenerationWork(book: BookProject): Work {
  const kb = book.knowledge ?? emptyKnowledge(true);
  const written = allScenes(book).filter(scene => scene.text.trim());
  const scenesList = book.chapters.map(ch => `Capitolo ${ch.number} «${ch.title}»: ${ch.purpose}\n` +
    ch.scenes.map(s => `  - ${s.id}: ${s.title} — ${s.summary ?? s.objective}`).join("\n")).join("\n").slice(0, 30000);
  return {
    phase: book.phase, kind: "outline", noAuthorNotes: true,
    title: "Schede narrative, eventi e timeline",
    reason: "Costruire la memoria strutturata del libro: personaggi, luoghi, oggetti, fazioni, eventi e cronologia, collegati da ID stabili.",
    nextStep: written.length ? "Riprende il lavoro dal punto in cui si era fermato" : "Scrittura della prima scena",
    prompt: [
      "Crea la knowledge base narrativa del libro a partire da piano, idee e memoria. Identifica i personaggi principali e secondari già necessari, i luoghi importanti, gli oggetti rilevanti, le fazioni (se esistono), gli eventi fondamentali e le timeline (una globale ed eventuali archi).",
      "Schede CONCISE e funzionali: includi solo informazioni che servono alla storia (ruolo, motivazione, modo di parlare, background, relazioni). Non riempire campi per completezza e non inventare dettagli contraddittori con il piano.",
      "Ogni evento: storyOrder = posizione nella CRONOLOGIA della storia (può differire dall'ordine del racconto: flashback e antefatti), chapter = capitolo in cui è raccontato, sceneIds = scene del piano in cui accade (usa gli ID esatti), involves = nomi delle schede, causes = titoli degli eventi da cui dipende.",
      "Distingui la verità narrativa da ciò che i personaggi sanno: usa perspectives (knows, unaware, believes_false, conceals) per misteri, inganni e segreti, e secret=true per ciò che il lettore non deve ancora sapere.",
      "Restituisci ESCLUSIVAMENTE JSON valido in questo formato, con nomi coerenti fra relazioni ed eventi: " + KNOWLEDGE_REPLY_SHAPE,
      knowledgeIndexText(kb),
      "PIANO E SCENE:\n" + scenesList,
      "IDEE:\n" + (book.ideas ?? "Non disponibili").slice(0, 12000),
      "MEMORIA NARRATIVA:\n" + JSON.stringify(book.memory).slice(0, 24000),
      ...bookHeader(book),
    ].join("\n\n"),
    apply: (b, text) => {
      const previous = b.knowledge ?? emptyKnowledge(true);
      const now = new Date().toISOString();
      let next = mergeKnowledgeReply(previous, parseJson(text), { origin: written.length ? "written" : "planned",
        reason: "Generazione della knowledge base", now, sceneIds: sceneIdsOf(b) });
      next = syncKnowledgeWithMemory(next, b.memory, now);
      if (!next.entities.length) throw new Error("Nessuna scheda generata: servono almeno i personaggi principali.");
      b.knowledge = { ...next, pending: undefined, generatedAt: now };
      delete b.knowledge.pending;
    },
  };
}
const knowledgeUpdateSchema = z.object({
  sceneEntities: z.array(z.string().min(1).max(120)).max(40).optional(),
  sceneSummaries: z.record(z.string(), z.string().trim().min(20).max(800)).optional(),
});
/** Sheet/event updates sent with a memory delta. Unknown names fail closed. When the
 * prompt asked for it, the "knowledge" key is required ({} = nothing changed): the
 * model must look at the existing sheets every time, not only when it remembers to. */
function applyKnowledgeUpdate(b: BookProject, raw: unknown, reason: string,
  options: { sceneId?: string; previousMemory?: NarrativeMemory; required?: boolean } = {}): void {
  if (!b.knowledge || b.knowledge.pending) return;
  const now = new Date().toISOString();
  const reply = raw as { knowledge?: unknown } | null;
  const sceneId = options.sceneId;
  let kb = b.knowledge;
  const hasKnowledge = !!reply && typeof reply === "object" && reply.knowledge !== undefined;
  if (options.required && !hasKnowledge)
    throw new Error("La risposta non contiene \"knowledge\": restituisci le schede nuove o cambiate e gli eventi, oppure \"knowledge\":{} se nulla è cambiato.");
  if (hasKnowledge)
    kb = mergeKnowledgeReply(kb, reply!.knowledge, { origin: "written", reason, now, sceneIds: sceneIdsOf(b), ...(sceneId ? { defaultSceneId: sceneId } : {}) });
  kb = syncKnowledgeWithMemory(kb, b.memory, now, options.previousMemory);
  const extra = knowledgeUpdateSchema.parse(reply ?? {});
  const scene = sceneId ? allScenes(b).find(s => s.id === sceneId) : undefined;
  if (scene && extra.sceneEntities?.length) for (const name of extra.sceneEntities) {
    const entity = findEntity(kb, undefined, name);
    if (!entity) continue; // a mention without a sheet is not an error: the memory sync creates sheets
    const folder = MEMORY_FOLDER[entity.type];
    const list = folder === "characters" ? (scene.characters ??= []) : folder === "locations" ? (scene.locations ??= []) :
      folder === "items" ? (scene.items ??= []) : (scene.factions ??= []);
    if (!list.includes(entity.name) && list.length < 40) list.push(entity.name);
  }
  b.knowledge = kb;
}
const KNOWLEDGE_DELTA_RULE = "Knowledge base: aggiungi SEMPRE al JSON la chiave \"knowledge\":{\"entities\":[...],\"events\":[...]} nel formato " + KNOWLEDGE_REPLY_SHAPE + ", con le schede NUOVE e quelle ESISTENTI che questo testo cambia (stesso nome; solo i campi cambiati: riassunto, attributi, relazioni) e gli eventi accaduti; \"knowledge\":{} se nulla è cambiato. Aggiungi anche \"sceneEntities\":[nomi delle schede presenti nella scena]. Gli eventi accaduti nella scena omettono sceneIds (si collegano a questa scena). Non ripetere schede invariate.";
const knowledgeActive = (book: BookProject) => !!book.knowledge && !book.knowledge.pending;

/** Shrinks canon memory so later prompts (and the model's context) can carry it. The reply must
 * be the complete memory and must be clearly smaller, otherwise the task fails instead of looping. */
function memoryCompactionWork(book: BookProject): Work {
  return {
    phase: book.phase, kind: "consolidate", noAuthorNotes: true,
    title: "Compattazione della memoria narrativa",
    reason: "La memoria del libro è troppo grande per i prompt e per il contesto del modello: va riassunta senza perdere i fatti ancora utili.",
    nextStep: "Riprende il lavoro dal punto in cui si era fermato",
    prompt: "Compatta la memoria narrativa. Mantieni TUTTI i fatti e i segreti ancora rilevanti, unisci i duplicati, elimina i dettagli esauriti e i personaggi o luoghi secondari non più utili. " +
      "Al massimo 14 voci per categoria (characters/locations/factions/items/secrets), ognuna di al massimo 600 caratteri; timeline con al massimo 40 eventi essenziali (riassumi i più vecchi); currentState al massimo 2000 caratteri. Non inventare nulla. " +
      'Restituisci ESCLUSIVAMENTE JSON valido con la memoria COMPLETA: {"characters":{},"locations":{},"factions":{},"items":{},"secrets":{},"timeline":[],"currentState":""}.\n\nMEMORIA ATTUALE:\n' +
      JSON.stringify(book.memory),
    apply: (b, text) => {
      const update = applyMemoryResponse(b.memory, parseJson(text));
      if (update.mode !== "full") throw new Error("La compattazione deve restituire la memoria completa, non un delta.");
      assertCompactionShrinks(b.memory, update.memory);
      b.memory = update.memory;
    },
  };
}

function nextWork(book: BookProject): Work | null {
  const planning = ["brainstorm", "validate", "audience", "adversarial", "outline"].includes(book.phase);
  // The structured sheets are built once the plan exists (new books, or on request).
  if (book.knowledge?.pending && book.chapters.length && !planning && book.phase !== "revision")
    return knowledgeGenerationWork(book);
  const base = planning ? context(book) : writingContext(book);
  const synopses = book.startMode === "synopsis" ? book.authorChapterSynopses ?? [] : [];
  const synopsisRule = synopses.length
    ? "\n\nLa sinossi capitolo per capitolo dell'autore è VINCOLANTE: proponi arricchimenti compatibili e segnala problemi, ma non sostituire eventi, ordine o numero dei capitoli decisi dall'autore."
    : "";
  switch (book.phase) {
    case "brainstorm":
      return {
        phase: "brainstorm", kind: "brainstorm", title: "Brainstorming su tre orizzonti",
        reason: synopses.length
          ? "Arricchire la sinossi dell'autore con idee coerenti prima di fissare le scene."
          : "Generare alternative e motivazioni prima di fissare la trama.",
        nextStep: "Validazione delle idee",
        prompt: synopses.length
          ? `L'autore ha già deciso la trama capitolo per capitolo (sinossi vincolante nel contesto). Genera idee ORIGINALI per arricchirla senza cambiarne gli eventi: LONG-TERM (archi, temi, rivelazioni), MID-TERM (sviluppo di ciascun capitolo, sottotrame coerenti) e SHORT-TERM (scene, beat, dialoghi chiave). Proponi indizi, payoff, conflitti interiori e rischi di cliché. Non passare ancora alla prosa.\n\n${base}`
          : `Genera idee ORIGINALI e longeve per questo libro, divise chiaramente in LONG-TERM (arco totale e rivelazioni), MID-TERM (archi e capitoli), SHORT-TERM (scene e beat). Proponi alternative, conflitti, conseguenze, rischi di cliché, indizi, payoff e criteri di selezione. Se il brief è minimo, costruisci con coraggio premessa, protagonisti e conflitto coerenti con titolo e indicazioni. Non passare ancora alla prosa.\n\n${base}`,
        apply: (b, text) => { b.ideas = text; b.phase = "validate"; },
      };
    case "validate":
      return {
        phase: "validate", kind: "validate", title: "Validazione delle idee",
        reason: "Scartare incoerenze, banalità e idee che violano il brief.",
        nextStep: "Review di cinque tipologie di lettori",
        prompt: `Valida criticamente queste idee: tensione, causalità, fattibilità, originalità, coerenza temporale e fedeltà al brief. Non dichiarare verificati fatti esterni senza fonti. Proponi correzioni precise e decisioni per la trama.${synopsisRule}\n\n${base}`,
        apply: (b, text) => { b.validation = text; b.phase = "audience"; },
      };
    case "audience": {
      const profiles = book.editorialProfiles ? parseEditorialProfiles(book.editorialProfiles).readers.filter(p => p.enabled) : undefined;
      const personas = profiles?.map(p => p.name + ": " + p.instructions) ?? PERSONAS;
      const persona = personas[book.audienceReviews.length];
      if (!persona) return null;
      const expected = JSON.stringify(profiles);
      const audienceBase = profiles ? [...bookHeader(book), authorSynopsisBlock(book), "Idee:\n" + (book.ideas ?? ""),
        "Validazione:\n" + (book.validation ?? "")].filter(Boolean).join("\n\n") : base;
      return {
        phase: "audience", kind: "audience", title: `Audience review ${book.audienceReviews.length + 1}/${personas.length}`,
        reason: `Valutazione indipendente dal punto di vista di: ${persona}.`,
        nextStep: book.audienceReviews.length === personas.length - 1 ? "Adversarial review" : "Prossima persona del panel",
        prompt: `Interpreta solo questo profilo: ${persona}. Esamina le idee come un lettore esigente: punti forti, critiche, noia, inconsistenze, curiosità, revisioni necessarie. Sii concreto, non compiacente.${synopsisRule}\n\n${audienceBase}`,
        apply: (b, text) => {
          const current = b.editorialProfiles ? parseEditorialProfiles(b.editorialProfiles).readers.filter(p => p.enabled) : undefined;
          if (JSON.stringify(current) !== expected) throw new Error("Profili dei lettori cambiati durante la chiamata: risposta scartata.");
          b.audienceReviews.push(`[Persona ${b.audienceReviews.length + 1}] ${text}`);
          if (b.audienceReviews.length >= personas.length) b.phase = "adversarial";
        },
      };
    }
    case "adversarial":
      return {
        phase: "adversarial", kind: "adversarial", title: "Adversarial review",
        reason: "Mettere sotto pressione trama, misteri, motivazioni e promesse al lettore.",
        nextStep: "Outline capitoli e scene",
        prompt: `Cerca aggressivamente buchi di trama, colpi di scena prevedibili, deus ex machina, anticipazioni indebite dei segreti, motivazioni piatte, scene senza conflitto. Elenca problemi con gravità e correzioni proposte, considerando il panel di cinque lettori.${synopsisRule}\n\n${base}`,
        apply: (b, text) => { b.adversarial = text; b.phase = "outline"; },
      };
    case "outline": {
      const chapterRule = synopses.length
        ? `Il piano DEVE contenere esattamente ${synopses.length} capitoli: uno per ciascun capitolo della sinossi dell'autore, nello stesso ordine. Il purpose di ogni capitolo riassume la sua sinossi; distribuisci TUTTI gli eventi della sinossi nelle scene del capitolo corrispondente, senza spostarli in altri capitoli. `
        : book.targetChapterCount ? `Il piano DEVE contenere esattamente ${book.targetChapterCount} capitoli. ` : "";
      // Long books are planned in small pieces: a failed or slow reply costs one chapter, not the whole plan.
      const toPlan = book.chapters.find(ch => ch.scenes.length === 0);
      if (toPlan) return outlineChapterWork(book, toPlan, base, synopses);
      if (!book.chapters.length && (synopses.length || book.targetChapterCount || 0) > STAGED_OUTLINE_FROM)
        return outlineChapterListWork(book, base, chapterRule, synopses);
      return {
        phase: "outline", kind: "outline", title: "Piano dei capitoli",
        reason: synopses.length
          ? "Trasformare la sinossi dell'autore in scene scrivibili e verificabili."
          : "Trasformare la visione in scene scrivibili e verificabili.",
        nextStep: book.pauseAfterOutline ? "Pausa per l'approvazione del piano da parte dell'autore" : "Scrittura della prima scena",
        prompt: `Crea un piano completo e lungimirante del libro. Rispetta istruzioni e capitoli forniti dall'autore. ${chapterRule}Ogni capitolo include più scene ("paragrafi" Narrarium), con obiettivo narrativo, conflitto, causa ed effetto, indizi distribuiti e payoff successivi. Restituisci ESCLUSIVAMENTE un oggetto JSON valido in questo formato: {"chapters":[{"title":"...","purpose":"...","scenes":[{"title":"...","objective":"..."}]}]}. Niente Markdown o testo extra.\n\n${base}`,
        apply: (b, text) => applyFullPlan(b, chapterSchema.parse(parseJson(text))),
      };
    }
    case "prose": {
      const pending = allScenes(book).find(x => x.status !== "canon");
      if (!pending) return null;
      return {
        phase: "prose", kind: "prose", title: `Scrittura: ${pending.title}`,
        reason: "Sviluppare una singola scena coerente con i vincoli e il canone.",
        nextStep: "Review di continuità, stile e segreti",
        prompt: `Scrivi SOLTANTO la scena ${pending.id}: "${pending.title}". Obiettivo: ${pending.objective}. Sviluppa prosa letteraria completa (non scaletta), con causa-effetto, POV coerente, dialoghi e dettagli credibili, senza svelare segreti prima del momento. Collegati in modo naturale alla fine della scena precedente e prepara la successiva. Ricorda che una scena/paragrafo Narrarium può includere diversi paragrafi tipografici. Evita cliché, riassunti al posto della scena e meta-commenti. Restituisci SOLO il testo della scena.\n\nFOCUS DELLA SCENA:\n${sceneFocus(book, pending.id)}\n\n${base}`,
        apply: (b, text) => {
          const scene = allScenes(b).find(x => x.id === pending.id);
          if (!scene) throw new Error("La scena è stata modificata durante la generazione.");
          assertScenePlausible(text);
          scene.text = text; scene.status = "draft"; b.currentSceneId = scene.id; b.phase = "review";
        },
      };
    }
    case "review": {
      const scene = ensureScene(book);
      return {
        phase: "review", kind: "continuity", title: `Review: ${scene.title}`,
        reason: "Controllare personaggi, timeline, stile, logica e segreti rispetto ai capitoli precedenti.",
        nextStep: "Consolidamento della memoria narrativa",
        prompt: `Rivedi e RISCRIVI la scena qui sotto in forma finale. Controlla coerenza con brief, outline, voci dei personaggi, stato, cronologia, oggetti, segreti e raccordo con la scena precedente. Applica show-don't-tell dove serve, evita contraddizioni e rivelazioni premature. Restituisci SOLTANTO il testo corretto.\n\nSCENA:\n${scene.text}\n\nFOCUS DELLA SCENA:\n${sceneFocus(book, scene.id)}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => { const target = ensureScene(b); assertScenePlausible(text, target.text); target.text = text; target.status = "canon"; target.summaryStale = true; b.phase = "consolidate"; },
      };
    }
    case "consolidate": {
      const scene = targetScene(book);
      const withKnowledge = knowledgeActive(book);
      return {
        phase: "consolidate", kind: "consolidate", title: "Consolidamento del canon",
        reason: "Aggiornare personaggi, luoghi, fazioni, oggetti, segreti e timeline dopo la scena.",
        nextStep: "Prossima scena o completamento del libro",
        prompt: `Aggiorna lo stato canonico DOPO la scena appena completata. Mantieni i fatti precedenti ancora validi, correggi conoscenze, spostamenti, oggetti, segreti e cronologia. Non inventare fatti assenti dal testo. Tieni i segreti protetti nei metadati, non svelarli nel romanzo. ${MEMORY_COMPACTION_RULE} ${DELTA_REPLY_RULE}${withKnowledge ? " " + KNOWLEDGE_DELTA_RULE + "\n\n" + knowledgeIndexText(book.knowledge!) : ""}\n\nSCENA CANON:\n${scene?.text ?? "Nessuna scena"}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => {
          const reply = parseJson(text);
          const update = applyMemoryResponse(b.memory, reply);
          const previousMemory = b.memory;
          b.memory = update.memory; b.currentSceneId = undefined;
          applyKnowledgeUpdate(b, reply, "Consolidamento dopo la scena " + (scene?.id ?? ""), { sceneId: scene?.id, previousMemory, required: withKnowledge });
          // A real summary of the scene (events and ending); without it the scene keeps its "to update" flag.
          if (update.sceneSummary) {
            const done = allScenes(b).find(s => s.id === scene?.id);
            if (done) { done.summary = update.sceneSummary; delete done.summaryStale; }
          }
          const chapter = b.chapters.find(ch => ch.scenes.some(s => s.id === scene?.id));
          if (chapter && !chapter.frozenAt && chapter.scenes.every(s => s.status === "canon")) {
            b.editorialCycle = createEditorialCycle(chapter.id, b);
            b.phase = "chapterReview";
          } else b.phase = "prose";
        },
      };
    }
    case "chapterReview": {
      const cycle = book.editorialCycle;
      if (!cycle) throw new Error("Sessione di redazione mancante: fermati e chiedi intervento.");
      const chapter = book.chapters.find(ch => ch.id === cycle.chapterId);
      if (!chapter) throw new Error("Capitolo di redazione inesistente.");
      const profileSnapshot = JSON.stringify([cycle.profileSettings, cycle.profileMode, cycle.roles]);
      const assertProfilesCurrent = (current: typeof cycle | undefined) => {
        if (!current || JSON.stringify([current.profileSettings, current.profileMode, current.roles]) !== profileSnapshot)
          throw new Error("I profili della redazione sono cambiati durante la chiamata: risposta scartata.");
      };
      if (cycle.stage === "blocked")
        throw new Error(cycle.blockedReason ?? "Redazione bloccata: intervento autore necessario.");
      // Before a round starts, the scenes get their real summaries (new, rewritten or corrected text).
      if (cycle.stage === "review" && !cycle.reports.length) {
        const stale = scenesNeedingSummary(chapter);
        if (stale.length) return sceneSummariesWork(book, chapter, stale);
      }
      if (cycle.stage === "review") {
        const next = nextReviewSlot(book, cycle);
        if (!next) throw new Error("Checkpoint revisioni incompleto: nessun revisore disponibile.");
        const historicalSnapshot = next.role === "historical"
          ? captureHistoricalPromptDossier(book, cycle.chapterId, "review") : undefined;
        const prompt = reviewerPrompt(book, cycle, next.role, next.segment, next.segmentCount);
        const expectedProfile = profileStamp(next.role, cycle.profileSettings);
        const title = "Redazione: " + next.role + " " + (cycle.reports.length + 1) + "/" +
          (next.segmentCount * cycleRoles(book, cycle).length);
        return {
          reviewSlot: { key: reviewKey(cycle.chapterId, cycle.round, cycle.reports.length),
            index: cycle.reports.length, expected: next.segmentCount * cycleRoles(book, cycle).length },
          researchAgent: reviewerResearchAgent(next.role),
          phase: "chapterReview", kind: reviewerTask(next.role), title,
          system: prompt.system,
          reason: "Una chat autonoma controlla solo la sua competenza, senza pareri degli altri agenti.",
          nextStep: "Prossimo revisore o giudizio critico della redazione",
          prompt: prompt.prompt,
          apply: (b, text) => {
            const current = b.editorialCycle;
            const ch = b.chapters.find(c => c.id === cycle.chapterId);
            if (!current || !ch) throw new Error("Il ciclo editoriale è cambiato.");
            assertProfilesCurrent(current);
            if (profileStamp(next.role, current.profileSettings) !== expectedProfile)
              throw new Error("Il profilo del revisore è cambiato durante la chiamata: risposta scartata.");
            // An author/import can replace historical material without updating
            // the book timestamp. Never approve a report based on old sources.
            if (historicalSnapshot) assertCurrentHistoricalPromptDossier(b, historicalSnapshot);
            const report = validateReport(current, next.role, next.segment, next.segmentCount, text, ch, b);
            // The reviewers of a cycle are fixed by its first report.
            if (!current.reports.length && !current.roles && b.editorialMode === "light")
              current.roles = [...cycleRoles(b, current)];
            current.reports.push(report);
            if (!nextReviewSlot(b, current)) current.stage = "adjudicate";
          },
        };
      }
      if (cycle.stage === "adjudicate") {
        // Never consult the judge based solely on reports.length: all roles,
        // segments, quote anchors and source stamps must still be current.
        assertEditorialReviewCoverage(book, cycle, true);
        const historicalSnapshot = captureHistoricalPromptDossier(book, cycle.chapterId, "adjudicate");
        const prompt = adjudicationPrompt(book, cycle);
        return {
          phase: "chapterReview", kind: "chapterJudge", system: prompt.system,
          title: "Direttore editoriale: accettazione o rifiuto motivato dei rilievi",
          reason: "Il direttore valuta criticamente tutti i rapporti previsti dal ciclo senza assumere che siano corretti.",
          nextStep: "Correzioni accettate oppure preparazione del congelamento",
          prompt: prompt.prompt,
          apply: (b, text) => {
            const current = b.editorialCycle;
            if (!current) throw new Error("Ciclo editoriale non disponibile.");
            assertProfilesCurrent(current);
            const chapter = b.chapters.find(c => c.id === current.chapterId);
            if (!chapter) throw new Error("Capitolo del giudice non disponibile.");
            assertCurrentHistoricalPromptDossier(b, historicalSnapshot);
            assertEditorialReviewCoverage(b, current, true);
            current.judgment = validateJudgment(current, text, chapter, b);
            current.stage = current.judgment.verdict === "freeze" ? "summary" : "repair";
            current.repairCursor = 0;
            current.summaryCursor = 0;
            // A rejected MANDATORY writer rule never freezes or repairs silently.
            if (blockOnMandatoryRules(current)) { b.status = "paused"; b.previousError = current.blockedReason; }
          },
        };
      }
      if (cycle.stage === "repair") {
        const fixes = acceptedRepairs(cycle);
        const unique = [...new Set(fixes.map(x => x.sceneId))];
        const sceneId = unique[cycle.repairCursor];
        if (!sceneId) throw new Error("Correzioni senza scena valida.");
        const prompt = repairPrompt(book, cycle, sceneId);
        return {
          phase: "chapterReview", kind: "chapterRepair", system: prompt.system,
          title: "Remediation approvata: " + sceneId,
          reason: "Riscrittura mirata della scena, applicando solo critiche accolte con motivazione.",
          nextStep: "Aggiornamento della memoria e nuova revisione completa",
          prompt: prompt.prompt,
          apply: (b, text) => {
            if (!text.trim() || text.length > 180000)
              throw new Error("Testo della remediation vuoto o eccessivo.");
            const ch = b.chapters.find(x => x.id === cycle.chapterId);
            const scene = ch?.scenes.find(x => x.id === sceneId);
            if (!scene || !b.editorialCycle) throw new Error("Scena da correggere assente.");
            assertProfilesCurrent(b.editorialCycle);
            if (b.editorialCycle.stage !== "repair" ||
                b.editorialCycle.chapterId !== cycle.chapterId)
              throw new Error("Ciclo editoriale cambiato durante la remediation.");
            // The scene and its prior source might have changed while the AI
            // request was in flight. Re-run the provenance gate against the
            // very same book revision being written, not the planning snapshot.
            repairPrompt(b,b.editorialCycle,sceneId);
            assertScenePlausible(text, scene.text);
            scene.text = text.trim();
            scene.status = "draft";
            scene.summary = undefined;
            scene.summaryStale = true;
            b.editorialCycle.repairCursor++;
            if (b.editorialCycle.repairCursor >= unique.length) {
              b.editorialCycle.stage = "reconcile";
              b.editorialCycle.reconcileCursor = 0;
            }
          },
        };
      }
      if (cycle.stage === "reconcile") {
        // Capture exactly the chapter and canon memory that the model reads.
        // Imported or incomplete cursors must fail before the provider call.
        const checkpoint = captureEditorialReconcileStep(book);
        const segment = chapterSegments(chapter)[checkpoint.cursor]!;
        const withKnowledge = knowledgeActive(book);
        return {
          phase: "chapterReview", kind: "consolidate",
          title: "Riconciliazione canone dopo remediation " + (checkpoint.cursor + 1) +
            "/" + checkpoint.segmentCount,
          reason: "Aggiornare timeline, segreti e personaggi dopo la modifica prima della nuova tornata di review.",
          nextStep: "Prossimo segmento di memoria oppure nuova votazione della redazione",
          prompt: [
            "Aggiorna il canone dopo una correzione editoriale. Mantieni i fatti precedenti ancora veri; non inventare.",
            "Rispondi SOLO con le modifiche alla memoria in JSON valido.",
            DELTA_REPLY_RULE_NO_SUMMARY,
            MEMORY_COMPACTION_RULE,
            ...(withKnowledge ? [KNOWLEDGE_DELTA_RULE, knowledgeIndexText(book.knowledge!)] : []),
            "MEMORIA PRECEDENTE: " + checkpoint.memoryJson,
            "SCENA " + segment.sceneId + ", SEGMENTO " + (checkpoint.cursor + 1) +
              "/" + checkpoint.segmentCount + ":\n" + segment.text,
          ].join("\n\n"),
          apply: (b, text) => {
            // The preflight/IndexedDB revision gate is not a substitute for
            // validating the exact checkpoint used by this editorial agent.
            const current = assertCurrentEditorialReconcileStep(b, checkpoint);
            assertProfilesCurrent(current.cycle);
            const reply = parseJson(text);
            const memory = applyMemoryResponse(b.memory, reply).memory;
            const previousMemory = b.memory;
            b.memory = memory;
            applyKnowledgeUpdate(b, reply, "Riconciliazione dopo una correzione editoriale", { sceneId: segment.sceneId, previousMemory, required: withKnowledge });
            current.cycle.reconcileCursor = checkpoint.cursor + 1;
            if (current.cycle.reconcileCursor >= checkpoint.segmentCount) {
              // Never re-use a scene object captured before the AI request.
              for (const scene of current.chapter.scenes) {
                if (scene.status === "draft") scene.status = "canon";
              }
              beginNextRound(current.cycle);
              if (current.cycle.stage === "blocked") {
                b.status = "paused";
                b.previousError = current.cycle.blockedReason;
              }
            }
          },
        };
      }
      if (cycle.stage === "summary") {
        assertEditorialReviewCoverage(book, cycle, true);
        // Restored/imported freeze verdicts cannot skip the judge's complete
        // 1:1 decision matrix, rejected findings or independent live critiques.
        assertSavedEditorialFreezeJudgmentIntegrity(book, cycle);
        const segments = chapterSegments(chapter);
        const index = cycle.summaryCursor!;
        const segment = segments[index];
        if (!segment) throw new Error("Segmento di riassunto mancante.");
        return {
          phase: "chapterReview", kind: "summarize",
          title: "Sinossi del capitolo e del libro " + (index+1) + "/" + segments.length,
          reason: "Compattare il contesto per i revisori dei capitoli successivi senza perdere il canone verificato.",
          nextStep: "Prossima sinossi oppure congelamento e avanzamento al capitolo seguente",
          prompt: [
            "Aggiorna due sinossi progressive senza spoiler aggiuntivi e senza inventare fatti.",
            "Restituisci SOLO JSON {\"chapterSummary\":\"...\",\"bookSummary\":\"...\"}.",
            "Riassunto capitolo fino ad ora: " + (cycle.runningChapterSummary ?? ""),
            "Riassunto libro precedente: " + (cycle.runningBookSummary ??
              (book.chapters.some(other => other.number > chapter.number && other.frozenAt)
                ? synopsisBeforeChapter(book.chapters, chapter.number) : book.bookSummary ?? "")),
            "Segmento letto: " + segment.sceneId + "\n" + segment.text,
            "Il riassunto del libro deve descrivere quanto è stato realmente raccontato ai lettori.",
          ].join("\n\n"),
          apply: (b, text) => {
            // Guard the EXACT stage/chapter/segment associated with this reply
            // before parsing or writing any summary fields.
            const current = assertCurrentEditorialSummaryStep(b,cycle.chapterId,index);
            assertProfilesCurrent(current);
            const ch = b.chapters.find(x => x.id === cycle.chapterId);
            if (!ch) throw new Error("Sessione di sintesi non valida: capitolo assente.");
            const data = editorialSummarySchema.parse(parseJson(text));
            assertEditorialReviewCoverage(b, current, true);
            // Check once more on the exact book revision being committed;
            // a judge/scene/summary cursor could change during the AI call.
            assertSavedEditorialFreezeJudgmentIntegrity(b, current);
            current.runningChapterSummary = data.chapterSummary;
            current.runningBookSummary = data.bookSummary;
            current.summaryCursor = current.summaryCursor! + 1;
            if (current.summaryCursor >= segments.length) {
              assertPriorChaptersFrozen(b, ch);
              const freezeTime = new Date().toISOString();
              completeContinuityRecheck(b, ch, freezeTime);
              ch.summary = data.chapterSummary;
              ch.bookSummaryAtFreeze = data.bookSummary;
              // A style-only edit reopens one chapter: later frozen chapters keep the full synopsis.
              if (!b.chapters.some(other => other.number > ch.number && other.frozenAt)) b.bookSummary = data.bookSummary;
              ch.frozenAt = freezeTime;
              // The new validation covers the current text: older «modified after review» marks are settled.
              delete ch.summaryStale; delete ch.reviewStale;
              settleChapterEdits(b, ch);
              if (current.profileSettings ? current.profileMode === "light" : !!current.roles) ch.editorialMode = "light"; else delete ch.editorialMode;
              ch.editorialRounds = [...(ch.editorialRounds ?? []), ...current.priorRounds, archiveEditorialRound(current)];
              b.editorialCycle = undefined;
              b.currentSceneId = undefined;
              b.phase = "prose";
              settleChangeOperations(b, freezeTime);
            }
          },
        };
      }
      throw new Error("Stato di revisione del capitolo sconosciuto.");
    }
    case "revision": {
      const rev = book.revision;
      if (!rev) throw new Error("Revisione senza richiesta dell'autore.");
      const change = rev.changeOperationId ? changeById(book, rev.changeOperationId) : undefined;
      if (rev.changeOperationId && !change) throw new Error("Operazione di modifica mancante: annullala dal pannello Mondo.");
      if (change?.state === "awaiting_confirmation") throw new Error("Il piano della modifica attende la tua conferma.");
      if (change?.target.kind === "scene" && change.state === "pending") return sceneEditWork(book, change, base);
      if (change?.target.kind === "scene" && change.state === "analyzing") return sceneComparisonWork(book, change);
      if (change && rev.impactAnalysis === undefined) return changeAnalysisWork(book, change, base);
      if (rev.impactAnalysis === undefined) {
        return {
          phase: "revision", kind: "revision", title: "Analisi d'impatto della correzione",
          reason: "Individuare le scene da cambiare e i rimandi narrativi da rivalidare.",
          nextStep: "Revisione retroattiva delle scene coinvolte",
          prompt: `L'autore ha impartito questa istruzione PRIORITARIA: "${rev.instruction}". Identifica gli ID delle scene canoniche coinvolte direttamente o indirettamente, senza inventare ID. Se nessuna scena già scritta va cambiata (l'istruzione riguarda solo il futuro), restituisci un elenco vuoto. Rispondi ESCLUSIVAMENTE JSON {"rationale":"...","affectedSceneIds":["scene:001:001"]}.\n\n${base}`,
          apply: (b, text) => {
            const impact = impactSchema.parse(parseJson(text));
            const request = b.revision;
            if (!request || request.id !== rev.id) throw new Error("Revisione cambiata durante l'analisi d'impatto.");
            const canonical = allScenes(b).filter(x => x.status === "canon");
            const requested = new Set(impact.affectedSceneIds);
            const earliest = canonical.findIndex(x => requested.has(x.id));
            // Rewrite from the earliest affected scene onward; nothing affected
            // means the instruction only constrains the future.
            request.affectedSceneIds = earliest < 0 ? [] : canonical.slice(earliest).map(x => x.id);
            // Reopen every affected chapter and its successors: retroactive edits invalidate prior votes.
            reopenForRewrite(b, request.affectedSceneIds, "downstream");
            // An empty rationale must not trigger a second (billed) analysis.
            request.impactAnalysis = impact.rationale.trim() || "Nessuna motivazione fornita dal modello.";
            request.cursor = 0;
          },
        };
      }
      const sceneId = rev.affectedSceneIds[rev.cursor];
      if (!sceneId) {
        if (!rev.affectedSceneIds.length) return null; // closed locally by the runner, no AI call
        const rewritten = rev.affectedSceneIds
          .map(id => allScenes(book).find(scene => scene.id === id))
          .filter((scene): scene is Scene => !!scene);
        const last = rewritten.at(-1);
        const changeContext = change ? changePromptContext(book, change) : "";
        const withKnowledge = knowledgeActive(book);
        return {
          phase: "revision", kind: "consolidate", title: "Memoria narrativa dopo la revisione",
          reason: "Allineare personaggi, segreti, oggetti e cronologia alle scene riscritte.",
          nextStep: "Nuova redazione dei capitoli toccati e ripresa della scrittura",
          prompt: `L'autore ha chiesto questa revisione: "${rev.instruction}". Sono state riscritte ${rewritten.length} scene: ${rewritten.map(scene => scene.id + " «" + scene.title + "»").join("; ")}. Aggiorna lo stato canonico perché rifletta la NUOVA versione del libro: mantieni i fatti ancora validi, correggi quelli cambiati dalla revisione, non inventare. Tieni i segreti protetti nei metadati. ${MEMORY_COMPACTION_RULE} ${DELTA_REPLY_RULE_NO_SUMMARY}` +
            ` Aggiungi anche "sceneSummaries":{"ID scena":"riassunto fedele della scena riscritta in 2-4 frasi"} per OGNI scena riscritta.` +
            (withKnowledge ? ` ${KNOWLEDGE_DELTA_RULE}\n\n${knowledgeIndexText(book.knowledge!)}` : "") +
            `${changeContext}\n\nULTIMA SCENA RISCRITTA:\n${last?.text ?? "Nessuna"}\n\nCONTESTO:\n${base}`,
          apply: (b, text) => {
            const reply = parseJson(text);
            const memory = applyMemoryResponse(b.memory, reply).memory;
            const current = b.revision;
            if (!current || current.id !== rev.id) throw new Error("Revisione cambiata durante l'aggiornamento della memoria.");
            const previousMemory = b.memory;
            b.memory = memory;
            applyKnowledgeUpdate(b, reply, "Aggiornamento dopo la revisione: " + rev.instruction.slice(0, 200), { previousMemory, required: withKnowledge });
            const summaries = knowledgeUpdateSchema.parse(reply ?? {}).sceneSummaries ?? {};
            for (const id of current.affectedSceneIds) {
              const target = allScenes(b).find(s => s.id === id);
              if (target && summaries[id]) { target.summary = summaries[id]; delete target.summaryStale; }
            }
            closeRevision(b, current);
          },
        };
      }
      const scene = allScenes(book).find(x => x.id === sceneId);
      if (!scene) throw new Error("Una scena della revisione non esiste più.");
      return {
        phase: "revision", kind: "revision", title: `Revisione retroattiva: ${scene.title}`,
        reason: `Istruzione dell'autore: ${rev.instruction}`,
        nextStep: "Scena seguente o aggiornamento della memoria",
        prompt: `Riscrivi SOLO la scena ${scene.id} in accordo alla nuova istruzione tassativa dell'autore. Preserva i fatti e le parti buone non coinvolte, ma correggi premesse, legami e rimandi per le conseguenze narrative. Restituisci SOLO prosa pronta per il libro.\n\nISTRUZIONE: ${rev.instruction}${change ? changePromptContext(book, change) + "\nCambia SOLO ciò che la modifica richiede: non introdurre nuovi fatti, non eliminare indizi o motivazioni che non dipendono dalla modifica." : ""}\n\nTESTO PRECEDENTE:\n${scene.text}\n\nFOCUS DELLA SCENA:\n${sceneFocus(book, scene.id)}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => {
          const target = allScenes(b).find(x => x.id === sceneId);
          if (!target || !b.revision) throw new Error("Revisione non più applicabile.");
          const op = b.revision.changeOperationId ? changeById(b, b.revision.changeOperationId) : undefined;
          if (op) {
            assertScenePlausible(text, target.text);
            op.report = [...op.report, { sceneId, at: new Date().toISOString(), drift: detectFactDrift(target.text, text, knownNames(b)) }].slice(-400);
            op.updatedAt = new Date().toISOString();
          }
          target.text = text; target.status = "canon"; target.summaryStale = true; b.revision.cursor++;
        },
      };
    }
    case "completed": return null;
  }
}

const PLANNING_PHASES: readonly Phase[] = ["brainstorm", "validate", "audience", "adversarial", "outline"];
/** Leave the revision phase: back to an interrupted review, to writing, or to planning. */
export function closeRevision(book: BookProject, rev: RevisionRequest): void {
  const change = rev.changeOperationId ? changeById(book, rev.changeOperationId) : undefined;
  book.revision = undefined;
  book.currentSceneId = undefined;
  book.phase = book.editorialCycle ? "chapterReview" : book.chapters.length ? "prose" :
    PLANNING_PHASES.includes(rev.beforePhase) ? rev.beforePhase : "brainstorm";
  if (change) settleAfterRewrite(book, change, new Date().toISOString());
}

/** What the writer must know about the tracked change while rewriting or consolidating. */
function changePromptContext(book: BookProject, change: NonNullable<ReturnType<typeof changeById>>): string {
  const kb = book.knowledge;
  const lines = ["", "MODIFICA RICHIESTA DALL'AUTORE su «" + change.targetLabel + "»: " + change.instruction];
  if (change.plan?.interpretation) lines.push("Interpretazione: " + change.plan.interpretation);
  if (change.plan?.changedFacts.length) lines.push("Fatti che cambiano: " + change.plan.changedFacts.join("; "));
  const entity = kb && change.target.kind === "entity" ? kb.entities.find(e => e.id === change.target.id) : undefined;
  if (entity && kb) lines.push("SCHEDA AGGIORNATA (fonte di riferimento):\n" + describeEntities([entity], kb, 4000));
  const event = kb && change.target.kind === "event" ? kb.events.find(e => e.id === change.target.id) : undefined;
  if (event && kb) lines.push("EVENTO AGGIORNATO (fonte di riferimento):\n" + describeEvents([event], kb, 3000));
  return lines.join("\n");
}
function scenesCatalog(book: BookProject, ids: readonly string[], limit = 14000): string {
  const wanted = new Set(ids);
  let out = "";
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    if (!wanted.has(scene.id)) continue;
    const line = `- ${scene.id} (cap. ${chapter.number} «${chapter.title}», scena ${scene.number} «${scene.title}»): ${(scene.summary ?? scene.text.slice(0, 300)).replace(/\s+/g, " ")}`;
    if ((out + line).length > limit) { out += "\n- … altre scene omesse per spazio."; return out; }
    out += (out ? "\n" : "") + line;
  }
  return out || "nessuna";
}
/** Real summaries of new or changed scenes, before the chapter's board reads them. */
function sceneSummariesWork(book: BookProject, chapter: Chapter, stale: readonly Scene[]): Work {
  const batch = summaryBatch(stale);
  const expected = batch.map(scene => ({ id: scene.id, text: scene.text }));
  return {
    phase: book.phase, kind: "summarize", noAuthorNotes: true,
    title: `Riassunti delle scene: capitolo ${chapter.number} (${batch.length} di ${stale.length})`,
    reason: "Le scene nuove o cambiate hanno bisogno di un riassunto vero, non di un taglio del testo, prima della redazione.",
    nextStep: stale.length > batch.length ? "Altri riassunti delle scene" : "Redazione del capitolo",
    prompt: sceneSummariesPrompt(batch),
    apply: (b, text) => { applySceneSummaries(b, expected, parseJson(text)); },
  };
}
/** Sheet, event, timeline or chapter change: interpret, propose the new version, choose the scenes to rewrite.
 * Every direct scene must be classified: rewritten, or left as it is with a reason. */
function changeAnalysisWork(book: BookProject, change: NonNullable<ReturnType<typeof changeById>>, base: string): Work {
  const kind = change.target.kind;
  if (kind === "scene") throw new Error("Una modifica di scena non passa da questa analisi.");
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  if (!kb && kind !== "chapter" && kind !== "memory") throw new Error("Knowledge base non disponibile per la modifica.");
  const fromEdits = !!change.fromEdits?.length;
  const knowledge = kb ?? emptyKnowledge();
  const impact = analyzeImpact(book, knowledge, { kind, id: change.target.id });
  const written = allScenes(book).filter(s => s.status !== "planned" && s.text.trim()).map(s => s.id);
  const entity = kind === "entity" ? knowledge.entities.find(e => e.id === change.target.id) : undefined;
  const event = kind === "event" ? knowledge.events.find(e => e.id === change.target.id) : undefined;
  const timeline = kind === "timeline" ? knowledge.timelines.find(t => t.id === change.target.id) : undefined;
  const chapter = kind === "chapter" ? book.chapters.find(c => c.id === change.target.id) : undefined;
  const what = { entity: "la scheda", event: "l'evento", timeline: "la timeline", chapter: "il capitolo", memory: "la voce di memoria" }[kind];
  const proposalRule = fromEdits ? "La nuova versione è GIÀ in vigore: NON proporre una nuova versione dell'elemento (niente entity, event, timeline o chapter nella risposta)." : {
    entity: "Prepara la NUOVA versione completa della scheda (entity), concisa, conservando ciò che la richiesta non cambia.",
    event: "Prepara la NUOVA versione completa dell'evento (event), concisa, conservando ciò che la richiesta non cambia.",
    timeline: "Se la richiesta cambia titolo, tipo, descrizione o schede seguite della timeline, proponili in timeline (altrimenti omettilo); gli eventi della timeline cambiano solo attraverso le scene riscritte.",
    chapter: "Se la richiesta cambia titolo o scopo del capitolo, proponili in chapter (altrimenti omettilo).",
    memory: "La memoria si aggiorna da sola dopo le riscritture: non proporre una nuova versione.",
  }[kind];
  const shape = fromEdits ? "" : {
    entity: '"entity":{"name":"...","aliases":[],"importance":"main|secondary|minor","summary":"...","attributes":{"role":"...","personality":"...","speech":"..."},"relationships":[{"target":"nome scheda","type":"...","note":"..."}]}',
    event: '"event":{"title":"...","summary":"...","storyOrder":10,"when":"...","narration":"scene|flashback|foreshadowing|offscreen|backstory","involves":["nomi"],"causes":["titoli eventi"],"secret":false,"perspectives":[{"who":"nome","stance":"knows|unaware|believes_false|conceals","note":"..."}]}',
    timeline: '"timeline":{"title":"...","kind":"global|arc|event","summary":"...","subjects":["nomi delle schede seguite"]}',
    chapter: '"chapter":{"title":"...","purpose":"..."}',
    memory: "",
  }[kind];
  const memoryText = kind === "memory" ? memoryValue(book, change.target.id) : undefined;
  const current = entity ? "SCHEDA ATTUALE:\n" + describeEntities([entity], knowledge, 5000)
    : event ? "EVENTO ATTUALE:\n" + describeEvents([event], knowledge, 4000)
      : timeline ? "TIMELINE ATTUALE:\n" + timelineText(timeline, knowledge) + "\nEVENTI: " + timelineEvents(knowledge, timeline.id).map(e => e.title).slice(0, 80).join("; ")
        : chapter ? `CAPITOLO ATTUALE: ${chapter.number} «${chapter.title}»\nScopo: ${chapter.purpose}${chapter.summary ? "\nRiassunto: " + chapter.summary : ""}`
          : memoryText !== undefined ? `VOCE DI MEMORIA ATTUALE (${change.targetLabel}):\n${memoryText.slice(0, 5000)}` : "";
  return {
    phase: "revision", kind: "revision", noAuthorNotes: true,
    title: "Analisi della modifica: " + change.targetLabel,
    reason: "Interpretare la richiesta, aggiornare l'elemento e trovare le scene da riscrivere senza toccare il resto del libro.",
    nextStep: change.mode === "confirm" ? "Piano da confermare dall'autore" : "Riscrittura mirata delle scene coinvolte",
    prompt: [
      fromEdits ? `L'autore ha GIÀ modificato a mano ${what} «${change.targetLabel}». Ecco com'era prima e com'è ora:\n${change.instruction}\nAllinea il resto del libro alla nuova versione.`
        : `L'autore chiede di modificare ${what} «${change.targetLabel}» con questa richiesta PRIORITARIA: "${change.instruction}".`,
      "1) Interpreta la richiesta. 2) " + proposalRule + " 3) Valuta l'impatto: scene DIRETTE (citano o usano l'elemento), INDIRETTE (dipendono da eventi, relazioni o conseguenze cambiate), GLOBALE (struttura dell'intero libro). 4) Scegli in rewriteSceneIds SOLO le scene già scritte che vanno davvero riscritte: non riscrivere tutto il libro. Una modifica di carattere o voce richiede le scene dove il personaggio agisce o parla; un cambio di ruolo può richiedere molto di più. 5) OGNI scena DIRETTA va classificata: o in rewriteSceneIds, o in unchangedDirect con il motivo per cui resta com'è.",
      `Rispondi ESCLUSIVAMENTE JSON: {"interpretation":"...","rationale":"perché queste scene","global":false,"changedFacts":["..."],"rewriteSceneIds":["scene:001:001"],"unchangedDirect":[{"sceneId":"scene:001:002","reason":"perché resta invariata"}]${shape ? "," + shape : ""}}`,
      current,
      "ANALISI LOCALE DELLE DIPENDENZE (indizi lessicali e strutturali, non prove):\n" + (impact.reasons.join("\n") || "nessuna"),
      "SCENE DIRETTE:\n" + scenesCatalog(book, impact.direct),
      "SCENE INDIRETTE:\n" + scenesCatalog(book, impact.indirect),
      "ALTRE SCENE GIÀ SCRITTE (usa questi ID se l'impatto è più ampio):\n" + scenesCatalog(book, written.filter(id => !impact.direct.includes(id) && !impact.indirect.includes(id)), 8000),
      kb ? knowledgeIndexText(kb) : "",
      "CONTESTO:\n" + base,
    ].filter(Boolean).join("\n\n"),
    apply: (b, text) => {
      const op = b.revision?.changeOperationId ? changeById(b, b.revision.changeOperationId) : undefined;
      if (!op || op.id !== change.id || op.state !== "pending" || (!b.knowledge && kind !== "chapter" && kind !== "memory")) throw new Error("La modifica è cambiata durante l'analisi.");
      const parsed = changeAnalysisSchema.parse(parseJson(text));
      if (!fromEdits && kind === "entity" && !parsed.entity) throw new Error("L'analisi deve proporre la nuova scheda completa (entity).");
      if (!fromEdits && kind === "event" && !parsed.event) throw new Error("L'analisi deve proporre il nuovo evento completo (event).");
      const now = new Date().toISOString();
      const liveKb = b.knowledge && !b.knowledge.pending ? b.knowledge : emptyKnowledge();
      const live = analyzeImpact(b, liveKb, { kind, id: op.target.id });
      const rewriteSceneIds = validRewriteTargets(b, parsed.rewriteSceneIds);
      const kept = (parsed.unchangedDirect ?? []).filter(k => live.direct.includes(k.sceneId) && !rewriteSceneIds.includes(k.sceneId));
      const missing = live.direct.filter(id => !rewriteSceneIds.includes(id) && !kept.some(k => k.sceneId === id));
      if (missing.length) throw new Error(`Il piano non dice cosa fare di ${missing.length} scene dirette (${missing.slice(0, 5).join(", ")}): mettile in rewriteSceneIds o in unchangedDirect con il motivo.`);
      const proposal = fromEdits ? {} : { ...(kind === "entity" && parsed.entity ? { entity: parsed.entity } : {}), ...(kind === "event" && parsed.event ? { event: parsed.event } : {}),
        ...(kind === "timeline" && parsed.timeline ? { timeline: parsed.timeline } : {}), ...(kind === "chapter" && parsed.chapter ? { chapter: parsed.chapter } : {}) };
      op.plan = { interpretation: parsed.interpretation, changeKind: "narrative", rationale: parsed.rationale,
        direct: live.direct, indirect: live.indirect, global: parsed.global ?? live.global, rewriteSceneIds,
        changedFacts: parsed.changedFacts ?? [], ...(kept.length ? { kept } : {}), proposal };
      const targetChapter = kind === "chapter" ? b.chapters.find(c => c.id === op.target.id) : undefined;
      if (kind === "chapter" && !targetChapter) throw new Error("Il capitolo da modificare non esiste più.");
      op.before = { ...(kind === "entity" ? { entity: liveKb.entities.find(e => e.id === op.target.id) } : {}),
        ...(kind === "event" ? { event: liveKb.events.find(e => e.id === op.target.id) } : {}),
        ...(kind === "timeline" ? { timeline: liveKb.timelines.find(t => t.id === op.target.id) } : {}),
        ...(targetChapter ? { chapter: { title: targetChapter.title, purpose: targetChapter.purpose } } : {}),
        scenes: sceneSnapshots(b, rewriteSceneIds), memoryJson: JSON.stringify(b.memory) };
      // Validate the proposed version now: a bad proposal must not be stored for later confirmation.
      if (!fromEdits && parsed.entity && kind === "entity") replaceEntitySheet(liveKb, op.target.id, parsed.entity, now, "verifica");
      if (!fromEdits && parsed.event && kind === "event") replaceEventSheet(liveKb, op.target.id, parsed.event, now, "verifica");
      if (!fromEdits && parsed.timeline && kind === "timeline") replaceTimelineSheet(liveKb, op.target.id, parsed.timeline);
      if (op.mode === "confirm") {
        op.state = "awaiting_confirmation"; op.updatedAt = now;
        b.status = "paused";
        b.previousError = "Piano della modifica pronto: confermalo o annullalo nella pagina Mondo.";
        return;
      }
      applyChangePlan(b, op, now);
    },
  };
}
/** A scene edited on request: rewrite first, then compare old and new versions. */
function sceneEditWork(book: BookProject, change: NonNullable<ReturnType<typeof changeById>>, base: string): Work {
  const scene = allScenes(book).find(s => s.id === change.target.id);
  if (!scene || !scene.text.trim()) throw new Error("La scena da modificare non esiste più o non è scritta.");
  return {
    phase: "revision", kind: "revision", noAuthorNotes: true,
    title: "Riscrittura su richiesta: " + scene.title,
    reason: "Applicare la richiesta dell'autore a una sola scena, conservando ciò che non deve cambiare.",
    nextStep: "Confronto con la versione precedente",
    prompt: `Riscrivi la scena ${scene.id} secondo questa richiesta dell'autore: "${change.instruction}". Se la richiesta riguarda solo forma, tono o ritmo, NON cambiare fatti, informazioni rivelate, presenze dei personaggi, oggetti, date o esito della scena. Restituisci SOLO la prosa completa della scena.\n\nTESTO ATTUALE:\n${scene.text}\n\nFOCUS DELLA SCENA:\n${sceneFocus(book, scene.id)}\n\nCONTESTO:\n${base}`,
    apply: (b, text) => {
      const op = b.revision?.changeOperationId ? changeById(b, b.revision.changeOperationId) : undefined;
      const target = allScenes(b).find(s => s.id === change.target.id);
      if (!op || op.id !== change.id || op.state !== "pending" || !target) throw new Error("La modifica è cambiata durante la riscrittura.");
      assertScenePlausible(text, target.text);
      const now = new Date().toISOString();
      op.before = { scenes: sceneSnapshots(b, [target.id]), memoryJson: JSON.stringify(b.memory) };
      op.report = [{ sceneId: target.id, at: now, drift: detectFactDrift(target.text, text, knownNames(b)) }];
      if (op.mode === "confirm") {
        // Nothing changes in the book until the author confirms: the new text waits in the operation.
        op.draftText = text.trim();
      } else {
        captureFreezeState(b, op, [target.id]);
        target.text = text.trim();
        // The chapter is no longer the frozen version: it must be reviewed again.
        reopenForRewrite(b, [target.id], "single");
      }
      op.state = "analyzing"; op.updatedAt = now;
    },
  };
}
function sceneComparisonWork(book: BookProject, change: NonNullable<ReturnType<typeof changeById>>): Work {
  const scene = allScenes(book).find(s => s.id === change.target.id);
  const before = change.before.scenes.find(s => s.sceneId === change.target.id);
  if (!scene || !before) throw new Error("Versione precedente della scena non disponibile.");
  // Confirm mode: the new version is the draft kept aside, the book still has the old text.
  const newText = change.draftText ?? scene.text;
  const flat = allScenes(book);
  const position = flat.findIndex(s => s.id === scene.id);
  const later = flat.slice(position + 1).filter(s => s.status !== "planned" && s.text.trim()).map(s => s.id);
  const kb = book.knowledge;
  const eventScenes = kb ? kb.events.filter(e => e.sceneIds.includes(scene.id)).flatMap(e => dependentEvents(kb, e.id)).flatMap(e => e.sceneIds) : [];
  const drift = change.report[0]?.drift ?? [];
  return {
    phase: "revision", kind: "continuity", noAuthorNotes: true,
    title: "Confronto della modifica: " + scene.title,
    reason: "Capire se sono cambiati solo stile e forma oppure anche fatti narrativi, per rivedere solo ciò che serve.",
    nextStep: "Nuova revisione del capitolo (e delle scene dipendenti se cambiano i fatti)",
    prompt: [
      "Confronta la versione PRECEDENTE e la NUOVA della scena. changeKind=style se cambiano solo forma, tono, ritmo o dialoghi senza nuove informazioni; changeKind=narrative se cambiano fatti, presenze, oggetti, rivelazioni, relazioni, motivazioni o esito.",
      "Per narrative elenca changedFacts e in dependentSceneIds le scene SUCCESSIVE già scritte che diventerebbero incoerenti (solo ID dall'elenco). Scrivi anche un riassunto fedele della NUOVA scena (2-4 frasi, cosa accade).",
      'Rispondi ESCLUSIVAMENTE JSON {"changeKind":"style|narrative","changedFacts":[],"dependentSceneIds":[],"summary":"...","rationale":"..."}',
      drift.length ? "CONTROLLO LOCALE (nomi e numeri presenti in una sola versione): " + drift.join(" ") : "Il controllo locale non ha trovato nomi o numeri cambiati.",
      "VERSIONE PRECEDENTE:\n" + before.text,
      "VERSIONE NUOVA:\n" + newText,
      "SCENE SUCCESSIVE GIÀ SCRITTE:\n" + scenesCatalog(book, [...new Set([...eventScenes, ...later])], 12000),
    ].join("\n\n"),
    apply: (b, text) => {
      const op = b.revision?.changeOperationId ? changeById(b, b.revision.changeOperationId) : undefined;
      const target = allScenes(b).find(s => s.id === change.target.id);
      if (!op || op.id !== change.id || op.state !== "analyzing" || !target || target.text !== scene.text)
        throw new Error("La scena è cambiata durante il confronto.");
      const parsed = sceneComparisonSchema.parse(parseJson(text));
      const now = new Date().toISOString();
      // Fail safe: a local drift turns a «style» verdict into a narrative change.
      const changeKind = parsed.changeKind === "style" && !drift.length ? "style" : "narrative";
      const dependents = changeKind === "narrative" ? validRewriteTargets(b, parsed.dependentSceneIds, target.id)
        .filter(id => later.includes(id)) : [];
      const draft = op.draftText !== undefined;
      if (!draft) { target.summary = parsed.summary; delete target.summaryStale; }
      op.plan = { interpretation: parsed.rationale, changeKind, rationale: parsed.rationale, direct: [target.id], indirect: dependents,
        global: false, rewriteSceneIds: dependents, changedFacts: parsed.changedFacts, drift, ...(draft ? { proposal: { sceneSummary: parsed.summary } } : {}) };
      op.before = { ...op.before, scenes: [...op.before.scenes, ...sceneSnapshots(b, dependents)] };
      // Confirm mode always waits: nothing (not even this scene) changes before the author's decision.
      if (op.mode === "confirm" && (dependents.length || draft)) {
        op.state = "awaiting_confirmation"; op.updatedAt = now;
        b.status = "paused";
        b.previousError = dependents.length ? "La modifica cambia fatti narrativi: conferma o annulla la riscrittura delle scene dipendenti."
          : "La scena riscritta è pronta: confrontala e conferma o annulla la modifica.";
        return;
      }
      applyChangePlan(b, op, now);
    },
  };
}
/** An analysed revision that touches no written scene needs no further AI call. */
function revisionClosableLocally(book: BookProject): book is BookProject & { revision: RevisionRequest } {
  const rev = book.revision;
  return book.phase === "revision" && !!rev && rev.impactAnalysis !== undefined &&
    rev.affectedSceneIds.length === 0;
}

function shortSummary(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 340 ? `${clean.slice(0, 337)}…` : clean;
}

/** Automatic retries per task on a free local endpoint (opt-in per endpoint). */
export const MAX_LOCAL_AUTO_RETRIES = DEFAULT_AUTO_RETRIES;

export class AutopilotRunner {
  private abort?: AbortController;
  private active = false;
  private stopAfter = false;

  get running() { return this.active; }
  get stopAfterCurrentRequested() { return this.stopAfter; }

  /** Immediate pause: aborts the in-flight request (it may still be billed). */
  stop() { this.abort?.abort(); }
  /** Graceful pause: let the current task finish and commit, then stop. */
  stopAfterCurrent() { if (this.active) this.stopAfter = true; }

  async run(bookId: string, onUpdate: () => Promise<void>): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.stopAfter = false;
    const controller = new AbortController();
    this.abort = controller;
    const signal = controller.signal;
    const runId = crypto.randomUUID();
    let sessionStarted = false;
    try {
      await withWriterGuard(bookId, runId, controller, async guard => {
      // The author may edit while the run starts: never overwrite a newer revision.
      for (let attempt = 0; ; attempt++) {
        const initial = await getBook(bookId);
        if (!initial) throw new Error("Libro non trovato.");
        if (initial.editorialReviewSceneIds?.length)
          throw new Error("Rileggi e conferma le scene fuse nel Lettore prima di avviare l'autopilot.");
        const token = initial.updatedAt;
        initial.status = "running"; initial.previousError = undefined;
        await guard.assertActive();
        try { await saveBook(initial, false, token); break; } // A run start is not a narrative checkpoint.
        catch (error) { if (!(error instanceof BookRevisionConflict) || attempt >= 4) throw error; }
      }
      sessionStarted = true;
      await onUpdate();
      // Local, unauthenticated endpoints cost nothing per call: a failed task may
      // be retried a bounded number of times so an unattended run can continue.
      let retries = 0;
      let retryScope = "";
      let rejectedReplyReason = "";
      /** Consecutive replies discarded because the author edited the book meanwhile. */
      let authorConflicts = 0;
      /** Web research already done for the current task, keyed like the retries. */
      const research = new Map<string, { round: number; entries: ResearchEntry[] }>();
      const pool = new ReviewCallPool();

      try {
      while (!signal.aborted) {
        await guard.assertActive();
        const book = await getBook(bookId);
        if (!book || book.status !== "running") break;
        // Every state change below is CAS-checked: an author edit in between wins and the loop re-reads.
        const token = book.updatedAt;
        const commit = (b: BookProject, queue = false) => saveRunnerState(b, token, queue);
        if (this.stopAfter) {
          book.status = "paused";
          book.previousError = undefined;
          if (!await commit(book)) continue;
          await onUpdate();
          break;
        }
        // A review the author asked for runs before anything else; then the book goes
        // back to where the author left it (paused, completed) or the run continues.
        const manual = nextManualReviewStep(book);
        if (manual?.type === "local") {
          const now = new Date().toISOString();
          const summary = manual.run(book, now);
          try {
            await saveBookAndActivity(book, { id: crypto.randomUUID(), bookId, runId, phase: book.phase, title: manual.title,
              reason: manual.reason, nextStep: manual.nextStep, status: "succeeded", aiRequested: false, createdAt: now, endedAt: now,
              summary: shortSummary(summary) }, token);
          } catch (error) { if (error instanceof BookRevisionConflict) continue; throw error; }
          await onUpdate();
          continue;
        }
        if (!manual) {
        // A previously canonical chapter is not final until the independent board freezes it.
        if (book.phase === "prose" && !book.editorialCycle) {
          const ready = [...book.chapters]
            .filter(ch => !ch.frozenAt && ch.scenes.length > 0 &&
              ch.scenes.every(scene => scene.status === "canon"))
            .sort((a,b)=>a.number-b.number)
            .find(ch => book.chapters.every(prev =>
              prev.number >= ch.number || !!prev.frozenAt));
          if (ready) {
            book.editorialCycle = createEditorialCycle(ready.id, book);
            book.phase = "chapterReview";
            if (!await commit(book)) continue;
            await onUpdate();
            continue;
          }
        }
        if (book.editorialReviewSceneIds?.length) {
          book.status = "paused";
          book.previousError = "Alcune scene fuse attendono conferma editoriale nel Lettore.";
          if (!await commit(book)) continue;
          await onUpdate();
          break;
        }
        if (activeChange(book)?.state === "awaiting_confirmation") {
          book.status = "paused";
          book.previousError = "Piano della modifica pronto: confermalo o annullalo nella pagina Mondo.";
          if (!await commit(book)) continue;
          await onUpdate();
          break;
        }
        if (revisionClosableLocally(book)) {
          const expected = book.updatedAt;
          const instruction = book.revision.instruction;
          const change = activeChange(book);
          closeRevision(book, book.revision);
          const now = new Date().toISOString();
          try {
            await saveBookAndActivity(book, {
              id: crypto.randomUUID(), bookId, runId, phase: "revision",
              title: change ? "Modifica applicata: " + change.targetLabel : "Revisione chiusa senza riscritture",
              reason: change ? (change.plan?.changeKind === "style" ? "Modifica di forma: nessun fatto cambiato, il capitolo viene rivisto di nuovo." :
                "Scheda aggiornata; nessuna scena già scritta da riscrivere.") : "L'analisi d'impatto non ha individuato scene già scritte da cambiare.",
              nextStep: change ? "Nuova redazione dei capitoli toccati, poi la modifica risulterà completata." : "L'istruzione resta un vincolo permanente per i prossimi task.",
              status: "succeeded", aiRequested: false, createdAt: now, endedAt: now,
              summary: shortSummary((change ? "Modifica senza altre riscritture: " : "Nessuna scena riscritta per: ") + instruction),
            }, expected);
          } catch (error) { if (error instanceof BookRevisionConflict) continue; throw error; }
          await onUpdate();
          continue;
        }
        }
        let work: Work | null;
        if (manual) work = manualReviewWork(book, manual);
        else try {
          work = book.phase === "prose" && !book.editorialCycle && !book.revision &&
            memoryNeedsCompaction(book.memory) ? memoryCompactionWork(book) : nextWork(book);
        } catch (error) {
          // The editorial board refuses oversized canon memory; compact it instead of stopping.
          if (error instanceof Error && !book.revision &&
              /compattare la memoria|Memoria pertinente troppo ampia/.test(error.message))
            work = memoryCompactionWork(book);
          else throw error;
        }
        if (!work) {
          if (book.phase === "audience" && book.audienceReviews.length >= 5) {
            book.phase = "adversarial"; await commit(book); continue;
          }
          book.phase = "completed"; book.status = "completed";
          if (!await commit(book, true)) continue;
          await onUpdate(); break;
        }
        const settings = await loadSettings();
        const retryKey = work.phase + ":" + work.title;
        if (retryScope !== retryKey) { retryScope = retryKey; retries = 0; rejectedReplyReason = ""; }
        for (const key of [...research.keys()]) if (key !== retryKey) research.delete(key);
        if (retries > 0 && rejectedReplyReason) work.prompt += correctiveRetryNote(rejectedReplyReason);
        const assignment = routeFor(work.kind, settings, book);
        const configuredEndpoint=settings.endpoints.find(e=>e.id===assignment.endpointId);
        const requestedEffort=configuredEndpoint
          ? taskReasoningChoice(work.kind,settings,book,configuredEndpoint,assignment.modelId):undefined;
        // Author next-step notes go only to tasks that already see the private canon.
        const notes = !work.noAuthorNotes && taskAcceptsAuthorNotes(work.kind) ? pendingAuthorNotes(book) : [];
        const researchAgent = workResearchAgent(work);
        const researchConfig = researchEnabledFor(book, researchAgent) ? book.webResearch : undefined;
        const researchDone = research.get(retryKey);
        const userPrompt = withAuthorNotes(work.prompt, notes) + (researchDone && book.webResearch
          ? "\n\n" + formatResearchResults(researchDone.entries, researchDone.round, book.webResearch.maxRounds) : "");
        const systemPrompt = withResearchRule(work.system ?? "Sei un editor e romanziere esperto. Segui rigorosamente le istruzioni dell'autore. Evita banalità, contraddizioni, spoiler prematuri e affermazioni fattuali non verificate. Rispondi solo nel formato richiesto.",
          book, researchAgent, researchDone?.round ?? 0);
        // Everything the reply's validity depends on, to tell author metadata edits from narrative ones.
        const narrativeBefore = narrativeStateJson(book);
        // A reviewer call already made ahead of time, valid only for exactly these prompts.
        const pooled = work.reviewSlot ? pool.take(work.reviewSlot.key, systemPrompt, userPrompt) : undefined;
        const started: Activity = pooled?.started ?? {
          id: crypto.randomUUID(), bookId, runId,
          phase: work.phase, title: work.title, reason: work.reason,
          nextStep: work.nextStep, status: "running",
          createdAt: new Date().toISOString(),
          endpointId: assignment.endpointId, modelId: assignment.modelId,
          aiRequested: false,
          ...(requestedEffort===undefined?{}:{requestedReasoningEffort:requestedEffort}),
          ...(notes.length ? { appliedInterventionIds: notes.map(note => note.id) } : {}),
        };
        if (!pooled) await saveActivity(started);
        await onUpdate();
        try {
          const launch = { book, settings, runId, guard, signal, kind: work.kind, title: work.title,
            systemPrompt, userPrompt, started, assignment, configuredEndpoint,
            ...(requestedEffort === undefined ? {} : { requestedEffort }) };
          let call: Promise<ModelAnswer>;
          if (pooled) {
            await guard.assertActive();
            startLiveFor({ ...launch });
            call = pooled.promise;
          } else call = (await launchModelCall({ ...launch, persisted: true, live: true })).promise;
          // While this reviewer answers, the next ones start (opt-in, never with an AI budget).
          if (work.reviewSlot && !this.stopAfter && !signal.aborted)
            await launchReviewsAhead(pool, launch, work.reviewSlot);
          const result = await call;
          // A provider reply may carry usage even when the editorial schema,
          // freshness gate or writer lease rejects its text. Capture the
          // observed counts before validation so the failed/cancelled Activity
          // still accounts for a potentially billed request.
          started.endpointId = result.endpointId;
          started.modelId = result.modelId;
          started.inputTokens = result.inputTokens;
          started.outputTokens = result.outputTokens;
          started.cachedInputTokens = result.cachedInputTokens;
          await guard.assertActive(); // Discard result if the lease was lost during the AI call.
          if (researchConfig) {
            let request: ResearchRequest | undefined;
            try { request = parseResearchRequest(result.text, researchConfig); }
            catch (error) { throw new ReplyRejectedError(error); }
            if (request) {
              if ((researchDone?.round ?? 0) >= researchConfig.maxRounds)
                throw new ReplyRejectedError(new Error("Hai già usato le ricerche disponibili per questo compito: rispondi nel formato richiesto senza cercare."));
              // The request was the model's whole answer: an audited call, no canon change.
              started.status = "succeeded"; started.endedAt = new Date().toISOString();
              started.nextStep = "Ricerca web, poi lo stesso compito con i risultati.";
              started.summary = shortSummary("Ha chiesto una ricerca web: " + request.queries.join(" · "));
              started.output = result.text;
              await saveActivity(started);
              finishLiveAi(started.id, "completata");
              let entries: ResearchEntry[];
              try {
                entries = await runResearchQueries({ book, settings, runId, guard, signal, phase: work.phase,
                  taskTitle: work.title, reason: request.reason, queries: request.queries });
                await persistResearchLog(bookId, entries);
              } catch (error) {
                await markRunnerBook(bookId, b => { b.status = "paused"; b.previousError = error instanceof AiBudgetStop ? error.message
                  : signal.aborted ? undefined : "Ricerca web interrotta: " + (error instanceof Error ? error.message : "errore") + " Riprendi per continuare."; });
                await onUpdate();
                break;
              }
              research.set(retryKey, { round: (researchDone?.round ?? 0) + 1, entries: [...(researchDone?.entries ?? []), ...entries] });
              await onUpdate();
              continue;
            }
          }
          const latest = await getBook(bookId);
          if (!latest || latest.status !== "running")
            throw new DOMException("Il libro è cambiato durante la chiamata AI: risultato non applicato.", "AbortError");
          // The author may edit while the model works: their version wins and this step is redone.
          if (latest.phase !== work.phase || narrativeStateJson(latest) !== narrativeBefore) throw new AuthorEditDuringTask();
          if (["prose", "review", "revision"].includes(work.phase) &&
              writerInstructions(latest.editorialProfiles) !== writerInstructions(book.editorialProfiles))
            throw new DOMException("Il profilo dello scrittore è cambiato durante la chiamata AI: risultato non applicato.", "AbortError");
          const commitToken = latest.updatedAt;
          try { work.apply(latest, result.text); }
          catch (error) {
            // The review was cancelled or changed by the author meanwhile: not a model error.
            if (error instanceof ManualReviewChanged) throw new AuthorEditDuringTask(error.message);
            throw new ReplyRejectedError(error);
          }
          started.status = "succeeded"; started.endedAt = new Date().toISOString();
          started.summary = shortSummary(result.text); started.output = result.text;
          // Atomic with the canon commit below: a failed task leaves notes pending.
          markAuthorNotesApplied(latest, notes.map(note => note.id), started.id, work.title, started.endedAt);
          // One more fencing check before canonizing output in IndexedDB.
          await guard.assertActive();
          // The revision checked after the provider call must still be
          // current inside the SAME IndexedDB transaction as canon + audit.
          // A non-cooperating writer can update after getBook above.
          await saveBookAndActivity(latest, started, commitToken);
          finishLiveAi(started.id,"completata");
          retries = 0;
          rejectedReplyReason = "";
          authorConflicts = 0;
          research.delete(retryKey);
          await onUpdate();
        } catch (error) {
          const message=error instanceof ProviderResponseReadError || error instanceof TruncatedProviderContentError ||
            error instanceof PromptExceedsContextError?error.message:
            error instanceof Error && error.name==="ProviderHeaderTimeoutError"?error.message:
            error instanceof AuthorEditDuringTask ? error.message : error instanceof BookRevisionConflict ? new AuthorEditDuringTask().message :
            "La richiesta non ha prodotto un risultato applicabile. Apri il task per vedere l'errore.";
          finishLiveAi(started.id,signal.aborted?"interrotta":"rifiutata",message);
          // HTTP 200 + valid JSON can report usage with empty or malformed
          // content. Keep the observed counters on failure, without approving
          // a report, chapter or remediation.
          keepObservedUsageOnRejectedReply(started, error);
          if (error instanceof AuthorEditDuringTask || error instanceof BookRevisionConflict) {
            // Another writer (the author, normally) committed during the call. The
            // attempted request may still have cost tokens, but the newer book wins:
            // never overwrite it, record the discarded reply and redo the step.
            started.status = "cancelled";
            // These fields were prepared for the successful canon commit but
            // must not leak into the standalone attempted-request audit.
            delete started.summary;
            delete started.output;
            started.error = error instanceof AuthorEditDuringTask ? error.message : new AuthorEditDuringTask().message;
            started.endedAt = new Date().toISOString();
            await saveActivity(started);
            await onUpdate();
            const current = await getBook(bookId);
            if (current?.status === "running" && ++authorConflicts <= 5) continue;
            if (current?.status === "running") await markRunnerBook(bookId, b => {
              b.status = "paused";
              b.previousError = "Il libro è cambiato più volte mentre il modello lavorava: autopilot in pausa. Riprendi quando hai finito di modificare.";
            });
            await onUpdate();
            break;
          }
          const leaseFailure = guard.failure();
          const budgetStop = error instanceof AiBudgetStop;
          const aborted = !leaseFailure && (signal.aborted || error instanceof DOMException && error.name === "AbortError");
          started.status = aborted ? "cancelled" : "failed";
          started.error = leaseFailure?.message ?? (aborted
            ? "Attività interrotta; nessun output canonizzato."
            : error instanceof Error ? error.message : "Errore sconosciuto.");
          started.endedAt = new Date().toISOString();
          const retryPolicy = endpointAutoRetry(configuredEndpoint);
          const willRetry = !aborted && !leaseFailure && !budgetStop && started.aiRequested === true &&
            retryPolicy.enabled && isAutoRetryable(error) &&
            retries < retryPolicy.max && !this.stopAfter && !signal.aborted;
          if (willRetry) {
            retries++;
            if (error instanceof ReplyRejectedError) rejectedReplyReason = error.message;
          }
          const status = willRetry ? "running" : aborted || budgetStop ? "paused" : "error";
          const previousError = willRetry
            ? `Tentativo ${retries}/${retryPolicy.max} fallito su «${work.title}»: ${started.error} Riprovo automaticamente.`
            : started.error;
          // CAS read-modify-write: an author edit made meanwhile is kept.
          const marked = await markRunnerBook(bookId, b => { b.status = status; b.previousError = previousError; }, started);
          if (!marked) await saveActivity(started);
          await onUpdate();
          if (willRetry && marked) {
            // A paid/remote provider may be rate limiting or overloaded: give it time.
            if (configuredEndpoint?.authMode !== "none") await retryDelay(AUTO_RETRY_BACKOFF.baseMs * retries, signal);
            continue;
          }
          break;
        }
      }
      } finally { await pool.drain(); }
      }); // release the GitHub writer lease and the browser Web Lock
    } catch (error) {
      // Acquisition errors happen before any task is started and must not change
      // another tab's running status. Once started, preserve a readable error.
      const message = (error instanceof Error ? error.message : "Lock remoto non disponibile.")
        .replace(/github_pat_[A-Za-z0-9_-]+/g, "[PAT redatto]")
        .replace(/sk-[A-Za-z0-9_-]+/g, "[chiave redatta]");
      const current = await getBook(bookId);
      if (sessionStarted && current?.status === "running") {
        await markRunnerBook(bookId, b => {
          if (b.status !== "running") return;
          b.status = signal.aborted && !(error instanceof RemoteWriterLost) ? "paused" : "error";
          b.previousError = message;
        });
      }
      if (current) {
        const now = new Date().toISOString();
        await saveActivity({
          id: crypto.randomUUID(), bookId, runId, phase: current.phase,
          title: "Verifica scrittura esclusiva",
          reason: "Controllo di concorrenza locale e lease remoto prima della generazione AI.",
          nextStep: "Verifica lo stato del lock in Archivio prima di riprendere.",
          status: signal.aborted && !(error instanceof RemoteWriterLost) ? "cancelled" : "failed",
          error: message, createdAt: now, endedAt: now,
        });
      }
      throw error;
    } finally {
      this.active = false;
      this.abort = undefined;
      await onUpdate();
    }
  }
}

/**
 * Retroactive author revision, now recorded as an author intervention
 * (writer Web Lock + CAS + audit entry). Kept for existing callers.
 */
export async function requestRevision(
  bookId: string, instruction: string, expectedUpdatedAt: string,
): Promise<void> {
  await recordAuthorIntervention(bookId, { instruction, scope: "rewrite" }, expectedUpdatedAt);
}
