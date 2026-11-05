import { z } from "zod";
import type { Activity, BookProject, Chapter, NarrativeMemory, Phase, RevisionRequest, Scene, TaskKind } from "../domain/types";
import { callModel } from "../infrastructure/ai";
import { getBook, loadSettings, saveActivity, saveBook, saveBookAndActivity } from "../infrastructure/db";
import { withWriterGuard } from "./writer-guard";

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
          b.memory = memory as NarrativeMemory; b.currentSceneId = undefined; b.phase = "prose";
        },
      };
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
      initial.status = "running"; initial.previousError = undefined;
      await guard.assertActive();
      await saveBook(initial, false); // A run start is not a narrative checkpoint.
      sessionStarted = true;
      await onUpdate();

      while (!signal.aborted) {
        await guard.assertActive();
        const book = await getBook(bookId);
        if (!book || book.status !== "running") break;
        const work = nextWork(book);
        if (!work) {
          if (book.phase === "audience" && book.audienceReviews.length >= 5) {
            book.phase = "adversarial"; await saveBook(book, false); continue;
          }
          book.phase = "completed"; book.status = "completed";
          await saveBook(book); await onUpdate(); break;
        }
        const settings = await loadSettings();
        const started: Activity = {
          id: crypto.randomUUID(), bookId, runId,
          phase: work.phase, title: work.title, reason: work.reason,
          nextStep: work.nextStep, status: "running",
          createdAt: new Date().toISOString(),
        };
        await saveActivity(started);
        await onUpdate();
        try {
          await guard.assertActive(); // Do not charge credits without verified ownership.
          const result = await callModel(work.kind, "Sei un editor e romanziere esperto. Segui rigorosamente le istruzioni dell'autore. Evita banalità, contraddizioni, spoiler prematuri e affermazioni fattuali non verificate. Rispondi solo nel formato richiesto.", work.prompt, settings, book, signal);
          await guard.assertActive(); // Discard result if the lease was lost during the AI call.
          const latest = await getBook(bookId);
          if (!latest || latest.status !== "running" || latest.phase !== work.phase)
            throw new DOMException("La sessione è cambiata.", "AbortError");
          work.apply(latest, result.text);
          started.status = "succeeded"; started.endedAt = new Date().toISOString();
          started.endpointId = result.endpointId; started.modelId = result.modelId;
          started.inputTokens = result.inputTokens; started.outputTokens = result.outputTokens;
          started.summary = shortSummary(result.text); started.output = result.text;
          // One more fencing check before canonizing output in IndexedDB.
          await guard.assertActive();
          await saveBookAndActivity(latest, started);
          await onUpdate();
        } catch (error) {
          const leaseFailure = guard.failure();
          const aborted = !leaseFailure && (signal.aborted || error instanceof DOMException && error.name === "AbortError");
          started.status = aborted ? "cancelled" : "failed";
          started.error = leaseFailure?.message ?? (aborted
            ? "Attività interrotta; nessun output canonizzato."
            : error instanceof Error ? error.message : "Errore sconosciuto.");
          started.endedAt = new Date().toISOString();
          const latest = await getBook(bookId);
          if (latest) {
            latest.status = aborted ? "paused" : "error";
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
      if (sessionStarted) {
        const current = await getBook(bookId);
        if (current?.status === "running") {
          current.status = signal.aborted ? "paused" : "error";
          current.previousError = error instanceof Error ? error.message : "Lock remoto non disponibile.";
          await saveBook(current, false);
        }
      }
      throw error;
    } finally {
      this.active = false;
      this.abort = undefined;
      await onUpdate();
    }
  }
}

export async function requestRevision(bookId: string, instruction: string): Promise<void> {
  const book = await getBook(bookId);
  if (!book) throw new Error("Libro non trovato.");
  if (!instruction.trim()) throw new Error("Scrivi la modifica che desideri.");
  if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
  book.authorConstraints = [...(book.authorConstraints ?? []), instruction.trim()];
  const rev: RevisionRequest = {
    id: crypto.randomUUID(), instruction: instruction.trim(), beforePhase: book.phase,
    affectedSceneIds: [], cursor: 0,
  };
  book.revision = rev;
  book.phase = "revision"; book.status = "paused";
  await saveBook(book);
}
