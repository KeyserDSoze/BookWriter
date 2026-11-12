import { z } from "zod";
import type { Activity, BookProject, Chapter, NarrativeMemory, Phase, RevisionRequest, Scene, TaskKind } from "../domain/types";
import { callModel } from "../infrastructure/ai";
import { addAiDelta, currentLiveAi, finishLiveAi, markAiHeader, markAiTransport, markNativePhase,
  saveAiTrace, startLiveAi } from "../infrastructure/ai-observability";
import { taskReasoningChoice } from "../domain/task-reasoning";
import { ProviderResponseReadError } from "../infrastructure/ai-completion-response";
import { keepObservedUsageOnRejectedReply } from "../infrastructure/ai-provider-error";
import { BookRevisionConflict, getBook, listActivities, loadSettings, saveActivity, saveBook, saveBookAndActivity } from "../infrastructure/db";
import { withWriterGuard } from "./writer-guard";
import { RemoteWriterLost } from "../infrastructure/github-lease";
import { acceptedRepairs, adjudicationPrompt, assertCurrentEditorialReconcileStep, assertEditorialReviewCoverage, assertSavedEditorialFreezeJudgmentIntegrity, assertCurrentEditorialSummaryStep, beginNextRound, captureEditorialReconcileStep, chapterSegments, createEditorialCycle, nextReviewSlot, repairPrompt, reviewerPrompt, reviewerTask, validateJudgment, validateReport } from "../domain/editorial-board";
import { assertCurrentHistoricalPromptDossier, captureHistoricalPromptDossier } from "../domain/historical-research";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { assertPriorChaptersFrozen, completeContinuityRecheck, markDownstreamContinuity } from "../domain/cross-chapter-continuity";
import { routeFor } from "../domain/types";
import { AiBudgetStop, preflightBookAiBudget, snapshotPriceRate } from "../domain/ai-budget";

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
const memorySchema = z.object({
  characters: z.record(z.string(), z.string()),
  locations: z.record(z.string(), z.string()),
  factions: z.record(z.string(), z.string()),
  items: z.record(z.string(), z.string()),
  secrets: z.record(z.string(), z.string()),
  timeline: z.array(z.string()),
  currentState: z.string(),
});
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
  phase: Phase;
  kind: TaskKind;
  title: string;
  reason: string;
  nextStep: string;
  prompt: string;
  apply: (book: BookProject, response: string) => void;
};

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return JSON.parse(cleaned) as unknown;
}
function context(book: BookProject): string {
  const previous = book.chapters.flatMap(chapter => chapter.scenes
    .filter(scene => scene.status === "canon")
    .map(scene => ({
      chapter: chapter.title, scene: scene.title,
      summary: scene.summary ?? scene.text.slice(0, 500),
    })));
  const recent = previous.slice(-12).map(x => `- ${x.chapter} / ${x.scene}: ${x.summary}`).join("\n");
  const outline = book.chapters.map(ch => `${ch.number}. ${ch.title}: ${ch.purpose}\n${ch.scenes.map(s => `  - ${s.id}: ${s.title}: ${s.objective}`).join("\n")}`).join("\n");
  return [
    `Titolo: ${book.title}`, `Brief: ${book.brief}`,
    `Stile: ${book.writingStyle}`, `Audience: ${book.audience}`,
    `Vincoli inderogabili dell'autore:\n${(book.authorConstraints ?? []).join("\n") || "Nessuno"}`,
    `Idee:\n${book.ideas ?? "Da generare"}`,
    `Validazione:\n${book.validation ?? "Da svolgere"}`,
    `Review lettori:\n${book.audienceReviews.join("\n")}`,
    `Critica adversarial:\n${book.adversarial ?? "Da svolgere"}`,
    `Outline:\n${outline}`,
    `Stato narrativo consolidato:\n${JSON.stringify(book.memory)}`,
    `Ultime scene canoniche:\n${recent}`,
  ].join("\n\n");
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

function nextWork(book: BookProject): Work | null {
  const base = context(book);
  switch (book.phase) {
    case "brainstorm":
      return {
        phase: "brainstorm", kind: "brainstorm", title: "Brainstorming su tre orizzonti",
        reason: "Generare alternative e motivazioni prima di fissare la trama.",
        nextStep: "Validazione delle idee",
        prompt: `Genera idee ORIGINALI e longeve per questo libro, divise chiaramente in LONG-TERM (arco totale e rivelazioni), MID-TERM (archi e capitoli), SHORT-TERM (scene e beat). Proponi alternative, conflitti, conseguenze, rischi di cliché, indizi, payoff e criteri di selezione. Non passare ancora alla prosa.\n\n${base}`,
        apply: (b, text) => { b.ideas = text; b.phase = "validate"; },
      };
    case "validate":
      return {
        phase: "validate", kind: "validate", title: "Validazione delle idee",
        reason: "Scartare incoerenze, banalità e idee che violano il brief.",
        nextStep: "Review di cinque tipologie di lettori",
        prompt: `Valida criticamente queste idee: tensione, causalità, fattibilità, originalità, coerenza temporale e fedeltà al brief. Non dichiarare verificati fatti esterni senza fonti. Proponi correzioni precise e decisioni per la trama.\n\n${base}`,
        apply: (b, text) => { b.validation = text; b.phase = "audience"; },
      };
    case "audience": {
      const persona = PERSONAS[book.audienceReviews.length];
      if (!persona) return null;
      return {
        phase: "audience", kind: "audience", title: `Audience review ${book.audienceReviews.length + 1}/5`,
        reason: `Valutazione indipendente dal punto di vista di: ${persona}.`,
        nextStep: book.audienceReviews.length === 4 ? "Adversarial review" : "Prossima persona del panel",
        prompt: `Interpreta solo questo profilo: ${persona}. Esamina le idee come un lettore esigente: punti forti, critiche, noia, inconsistenze, curiosità, revisioni necessarie. Sii concreto, non compiacente.\n\n${base}`,
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
        prompt: `Cerca aggressivamente buchi di trama, colpi di scena prevedibili, deus ex machina, anticipazioni indebite dei segreti, motivazioni piatte, scene senza conflitto. Elenca problemi con gravità e correzioni proposte, considerando il panel di cinque lettori.\n\n${base}`,
        apply: (b, text) => { b.adversarial = text; b.phase = "outline"; },
      };
    case "outline":
      return {
        phase: "outline", kind: "outline", title: "Piano dei capitoli",
        reason: "Trasformare la visione in scene scrivibili e verificabili.",
        nextStep: "Scrittura della prima scena",
        prompt: `Crea un piano completo e lungimirante del libro. Rispetta istruzioni e capitoli forniti dall'autore. Ogni capitolo include più scene ("paragrafi" Narrarium), con obiettivo narrativo, conflitto, causa ed effetto, indizi distribuiti e payoff successivi. Restituisci ESCLUSIVAMENTE un oggetto JSON valido in questo formato: {"chapters":[{"title":"...","purpose":"...","scenes":[{"title":"...","objective":"..."}]}]}. Niente Markdown o testo extra.\n\n${base}`,
        apply: (b, text) => {
          const parsed = chapterSchema.parse(parseJson(text));
          b.chapters = parsed.chapters.map((chapter, ci): Chapter => ({
            id: `chapter:${String(ci + 1).padStart(3, "0")}`,
            number: ci + 1, title: chapter.title, purpose: chapter.purpose,
            scenes: chapter.scenes.map((scene, si): Scene => ({
              id: `scene:${String(ci + 1).padStart(3, "0")}:${String(si + 1).padStart(3, "0")}`,
              number: si + 1, title: scene.title, objective: scene.objective,
              text: "", status: "planned",
            })),
          }));
          b.phase = "prose";
        },
      };
    case "prose": {
      const pending = allScenes(book).find(x => x.status !== "canon");
      if (!pending) return null;
      return {
        phase: "prose", kind: "prose", title: `Scrittura: ${pending.title}`,
        reason: "Sviluppare una singola scena coerente con i vincoli e il canone.",
        nextStep: "Review di continuità, stile e segreti",
        prompt: `Scrivi SOLTANTO la scena ${pending.id}: "${pending.title}". Obiettivo: ${pending.objective}. Sviluppa prosa letteraria completa (non scaletta), con causa-effetto, POV coerente, dialoghi e dettagli credibili, senza svelare segreti prima del momento. Ricorda che una scena/paragrafo Narrarium può includere diversi paragrafi tipografici. Evita cliché, riassunti al posto della scena e meta-commenti. Restituisci SOLO il testo della scena.\n\n${base}`,
        apply: (b, text) => {
          const scene = allScenes(b).find(x => x.id === pending.id);
          if (!scene) throw new Error("La scena è stata modificata durante la generazione.");
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
        prompt: `Rivedi e RISCRIVI la scena qui sotto in forma finale. Controlla coerenza con brief, outline, voci dei personaggi, stato, cronologia, oggetti e segreti. Applica show-don't-tell dove serve, evita contraddizioni e rivelazioni premature. Restituisci SOLTANTO il testo corretto.\n\nSCENA:\n${scene.text}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => { const target = ensureScene(b); target.text = text; target.status = "canon"; target.summary = text.slice(0, 520); b.phase = "consolidate"; },
      };
    }
    case "consolidate": {
      const scene = targetScene(book);
      return {
        phase: "consolidate", kind: "consolidate", title: "Consolidamento del canon",
        reason: "Aggiornare personaggi, luoghi, fazioni, oggetti, segreti e timeline dopo la scena.",
        nextStep: "Prossima scena o completamento del libro",
        prompt: `Aggiorna lo stato canonico DOPO la scena appena completata. Mantieni i fatti precedenti ancora validi, correggi conoscenze, spostamenti, oggetti, segreti e cronologia. Non inventare fatti assenti dal testo. Tieni i segreti protetti nei metadati, non svelarli nel romanzo. Restituisci ESCLUSIVAMENTE JSON valido con i campi: {"characters":{"nome":"stato"},"locations":{"nome":"stato"},"factions":{},"items":{},"secrets":{"id":"stato privato e quando rivelare"},"timeline":["evento"],"currentState":"riassunto stato attuale"}.\n\nSCENA CANON:\n${scene?.text ?? "Nessuna scena"}\n\nCONTESTO:\n${base}`,
        apply: (b, text) => {
          const memory = memorySchema.parse(parseJson(text));
          b.memory = memory as NarrativeMemory; b.currentSceneId = undefined;
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
          (next.segmentCount * 12);
        return {
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
            "Rispondi SOLO JSON valido con campi characters,locations,factions,items,secrets,timeline,currentState.",
            "MEMORIA PRECEDENTE: " + checkpoint.memoryJson,
            "SCENA " + segment.sceneId + ", SEGMENTO " + (checkpoint.cursor + 1) +
              "/" + checkpoint.segmentCount + ":\n" + segment.text,
          ].join("\n\n"),
          apply: (b, text) => {
            // The preflight/IndexedDB revision gate is not a substitute for
            // validating the exact checkpoint used by this editorial agent.
            const current = assertCurrentEditorialReconcileStep(b, checkpoint);
            const memory = memorySchema.parse(parseJson(text)) as NarrativeMemory;
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
      if (!rev.impactAnalysis) {
        return {
          phase: "revision", kind: "revision", title: "Analisi d'impatto della correzione",
          reason: "Individuare le scene da cambiare e i rimandi narrativi da rivalidare.",
          nextStep: "Revisione retroattiva delle scene coinvolte",
          prompt: `L'autore ha impartito questa istruzione PRIORITARIA: "${rev.instruction}". Identifica gli ID delle scene canoniche coinvolte direttamente o indirettamente, senza inventare ID. Rispondi ESCLUSIVAMENTE JSON {"rationale":"...","affectedSceneIds":["scene:001:001"]}.\n\n${base}`,
          apply: (b, text) => {
            const impact = impactSchema.parse(parseJson(text));
            const request = b.revision!;
            const canonical = allScenes(b).filter(x => x.status === "canon");
            const requested = new Set(impact.affectedSceneIds);
            const earliest = canonical.findIndex(x => requested.has(x.id));
            // Rivedere anche le scene successive per non introdurre incoerenze.
            request.affectedSceneIds = (earliest < 0 ? canonical : canonical.slice(earliest)).map(x => x.id);
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
              b.editorialCycle = undefined;
              b.bookSummary = synopsisBeforeChapter(b.chapters, earliestChapter.number);
            }
            request.impactAnalysis = impact.rationale;
            request.cursor = 0;
          },
        };
      }
      const sceneId = rev.affectedSceneIds[rev.cursor];
      if (!sceneId) {
        return {
          phase: "revision", kind: "revision", title: "Finalizzazione revisione",
          reason: "Ricollegare il flusso alla scrittura dopo la correzione.",
          nextStep: "Ripresa autopilot",
          prompt: `Riassumi brevemente i vincoli da rispettare dopo la modifica: ${rev.instruction}.\n\n${base}`,
          apply: b => { b.revision = undefined; b.phase = b.chapters.length ? "prose" : rev.beforePhase; b.currentSceneId = undefined; },
        };
      }
      const scene = allScenes(book).find(x => x.id === sceneId);
      if (!scene) throw new Error("Una scena della revisione non esiste più.");
      return {
        phase: "revision", kind: "revision", title: `Revisione retroattiva: ${scene.title}`,
        reason: `Istruzione dell'autore: ${rev.instruction}`,
        nextStep: "Scena seguente o ripresa scrittura",
        prompt: `Riscrivi SOLO la scena ${scene.id} in accordo alla nuova istruzione tassativa dell'autore. Preserva i fatti e le parti buone non coinvolte, ma correggi premesse, legami e rimandi per le conseguenze narrative. Restituisci SOLO prosa pronta per il libro.\n\nISTRUZIONE: ${rev.instruction}\n\nTESTO PRECEDENTE:\n${scene.text}\n\nCONTESTO:\n${base}`,
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

function shortSummary(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 340 ? `${clean.slice(0, 337)}…` : clean;
}

export class AutopilotRunner {
  private abort?: AbortController;
  private active = false;

  get running() { return this.active; }

  stop() { this.abort?.abort(); }

  async run(bookId: string, onUpdate: () => Promise<void>): Promise<void> {
    if (this.active) return;
    this.active = true;
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

      while (!signal.aborted) {
        await guard.assertActive();
        const book = await getBook(bookId);
        if (!book || book.status !== "running") break;
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
        const work = nextWork(book);
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
          ? taskReasoningChoice(work.kind,settings,book,configuredEndpoint):undefined;
        const started: Activity = {
          id: crypto.randomUUID(), bookId, runId,
          phase: work.phase, title: work.title, reason: work.reason,
          nextStep: work.nextStep, status: "running",
          createdAt: new Date().toISOString(),
          endpointId: assignment.endpointId, modelId: assignment.modelId,
          aiRequested: false,
          ...(requestedEffort===undefined?{}:{requestedReasoningEffort:requestedEffort}),
        };
        await saveActivity(started);
        await onUpdate();
        try {
          await guard.assertActive(); // Do not charge credits without verified ownership.
          const systemPrompt = work.system ?? "Sei un editor e romanziere esperto. Segui rigorosamente le istruzioni dell'autore. Evita banalità, contraddizioni, spoiler prematuri e affermazioni fattuali non verificate. Rispondi solo nel formato richiesto.";
          const preflight = preflightBookAiBudget(
            book, settings, await listActivities(bookId), work.kind, systemPrompt, work.prompt, runId,
          );
          await guard.assertActive();
          if (signal.aborted) throw new DOMException("Interrotto prima della chiamata AI.", "AbortError");
          // Store the author's validated price BEFORE the provider call.
          // The quote belongs to this attempt even if its output is rejected.
          const quote = snapshotPriceRate(settings, assignment.endpointId, assignment.modelId);
          if (quote) started.priceRateSnapshot = quote;
          // Persist the request attempt BEFORE network fetch: an interrupted browser
          // must not misrepresent a possibly billed call as a free operation.
          if(settings.inspectAiRequests) {
            // Explicitly local, sensitive opt-in. Never stored in Activity
            // or exported to ZIP, GitHub or sync.
            await saveAiTrace({
              activityId:started.id,bookId,createdAt:started.createdAt,
              endpointId:assignment.endpointId,modelId:assignment.modelId,
              systemPrompt,userPrompt:work.prompt,truncated:false,
            });
          }
          started.aiRequested = true;
          await saveActivity(started);
          startLiveAi({
            activityId:started.id,bookId,title:work.title,
            endpointId:assignment.endpointId,modelId:assignment.modelId,
            inspect:settings.inspectAiRequests === true,
            ...(requestedEffort===undefined?{}:{requestedReasoning:requestedEffort}),
            streamDeadlineSeconds:configuredEndpoint?.streamTimeoutSeconds??600,
          });
          const inspectStream = settings.inspectAiRequests===true ||
            configuredEndpoint?.streamMode==="sse" ||
            configuredEndpoint?.apiProtocol==="lmstudio_native";
          const result = await callModel(work.kind, systemPrompt, work.prompt, settings, book, signal,
            preflight || inspectStream ? {
              ...(preflight ? { maxOutputTokens: preflight.reservedOutputTokens } : {}),
              ...(inspectStream ? {
                onHeaders:()=>markAiHeader(started.id),
                onProgress:(delta:import("../infrastructure/ai-stream").AiStreamDelta)=>addAiDelta(started.id,delta),
                onTransport:(stats:import("../infrastructure/lmstudio-native").AiTransportStats)=>
                  markAiTransport(started.id,stats),
                onPhase:(phase:import("../infrastructure/lmstudio-native").LmStudioPhase)=>
                  markNativePhase(started.id,phase),
              } : {}),
            } : undefined);
          // A provider reply may carry usage even when the editorial schema,
          // freshness gate or writer lease rejects its text. Capture the
          // observed counts before validation so the failed/cancelled Activity
          // still accounts for a potentially billed request.
          started.endpointId = result.endpointId;
          started.modelId = result.modelId;
          started.inputTokens = result.inputTokens;
          started.outputTokens = result.outputTokens;
          await guard.assertActive(); // Discard result if the lease was lost during the AI call.
          const latest = await getBook(bookId);
          if (!latest || latest.status !== "running" || latest.phase !== work.phase ||
              latest.updatedAt !== book.updatedAt)
            throw new DOMException("Il libro è cambiato durante la chiamata AI: risultato non applicato.", "AbortError");
          work.apply(latest, result.text);
          started.status = "succeeded"; started.endedAt = new Date().toISOString();
          started.summary = shortSummary(result.text); started.output = result.text;
          if(settings.inspectAiRequests) {
            await saveAiTrace({
              activityId:started.id,bookId,createdAt:started.createdAt,
              endpointId:assignment.endpointId,modelId:assignment.modelId,
              systemPrompt,userPrompt:work.prompt,response:result.text,
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
          await onUpdate();
        } catch (error) {
          const message=error instanceof ProviderResponseReadError?error.message:
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
          const latest = await getBook(bookId);
          if (latest) {
            latest.status = aborted || budgetStop ? "paused" : "error";
            latest.previousError = started.error;
            await saveBookAndActivity(latest, started);
          } else await saveActivity(started);
          await onUpdate();
          break;
        }
      }
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
 * A manual instruction must not overwrite a newer chapter or checkpoint
 * from an AI writer or another tab. Keep the writer Web Lock until the
 * IndexedDB compare-and-swap and any outbox work have finished.
 */
export async function requestRevision(
  bookId: string, instruction: string, expectedUpdatedAt: string,
): Promise<void> {
  const normalized = instruction.trim();
  if (!normalized) throw new Error("Scrivi la modifica che desideri.");
  if (!expectedUpdatedAt) throw new BookRevisionConflict();

  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: revisione bloccata per evitare scritture concorrenti.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Un'altra scheda sta scrivendo questo libro: attendi prima di richiedere una revisione.");
    const book = await getBook(bookId);
    if (!book) throw new Error("Libro non trovato.");
    if (book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
    if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
    if (book.editorialCycle)
      throw new Error("La redazione del capitolo è attiva o bloccata. Completa il ciclo o usa la riapertura nel pannello Redazione.");
    if (book.editorialReviewSceneIds?.length)
      throw new Error("Conferma le scene fuse nel Lettore prima di richiedere altre revisioni AI.");

    book.authorConstraints = [...(book.authorConstraints ?? []), normalized];
    const rev: RevisionRequest = {
      id: crypto.randomUUID(), instruction: normalized, beforePhase: book.phase,
      affectedSceneIds: [], cursor: 0,
    };
    book.revision = rev;
    book.phase = "revision"; book.status = "paused";
    // Check the revision again inside the books+outbox transaction: a
    // non-cooperating writer might have changed IndexedDB since getBook.
    await saveBook(book, true, expectedUpdatedAt);
  });
}
