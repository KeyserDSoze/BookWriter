import type { Activity, AppSettings, BookProject, ModelRoute, Phase } from "../domain/types";
import { appendResearchLog, cachedResearch, parseSearchModelReply, screenQueries, SEARCH_MODEL_SYSTEM,
  webResearchSettingsSchema, type ResearchEntry, type WebResearchSettings } from "../domain/web-research";
import { AiBudgetStop } from "../domain/ai-budget";
import { keepObservedUsageOnRejectedReply } from "../infrastructure/ai-provider-error";
import { finishLiveAi } from "../infrastructure/ai-observability";
import { BookRevisionConflict, getBook, loadSettings, saveActivity, saveBook } from "../infrastructure/db";
import { searchWikipedia } from "../infrastructure/web-search";
import { launchModelCall } from "./model-call";
import { mutateAsAuthor } from "./author-mutation";
import type { WriterGuard } from "./writer-guard";

/** The search model must be chosen explicitly: a writing model without web access
 * would only answer from memory and look like a verified search. */
export function researchRoute(settings: AppSettings, book: BookProject): ModelRoute | undefined {
  const route = book.modelRoutes?.research ?? settings.taskRoutes.research;
  return route?.endpointId && route.modelId ? route : undefined;
}

export interface ResearchRun {
  book: BookProject; settings: AppSettings; runId: string; guard: WriterGuard; signal: AbortSignal;
  phase: Phase; taskTitle: string; reason: string; queries: readonly string[]; live?: boolean;
}
const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** Run the screened queries one at a time. Each model search is its own audited,
 * budget-checked AI call; Wikipedia is a plain read. A failed query is reported to
 * the task instead of stopping the book, except a budget stop or an abort. */
export async function runResearchQueries(run: ResearchRun): Promise<ResearchEntry[]> {
  const { book, settings, signal } = run;
  const config = book.webResearch;
  if (!config?.enabled) throw new Error("Ricerca web non attiva per questo libro.");
  const { allowed, blocked } = screenQueries(run.queries, book);
  const now = () => new Date().toISOString();
  const base = (query: string): Pick<ResearchEntry, "id" | "at" | "query" | "provider" | "taskTitle" | "reason"> =>
    ({ id: crypto.randomUUID(), at: now(), query, provider: config.provider, taskTitle: run.taskTitle.slice(0, 300),
      ...(run.reason ? { reason: run.reason.slice(0, 500) } : {}) });
  const entries: ResearchEntry[] = blocked.map(query => ({ ...base(query), status: "blocked", summary: "", sources: [],
    error: "La query citava un segreto del libro: non è stata inviata." }));
  for (const query of allowed) {
    if (signal.aborted) throw new DOMException("Ricerca interrotta.", "AbortError");
    const cached = cachedResearch(book.webResearchLog, query, config.provider, new Date(), config.cacheDays);
    if (cached) {
      entries.push({ ...base(query), status: "cached", summary: cached.summary, sources: cached.sources,
        ...(cached.endpointId ? { endpointId: cached.endpointId } : {}), ...(cached.modelId ? { modelId: cached.modelId } : {}) });
      continue;
    }
    if (config.provider === "wikipedia") {
      try {
        const found = await searchWikipedia(query, config.wikipediaLanguage, signal);
        entries.push({ ...base(query), status: "ok", ...found });
      } catch (error) {
        if (aborted(error) || signal.aborted) throw error;
        entries.push({ ...base(query), status: "failed", summary: "", sources: [],
          error: (error instanceof Error ? error.message : "Ricerca non riuscita.").slice(0, 500) });
      }
      continue;
    }
    const route = researchRoute(settings, book);
    if (!route) {
      entries.push({ ...base(query), status: "failed", summary: "", sources: [],
        error: "Modello di ricerca non configurato: sceglilo nel router («Ricerca web») o nella pagina del libro." });
      continue;
    }
    const started: Activity = {
      id: crypto.randomUUID(), bookId: book.id, runId: run.runId, phase: run.phase,
      title: "Ricerca web: «" + query.slice(0, 120) + "»",
      reason: "Richiesta da «" + run.taskTitle.slice(0, 160) + "»" + (run.reason ? ": " + run.reason.slice(0, 200) : "."),
      nextStep: "Il task che ha chiesto la ricerca riparte con i risultati.",
      status: "running", createdAt: now(), endpointId: route.endpointId, modelId: route.modelId, aiRequested: false,
    };
    await saveActivity(started);
    try {
      const { promise } = await launchModelCall({
        book, settings, runId: run.runId, guard: run.guard, signal, kind: "research", title: started.title,
        systemPrompt: SEARCH_MODEL_SYSTEM, userPrompt: "Domanda di ricerca: " + query, started, assignment: route,
        configuredEndpoint: settings.endpoints.find(e => e.id === route.endpointId), persisted: true, live: run.live ?? true,
      });
      const answer = await promise;
      started.endpointId = answer.endpointId; started.modelId = answer.modelId;
      started.inputTokens = answer.inputTokens; started.outputTokens = answer.outputTokens;
      started.cachedInputTokens = answer.cachedInputTokens;
      const found = parseSearchModelReply(answer.text);
      started.status = "succeeded"; started.endedAt = now();
      started.summary = (found.sources.length + " fonti · " + found.summary).slice(0, 340);
      started.output = answer.text;
      await saveActivity(started);
      finishLiveAi(started.id, "completata");
      entries.push({ ...base(query), status: "ok", ...found, endpointId: answer.endpointId, modelId: answer.modelId, activityId: started.id });
    } catch (error) {
      keepObservedUsageOnRejectedReply(started, error);
      const stop = aborted(error) || signal.aborted;
      started.status = stop ? "cancelled" : "failed";
      started.error = (error instanceof Error ? error.message : "Ricerca non riuscita.").slice(0, 2000);
      started.endedAt = now();
      await saveActivity(started);
      finishLiveAi(started.id, stop ? "interrotta" : "rifiutata", started.error);
      if (stop || error instanceof AiBudgetStop) throw error;
      entries.push({ ...base(query), status: "failed", summary: "", sources: [], error: started.error.slice(0, 500), activityId: started.id });
    }
  }
  return entries;
}

/** Append to the book's log. Metadata only: re-read and retry on a concurrent
 * author edit, never overwrite the newer book. Not a narrative checkpoint. */
export async function persistResearchLog(bookId: string, entries: readonly ResearchEntry[]): Promise<void> {
  if (!entries.length) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    const book = await getBook(bookId);
    if (!book) return;
    const token = book.updatedAt;
    book.webResearchLog = appendResearchLog(book.webResearchLog, entries);
    try { await saveBook(book, false, token); return; }
    catch (error) { if (!(error instanceof BookRevisionConflict)) throw error; }
  }
  throw new Error("Il registro delle ricerche non è stato salvato: il libro cambiava di continuo.");
}

export async function updateWebResearchSettings(bookId: string, value: WebResearchSettings | undefined, expectedUpdatedAt: string): Promise<void> {
  const parsed = value === undefined ? undefined : webResearchSettingsSchema.parse(value);
  await mutateAsAuthor(bookId, expectedUpdatedAt, {
    title: parsed?.enabled ? "Ricerca web attivata o aggiornata" : "Ricerca web disattivata",
    reason: parsed?.enabled ? "L'autore ha consentito all'AI di cercare informazioni sul web per questo libro." : "Nessuna ricerca web partirà per questo libro.",
    nextStep: "Vale dalle prossime chiamate AI.",
  }, book => { if (parsed) book.webResearch = parsed; else delete book.webResearch; });
}

export async function clearResearchLog(bookId: string, expectedUpdatedAt: string): Promise<void> {
  await mutateAsAuthor(bookId, expectedUpdatedAt, {
    title: "Registro delle ricerche svuotato", reason: "Le ricerche precedenti non saranno riusate dalla cache.",
    nextStep: "Le prossime ricerche ripartono da zero.",
  }, book => { delete book.webResearchLog; });
}

/** Manual test from the settings panel: one query, audited and budget-checked like
 * the autopilot's, then stored in the log. It does not write the canon. */
export async function testWebResearch(bookId: string, query: string, controller: AbortController): Promise<ResearchEntry> {
  const book = await getBook(bookId);
  if (!book) throw new Error("Libro non trovato.");
  if (!book.webResearch?.enabled) throw new Error("Attiva prima la ricerca web per questo libro.");
  if (book.aiBudget?.enabled && book.status === "running")
    throw new Error("Con un budget AI attivo metti in pausa l'autopilot prima di provare la ricerca.");
  const clean = query.normalize("NFC").replace(/\s+/g, " ").trim();
  if (clean.length < 3 || clean.length > 200) throw new Error("Scrivi una query fra 3 e 200 caratteri.");
  const settings = await loadSettings();
  const guard: WriterGuard = { assertActive: async () => { if (controller.signal.aborted) throw new DOMException("Interrotto.", "AbortError"); }, failure: () => undefined };
  const [entry] = await runResearchQueries({ book, settings, runId: crypto.randomUUID(), guard, signal: controller.signal,
    phase: book.phase, taskTitle: "Prova della ricerca", reason: "Prova manuale dell'autore", queries: [clean], live: false });
  if (!entry) throw new Error("Nessun risultato.");
  await persistResearchLog(bookId, [entry]);
  return entry;
}
