import { z } from "zod";
import type { Activity, BookProject, Chapter, NarrativeMemory, Phase, RevisionRequest, Scene, TaskKind } from "../domain/types";
import type { ModelAnswer } from "../infrastructure/ai";
import { launchModelCall, ReviewCallPool, startLiveFor, type LaunchInput } from "./model-call";
import { currentLiveAi, finishLiveAi, saveAiTrace } from "../infrastructure/ai-observability";
import { taskReasoningChoice } from "../domain/task-reasoning";
import { ProviderResponseReadError } from "../infrastructure/ai-completion-response";
import { keepObservedUsageOnRejectedReply, TruncatedProviderContentError } from "../infrastructure/ai-provider-error";
import { assertScenePlausible } from "../domain/prose-sanity";
import { applyMemoryResponse, assertCompactionShrinks, DELTA_REPLY_RULE, DELTA_REPLY_RULE_NO_SUMMARY,
  memoryNeedsCompaction, memorySchema } from "../domain/memory-delta";
import { AUTO_RETRY_BACKOFF, DEFAULT_AUTO_RETRIES, endpointAutoRetry, isAutoRetryable, retryDelay } from "./auto-retry";
import { PromptExceedsContextError } from "./context-guard";
import { parseJsonReply } from "../domain/json-reply";
import { BookRevisionConflict, getBook, loadSettings, saveActivity, saveBook, saveBookAndActivity } from "../infrastructure/db";
import { withWriterGuard } from "./writer-guard";
import { RemoteWriterLost } from "../infrastructure/github-lease";
import { acceptedRepairs, adjudicationPrompt, assertCurrentEditorialReconcileStep, assertEditorialReviewCoverage, assertSavedEditorialFreezeJudgmentIntegrity, assertCurrentEditorialSummaryStep, beginNextRound, captureEditorialReconcileStep, chapterSegments, createEditorialCycle, cycleRoles, nextReviewSlot, repairPrompt, reviewConcurrency, reviewerPrompt, reviewerTask, reviewSlotAt, validateJudgment, validateReport } from "../domain/editorial-board";
import { assertCurrentHistoricalPromptDossier, captureHistoricalPromptDossier } from "../domain/historical-research";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { assertPriorChaptersFrozen, completeContinuityRecheck, markDownstreamContinuity } from "../domain/cross-chapter-continuity";
import { routeFor } from "../domain/types";
import { AiBudgetStop } from "../domain/ai-budget";
import { markAuthorNotesApplied, pendingAuthorNotes, taskAcceptsAuthorNotes, withAuthorNotes } from "../domain/author-interventions";
import { formatAuthorSynopsis } from "../domain/book-start";
import type { EditorialRound } from "../domain/editorial-board";
import { recordAuthorIntervention } from "./author-intervention";

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
        ...base, kind, title, systemPrompt: prompt.system, userPrompt: prompt.prompt, started, assignment,
        configuredEndpoint: endpoint, signal: child.signal, persisted: false, live: false,
        ...(requestedEffort === undefined ? {} : { requestedEffort }),
      });
      pool.add({ key, system: prompt.system, user: prompt.prompt, started, promise: launched.promise, abort: child });
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
  return lines.join("\n\n");
}
/** Judged rounds of a discarded active review stay in the chapter history. */
function archiveJudgedRounds(book: BookProject): void {
  const cycle = book.editorialCycle;
  if (!cycle) return;
  const chapter = book.chapters.find(ch => ch.id === cycle.chapterId);
  if (!chapter) return;
  const judged: EditorialRound[] = [...cycle.priorRounds];
  if (cycle.judgment) judged.push({ round: cycle.round, reports: cycle.reports, judgment: cycle.judgment });
  if (judged.length) chapter.editorialRounds = [...(chapter.editorialRounds ?? []), ...judged];
}
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
      const persona = PERSONAS[book.audienceReviews.length];
      if (!persona) return null;
      return {
        phase: "audience", kind: "audience", title: `Audience review ${book.audienceReviews.length + 1}/5`,
        reason: `Valutazione indipendente dal punto di vista di: ${persona}.`,
        nextStep: book.audienceReviews.length === 4 ? "Adversarial review" : "Prossima persona del panel",
        prompt: `Interpreta solo questo profilo: ${persona}. Esamina le idee come un lettore esigente: punti forti, critiche, noia, inconsistenze, curiosità, revisioni necessarie. Sii concreto, non compiacente.${synopsisRule}\n\n${base}`,
        apply: (b, text) => {
          b.audienceReviews.push(`[Persona ${b.audienceReviews.length + 1}] ${text}`);
          if (b.audienceReviews.length >= 5) b.phase = "adversarial";
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
        apply: (b, text) => { const target = ensureScene(b); assertScenePlausible(text, target.text); target.text = text; target.status = "canon"; target.summary = text.slice(0, 520); b.phase = "consolidate"; },
      };
    }
    case "consolidate": {
      const scene = targetScene(book);
      return {
        phase: "consolidate", kind: "consolidate", title: "Consolidamento del canon",
        reason: "Aggiornare personaggi, luoghi, fazioni, oggetti, segreti e timeline dopo la scena.",
        nextStep: "Prossima scena o completamento del libro",
        prompt: `Aggiorna lo stato canonico DOPO la scena appena completata. Mantieni i fatti precedenti ancora validi, correggi conoscenze, spostamenti, oggetti, segreti e cronologia. Non inventare fatti assenti dal testo. Tieni i segreti protetti nei metadati, non svelarli nel romanzo. ${MEMORY_COMPACTION_RULE} ${DELTA_REPLY_RULE}\n\nSCENA CANON:\n${scene?.text ?? "Nessuna scena"}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => {
          const update = applyMemoryResponse(b.memory, parseJson(text));
          b.memory = update.memory; b.currentSceneId = undefined;
          // A real summary of the scene (events and ending) replaces the opening-text fallback.
          if (update.sceneSummary) {
            const done = allScenes(b).find(s => s.id === scene?.id);
            if (done) done.summary = update.sceneSummary;
          }
          const chapter = b.chapters.find(ch => ch.scenes.some(s => s.id === scene?.id));
          if (chapter && !chapter.frozenAt && chapter.scenes.every(s => s.status === "canon")) {
            b.editorialCycle = createEditorialCycle(chapter.id);
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
      if (cycle.stage === "blocked")
        throw new Error(cycle.blockedReason ?? "Redazione bloccata: intervento autore necessario.");
      if (cycle.stage === "review") {
        const next = nextReviewSlot(book, cycle);
        if (!next) throw new Error("Checkpoint revisioni incompleto: nessun revisore disponibile.");
        const historicalSnapshot = next.role === "historical"
          ? captureHistoricalPromptDossier(book, cycle.chapterId, "review") : undefined;
        const prompt = reviewerPrompt(book, cycle, next.role, next.segment, next.segmentCount);
        const title = "Redazione: " + next.role + " " + (cycle.reports.length + 1) + "/" +
          (next.segmentCount * cycleRoles(book, cycle).length);
        return {
          reviewSlot: { key: reviewKey(cycle.chapterId, cycle.round, cycle.reports.length),
            index: cycle.reports.length, expected: next.segmentCount * cycleRoles(book, cycle).length },
          phase: "chapterReview", kind: reviewerTask(next.role), title,
          system: prompt.system,
          reason: "Una chat autonoma controlla solo la sua competenza, senza pareri degli altri agenti.",
          nextStep: "Prossimo revisore o giudizio critico della redazione",
          prompt: prompt.prompt,
          apply: (b, text) => {
            const current = b.editorialCycle;
            const ch = b.chapters.find(c => c.id === cycle.chapterId);
            if (!current || !ch) throw new Error("Il ciclo editoriale è cambiato.");
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
          reason: "Il direttore valuta criticamente tutti e dodici i rapporti senza assumere che siano corretti.",
          nextStep: "Correzioni accettate oppure preparazione del congelamento",
          prompt: prompt.prompt,
          apply: (b, text) => {
            const current = b.editorialCycle;
            if (!current) throw new Error("Ciclo editoriale non disponibile.");
            const chapter = b.chapters.find(c => c.id === current.chapterId);
            if (!chapter) throw new Error("Capitolo del giudice non disponibile.");
            assertCurrentHistoricalPromptDossier(b, historicalSnapshot);
            assertEditorialReviewCoverage(b, current, true);
            current.judgment = validateJudgment(current, text, chapter, b);
            current.stage = current.judgment.verdict === "freeze" ? "summary" : "repair";
            current.repairCursor = 0;
            current.summaryCursor = 0;
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
            "MEMORIA PRECEDENTE: " + checkpoint.memoryJson,
            "SCENA " + segment.sceneId + ", SEGMENTO " + (checkpoint.cursor + 1) +
              "/" + checkpoint.segmentCount + ":\n" + segment.text,
          ].join("\n\n"),
          apply: (b, text) => {
            // The preflight/IndexedDB revision gate is not a substitute for
            // validating the exact checkpoint used by this editorial agent.
            const current = assertCurrentEditorialReconcileStep(b, checkpoint);
            const memory = applyMemoryResponse(b.memory, parseJson(text)).memory;
            b.memory = memory;
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
            "Riassunto libro precedente: " + (cycle.runningBookSummary ?? book.bookSummary ?? ""),
            "Segmento letto: " + segment.sceneId + "\n" + segment.text,
            "Il riassunto del libro deve descrivere quanto è stato realmente raccontato ai lettori.",
          ].join("\n\n"),
          apply: (b, text) => {
            // Guard the EXACT stage/chapter/segment associated with this reply
            // before parsing or writing any summary fields.
            const current = assertCurrentEditorialSummaryStep(b,cycle.chapterId,index);
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
              b.bookSummary = data.bookSummary;
              ch.frozenAt = freezeTime;
              if (current.roles) ch.editorialMode = "light"; else delete ch.editorialMode;
              ch.editorialRounds = [...(ch.editorialRounds ?? []), ...current.priorRounds, {
                round: current.round, reports: current.reports, judgment: current.judgment!,
              }];
              b.editorialCycle = undefined;
              b.currentSceneId = undefined;
              b.phase = "prose";
            }
          },
        };
      }
      throw new Error("Stato di revisione del capitolo sconosciuto.");
    }
    case "revision": {
      const rev = book.revision;
      if (!rev) throw new Error("Revisione senza richiesta dell'autore.");
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
            const earliestChapter = b.chapters.find(ch => ch.scenes.some(s =>
              request.affectedSceneIds.includes(s.id)));
            if (earliestChapter) {
              markDownstreamContinuity(b, earliestChapter, "retroactive_revision",
                earliestChapter.scenes.filter(s => request.affectedSceneIds.includes(s.id))
                  .map(s=>s.id));
              earliestChapter.lastContinuityReview = undefined;
              for (const chapter of b.chapters) {
                if (chapter.number >= earliestChapter.number) {
                  chapter.frozenAt = undefined;
                  chapter.summary = undefined;
                  chapter.bookSummaryAtFreeze = undefined;
                }
              }
              // An interrupted review may hold judged rounds: keep them as history.
              archiveJudgedRounds(b);
              b.editorialCycle = undefined;
              b.bookSummary = synopsisBeforeChapter(b.chapters, earliestChapter.number);
            }
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
        return {
          phase: "revision", kind: "consolidate", title: "Memoria narrativa dopo la revisione",
          reason: "Allineare personaggi, segreti, oggetti e cronologia alle scene riscritte.",
          nextStep: "Nuova redazione dei capitoli toccati e ripresa della scrittura",
          prompt: `L'autore ha chiesto questa revisione: "${rev.instruction}". Sono state riscritte ${rewritten.length} scene: ${rewritten.map(scene => scene.id + " «" + scene.title + "»").join("; ")}. Aggiorna lo stato canonico perché rifletta la NUOVA versione del libro: mantieni i fatti ancora validi, correggi quelli cambiati dalla revisione, non inventare. Tieni i segreti protetti nei metadati. ${MEMORY_COMPACTION_RULE} ${DELTA_REPLY_RULE_NO_SUMMARY}\n\nULTIMA SCENA RISCRITTA:\n${last?.text ?? "Nessuna"}\n\nCONTESTO:\n${base}`,
          apply: (b, text) => {
            const memory = applyMemoryResponse(b.memory, parseJson(text)).memory;
            const current = b.revision;
            if (!current || current.id !== rev.id) throw new Error("Revisione cambiata durante l'aggiornamento della memoria.");
            b.memory = memory;
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
        prompt: `Riscrivi SOLO la scena ${scene.id} in accordo alla nuova istruzione tassativa dell'autore. Preserva i fatti e le parti buone non coinvolte, ma correggi premesse, legami e rimandi per le conseguenze narrative. Restituisci SOLO prosa pronta per il libro.\n\nISTRUZIONE: ${rev.instruction}\n\nTESTO PRECEDENTE:\n${scene.text}\n\nFOCUS DELLA SCENA:\n${sceneFocus(book, scene.id)}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => {
          const target = allScenes(b).find(x => x.id === sceneId);
          if (!target || !b.revision) throw new Error("Revisione non più applicabile.");
          target.text = text; target.status = "canon"; target.summary = text.slice(0, 520); b.revision.cursor++;
        },
      };
    }
    case "completed": return null;
  }
}

const PLANNING_PHASES: readonly Phase[] = ["brainstorm", "validate", "audience", "adversarial", "outline"];
/** Leave the revision phase: back to an interrupted review, to writing, or to planning. */
export function closeRevision(book: BookProject, rev: RevisionRequest): void {
  book.revision = undefined;
  book.currentSceneId = undefined;
  book.phase = book.editorialCycle ? "chapterReview" : book.chapters.length ? "prose" :
    PLANNING_PHASES.includes(rev.beforePhase) ? rev.beforePhase : "brainstorm";
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
      const initial = await getBook(bookId);
      if (!initial) throw new Error("Libro non trovato.");
      if (initial.editorialReviewSceneIds?.length)
        throw new Error("Rileggi e conferma le scene fuse nel Lettore prima di avviare l'autopilot.");
      initial.status = "running"; initial.previousError = undefined;
      await guard.assertActive();
      await saveBook(initial, false); // A run start is not a narrative checkpoint.
      sessionStarted = true;
      await onUpdate();
      // Local, unauthenticated endpoints cost nothing per call: a failed task may
      // be retried a bounded number of times so an unattended run can continue.
      let retries = 0;
      let retryScope = "";
      const pool = new ReviewCallPool();

      try {
      while (!signal.aborted) {
        await guard.assertActive();
        const book = await getBook(bookId);
        if (!book || book.status !== "running") break;
        if (this.stopAfter) {
          book.status = "paused";
          book.previousError = undefined;
          await saveBook(book, false);
          await onUpdate();
          break;
        }
        // A previously canonical chapter is not final until the independent board freezes it.
        if (book.phase === "prose" && !book.editorialCycle) {
          const ready = [...book.chapters]
            .filter(ch => !ch.frozenAt && ch.scenes.length > 0 &&
              ch.scenes.every(scene => scene.status === "canon"))
            .sort((a,b)=>a.number-b.number)
            .find(ch => book.chapters.every(prev =>
              prev.number >= ch.number || !!prev.frozenAt));
          if (ready) {
            book.editorialCycle = createEditorialCycle(ready.id);
            book.phase = "chapterReview";
            await saveBook(book, false);
            await onUpdate();
            continue;
          }
        }
        if (book.editorialReviewSceneIds?.length) {
          book.status = "paused";
          book.previousError = "Alcune scene fuse attendono conferma editoriale nel Lettore.";
          await saveBook(book, false);
          await onUpdate();
          break;
        }
        if (revisionClosableLocally(book)) {
          const expected = book.updatedAt;
          const instruction = book.revision.instruction;
          closeRevision(book, book.revision);
          const now = new Date().toISOString();
          await saveBookAndActivity(book, {
            id: crypto.randomUUID(), bookId, runId, phase: "revision",
            title: "Revisione chiusa senza riscritture",
            reason: "L'analisi d'impatto non ha individuato scene già scritte da cambiare.",
            nextStep: "L'istruzione resta un vincolo permanente per i prossimi task.",
            status: "succeeded", aiRequested: false, createdAt: now, endedAt: now,
            summary: shortSummary("Nessuna scena riscritta per: " + instruction),
          }, expected);
          await onUpdate();
          continue;
        }
        let work: Work | null;
        try {
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
            book.phase = "adversarial"; await saveBook(book, false); continue;
          }
          book.phase = "completed"; book.status = "completed";
          await saveBook(book); await onUpdate(); break;
        }
        const settings = await loadSettings();
        const assignment = routeFor(work.kind, settings, book);
        const configuredEndpoint=settings.endpoints.find(e=>e.id===assignment.endpointId);
        const requestedEffort=configuredEndpoint
          ? taskReasoningChoice(work.kind,settings,book,configuredEndpoint,assignment.modelId):undefined;
        // Author next-step notes go only to tasks that already see the private canon.
        const notes = !work.noAuthorNotes && taskAcceptsAuthorNotes(work.kind) ? pendingAuthorNotes(book) : [];
        const userPrompt = withAuthorNotes(work.prompt, notes);
        const systemPrompt = work.system ?? "Sei un editor e romanziere esperto. Segui rigorosamente le istruzioni dell'autore. Evita banalità, contraddizioni, spoiler prematuri e affermazioni fattuali non verificate. Rispondi solo nel formato richiesto.";
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
          const latest = await getBook(bookId);
          if (!latest || latest.status !== "running" || latest.phase !== work.phase ||
              latest.updatedAt !== book.updatedAt)
            throw new DOMException("Il libro è cambiato durante la chiamata AI: risultato non applicato.", "AbortError");
          work.apply(latest, result.text);
          started.status = "succeeded"; started.endedAt = new Date().toISOString();
          started.summary = shortSummary(result.text); started.output = result.text;
          // Atomic with the canon commit below: a failed task leaves notes pending.
          markAuthorNotesApplied(latest, notes.map(note => note.id), started.id, work.title, started.endedAt);
          if(settings.inspectAiRequests) {
            await saveAiTrace({
              activityId:started.id,bookId,createdAt:started.createdAt,
              endpointId:assignment.endpointId,modelId:assignment.modelId,
              systemPrompt,userPrompt,response:result.text,
              reasoning:currentLiveAi()?.activityId===started.id
                ? currentLiveAi()?.reasoningPreview : undefined,
              truncated:false,
            });
          }
          // One more fencing check before canonizing output in IndexedDB.
          await guard.assertActive();
          // The revision checked after the provider call must still be
          // current inside the SAME IndexedDB transaction as canon + audit.
          // A non-cooperating writer can update after getBook above.
          await saveBookAndActivity(latest, started, book.updatedAt);
          finishLiveAi(started.id,"completata");
          retries = 0;
          await onUpdate();
        } catch (error) {
          const message=error instanceof ProviderResponseReadError || error instanceof TruncatedProviderContentError ||
            error instanceof PromptExceedsContextError?error.message:
            error instanceof Error && error.name==="ProviderHeaderTimeoutError"?error.message:
            "La richiesta non ha prodotto un risultato applicabile. Apri il task per vedere l'errore.";
          finishLiveAi(started.id,signal.aborted?"interrotta":"rifiutata",message);
          // HTTP 200 + valid JSON can report usage with empty or malformed
          // content. Keep the observed counters on failure, without approving
          // a report, chapter or remediation.
          keepObservedUsageOnRejectedReply(started, error);
          if (error instanceof BookRevisionConflict) {
            // A competing writer committed after the post-model read. The
            // attempted request may still have cost tokens, but we must not
            // overwrite the competing book (even just to mark it paused).
            started.status = "cancelled";
            // These fields were prepared for the successful canon commit but
            // must not leak into the standalone attempted-request audit.
            delete started.summary;
            delete started.output;
            started.error = "Il libro è cambiato durante il salvataggio AI: risultato non applicato. Ricarica prima di riprendere.";
            started.endedAt = new Date().toISOString();
            await saveActivity(started);
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
          const retryKey = work.phase + ":" + work.title;
          if (retryScope !== retryKey) { retryScope = retryKey; retries = 0; }
          const retryPolicy = endpointAutoRetry(configuredEndpoint);
          const willRetry = !aborted && !leaseFailure && !budgetStop && started.aiRequested === true &&
            retryPolicy.enabled && isAutoRetryable(error) &&
            retries < retryPolicy.max && !this.stopAfter && !signal.aborted;
          if (willRetry) retries++;
          const latest = await getBook(bookId);
          if (latest) {
            latest.status = willRetry ? "running" : aborted || budgetStop ? "paused" : "error";
            latest.previousError = willRetry
              ? `Tentativo ${retries}/${retryPolicy.max} fallito su «${work.title}»: ${started.error} Riprovo automaticamente.`
              : started.error;
            await saveBookAndActivity(latest, started);
          } else await saveActivity(started);
          await onUpdate();
          if (willRetry && latest) {
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
        current.status = signal.aborted && !(error instanceof RemoteWriterLost) ? "paused" : "error";
        current.previousError = message;
        await saveBook(current, false);
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
