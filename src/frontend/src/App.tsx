import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, BrainCircuit, CheckCircle2, Database,
  FileText, ListChecks, MessageSquareText, Moon, Pause, Play, Plus,
  Settings2, StopCircle, Sun, LayoutDashboard, Users, Download, Upload, ShieldCheck, FileArchive, Wallet, Library,
} from "lucide-react";
import { LibraryPage } from "./components/LibraryPage";
import { readLastBookId, rememberLastBookId } from "./application/last-book";
import { Button } from "./components/ui/button";
import { SaveBar } from "./components/settings/SaveBar";
import { EndpointCard } from "./components/settings/EndpointCard";
import { ModelRouterTable } from "./components/settings/ModelRouterTable";
import { BookOverrideTable } from "./components/settings/BookOverrideTable";
import { usePwaInstall } from "./application/pwa";
import { AutopilotRunner } from "./application/autopilot";
import { recordAuthorIntervention } from "./application/author-intervention";
import { AiTaskWorkspace } from "./components/AiTaskWorkspace";
import { AutopilotFocusPanel } from "./components/AutopilotFocusPanel";
import { AuthorInterventionPanel, interventionScopeBlocker, type InterventionSubmitMode } from "./components/AuthorInterventionPanel";
import { NewBookPanel, type NewBookDraft } from "./components/NewBookPanel";
import { clearAiTraces, currentLiveAi, subscribeLiveAi, type LiveAiTrace } from "./infrastructure/ai-observability";
import { confirmEditorialScene } from "./application/editorial-review";
import { DEFAULT_SETTINGS, newBook, type Activity, type AppSettings, type AuthorInterventionScope, type BookProject, type EndpointProfile, type Scene, type TaskKind, type TaskReasoning } from "./domain/types";
import { recommendedReasoningPreset } from "./domain/reasoning-presets";
import { fetchLmStudioReasoningCatalog } from "./infrastructure/lmstudio-models";
import { bookProgress, describeNextAutopilotStep } from "./domain/autopilot-step";
import { decryptLocal, encryptLocal } from "./infrastructure/crypto";
import { endpointAuthMode, fetchModels, normalizeEndpoint } from "./infrastructure/ai";
import { getBook, listActivities, listBooks, loadSettings, recoverInterruptedRuns, saveBook, saveSettings } from "./infrastructure/db";
import { createBackup, downloadBackup, importBackup, readBackup, type BackupMode } from "./infrastructure/backup";
import { exportDocx, exportEpub, exportPdf } from "./infrastructure/export-book";
import { GitHubSyncPanel } from "./components/GitHubSyncPanel";
import { ConflictReviewPanel } from "./components/ConflictReviewPanel";
import { SyncStatusSummary } from "./components/SyncStatusSummary";
import { AiUsagePanel } from "./components/AiUsagePanel";
import { AiBudgetPanel } from "./components/AiBudgetPanel";
import { CostGlance } from "./components/CostGlance";
import { ModelCapabilitiesPanel } from "./components/ModelCapabilitiesPanel";
import { VoiceReaderPanel } from "./components/VoiceReaderPanel";
import { SemanticSearchPanel } from "./components/SemanticSearchPanel";
import { EditorialBoardPanel } from "./components/EditorialBoardPanel";
import { drainGitHubOutbox } from "./application/auto-sync";
import { updateBookEditorialConcurrency, updateBookEditorialMode, updateBookModelRoute, updateBookTaskReasoning } from "./application/book-settings";
import { isCurrentModelInventoryRequest } from "./application/model-inventory";
import { EndpointSettingsSaveCoordinator, StaleEndpointSettingsSave } from "./application/endpoint-settings-save";
import packageInfo from "../package.json";
import { useWakeLock } from "./application/use-wake-lock";

type Page = "library" | "dashboard" | "activities" | "costs" | "reader" | "atlas" | "settings" | "export" | "bookSettings";
const navigation: Array<{ id: Page; label: string; icon: typeof BookOpen }> = [
  { id: "library", label: "Libreria", icon: Library },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "activities", label: "Attività", icon: ListChecks },
  { id: "costs", label: "Costi", icon: Wallet },
  { id: "reader", label: "Libro", icon: BookOpen },
  { id: "atlas", label: "Memoria", icon: Database },
  { id: "settings", label: "Impostazioni", icon: Settings2 },
  { id: "export", label: "Archivio", icon: FileArchive },
];
const LABELS: Record<TaskKind, string> = {
  brainstorm: "Brainstorming", validate: "Validazione", audience: "Audience (5 profili)",
  adversarial: "Adversarial review", outline: "Piano capitoli", prose: "Scrittura",
  continuity: "Review continuità", consolidate: "Consolidamento", summarize: "Riassunti", revision: "Revisioni", merge: "Fusione di scene",
  chapterAudit: "Specialisti capitolo", chapterReaders: "Cinque lettori", chapterJudge: "Direttore editoriale", chapterRepair: "Remediation mirata",
};
const statusText: Record<BookProject["status"], string> = {
  idle: "Da avviare", running: "In esecuzione", paused: "In pausa",
  error: "Errore: intervento richiesto", completed: "Libro completato",
};
const phaseText: Record<BookProject["phase"], string> = {
  brainstorm: "Brainstorming", validate: "Validazione", audience: "Audience review",
  adversarial: "Adversarial review", outline: "Outline", prose: "Scrittura scena",
  review: "Review scena", consolidate: "Consolidamento canon", chapterReview: "Redazione indipendente del capitolo", revision: "Revisione autore", completed: "Completato",
};
const sceneStatusText: Record<Scene["status"], string> = {
  planned: "pianificata", draft: "bozza", canon: "canonica",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="panel min-w-0 p-4 sm:p-5">
    <h2 className="text-lg font-semibold">{title}</h2>
    {description && <p className="muted mt-1 text-sm">{description}</p>}
    <div className="mt-4">{children}</div>
  </section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block text-sm font-semibold">{label}</span>{children}</label>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted rounded-lg border border-dashed border-slate-400 p-5 text-sm dark:border-slate-600">{children}</p>;
}

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [books, setBooks] = useState<BookProject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [liveAi,setLiveAi]=useState<LiveAiTrace|null>(()=>currentLiveAi());
  useEffect(()=>subscribeLiveAi(()=>setLiveAi(currentLiveAi())),[]);
  // The inventory fetch may finish between user events and React's batched render.
  // Keep the last synchronous update available to async completion checks.
  const [settings, renderSettings] = useState<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  const settingsRef = useRef(settings);
  function setSettings(update: React.SetStateAction<AppSettings>): void {
    const next = typeof update === "function" ? update(settingsRef.current) : update;
    settingsRef.current = next;
    renderSettings(next);
  }
  const [savedJson, setSavedJson] = useState("");
  const [savedAt, setSavedAt] = useState<string>();
  const [keyDrafts, renderKeyDrafts] = useState<Record<string, string>>({});
  const keyDraftsRef = useRef(keyDrafts);
  function setKeyDrafts(update: React.SetStateAction<Record<string, string>>): void {
    const next = typeof update === "function" ? update(keyDraftsRef.current) : update;
    keyDraftsRef.current = next;
    renderKeyDrafts(next);
  }
  /** Settings just read from or written to IndexedDB: they become the saved baseline. */
  function adoptSaved(next: AppSettings): void {
    setSettings(next);
    setSavedJson(JSON.stringify(next));
  }
  const settingsDirty = savedJson !== "" && (JSON.stringify(settings) !== savedJson ||
    Object.values(keyDrafts).some(value => value !== ""));
  useEffect(() => {
    if (!settingsDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [settingsDirty]);
  const latestModelInventoryRequest = useRef<Record<string, number>>({});
  const endpointSettingsSave = useRef(new EndpointSettingsSaveCoordinator()).current;
  const [intervention, setIntervention] = useState("");
  const [interventionScope, setInterventionScope] = useState<AuthorInterventionScope>("next_step");
  const [interventionBusy, setInterventionBusy] = useState(false);
  const interventionRef = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");
  // On a rejected edit IndexedDB may still have the same revision as React.
  // Force only the affected uncontrolled model input to remount and display
  // the actually persisted value, never a draft that was refused by the lock.
  const [bookModelResets, setBookModelResets] = useState<Partial<Record<TaskKind, number>>>({});
  const [ready, setReady] = useState(false);
  const [backupMode, setBackupMode] = useState<BackupMode>("content");
  const [backupPassword, setBackupPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const runner = useRef(new AutopilotRunner()).current;
  // Only the tab that started the runner can pause it: track its book here.
  const [runnerBookId, setRunnerBookId] = useState<string | null>(null);
  const [stopAfterRequested, setStopAfterRequested] = useState(false);
  const runPromise = useRef<Promise<void> | null>(null);
  // "+ Nuovo libro" is an explicit choice: periodic refreshes must not undo it.
  const creatingNewBook = useRef(false);

  const refresh = useCallback(async () => {
    const all = await listBooks();
    setBooks(all);
    setSelectedId(prev => {
      if (prev && all.some(book => book.id === prev)) return prev;
      if (!prev && creatingNewBook.current) return "";
      const last = readLastBookId();
      return all.find(book => book.id === last)?.id ?? all[0]?.id ?? "";
    });
  }, []);
  useEffect(() => { rememberLastBookId(selectedId); }, [selectedId]);
  useEffect(() => {
    void (async () => {
      try {
        await recoverInterruptedRuns();
        await refresh();
        adoptSaved(await loadSettings());
        setReady(true);
      } catch { setNotice("Impossibile aprire IndexedDB: verifica la modalità privacy del browser."); }
    })();
  }, [refresh]);
  useEffect(() => {
    // The scene-merge workspace can commit an Activity without changing the
    // book revision. Re-read the ledger when returning to the Dashboard, not
    // only when books/selectedId change, or the budget shows stale zero spend.
    // Ignore responses from older selections or page transitions.
    let current = true;
    if (selectedId) void listActivities(selectedId)
      .then(rows => { if (current) setActivities(rows); })
      .catch(() => { if (current) setActivities([]); });
    else setActivities([]);
    return () => { current = false; };
  }, [selectedId, books, page]);
  useEffect(() => {
    // Recover the durable outbox on reload, network recovery and while the tab stays open.
    // Never claim that scheduled browser work runs when the page is closed.
    const tick = () => { void drainGitHubOutbox().then(refresh).catch(() => undefined); };
    void tick();
    const timer = window.setInterval(tick, 15_000);
    window.addEventListener("online", tick);
    const onVisibility = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);
  useEffect(() => {
    const dark = settings.theme === "dark" ||
      settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  }, [settings.theme]);

  const current = useMemo(() => books.find(x => x.id === selectedId), [books, selectedId]);
  const lastOpenedId = readLastBookId();
  const runningActivity = current?.status === "running" ? activities.find(x => x.status === "running") : undefined;
  const runningHere = !!current && runnerBookId === current.id;
  useWakeLock(runningHere && current?.status === "running");
  const pwa = usePwaInstall();
  const nextStep = useMemo(() => current ? describeNextAutopilotStep(current) : undefined, [current]);
  const progressInfo = useMemo(() => current ? bookProgress(current) : undefined, [current]);
  const pendingFused = current?.editorialReviewSceneIds?.length ?? 0;
  const modelWarning = useMemo(() => {
    const route = settings.defaultRoute;
    const endpoint = settings.endpoints.find(e => e.id === route.endpointId);
    if (!endpoint) return "Nessun endpoint AI predefinito: configuralo nelle Impostazioni prima di avviare.";
    if (!route.modelId.trim()) return "Nessun modello predefinito: scegline uno nelle Impostazioni prima di avviare.";
    try {
      if (endpointAuthMode(endpoint.authMode, endpoint.baseUrl) === "api_key" && !endpoint.secret)
        return "L'endpoint predefinito non ha una API key salvata: inseriscila nelle Impostazioni.";
    } catch { return "L'endpoint predefinito non è valido: correggilo nelle Impostazioni."; }
    return undefined;
  }, [settings]);
  useEffect(() => {
    // A scope that became unavailable (e.g. book completed) switches to a usable one.
    if (!current || !interventionScopeBlocker(current, interventionScope)) return;
    const usable = (["next_step", "from_now", "rewrite"] as const).find(scope => !interventionScopeBlocker(current, scope));
    if (usable) setInterventionScope(usable);
  }, [current, interventionScope]);

  async function createProject(draft: NewBookDraft): Promise<boolean> {
    const book = newBook(draft.brief, draft.title, draft.writingStyle, draft.audience, draft.options);
    try { await saveBook(book); }
    catch { setNotice("Impossibile salvare il libro in IndexedDB."); return false; }
    creatingNewBook.current = false;
    await refresh(); setSelectedId(book.id);
    setNotice("Libro creato in IndexedDB. Configura un modello e avvia l'autopilot.");
    return true;
  }
  function startRunner(bookId: string) {
    if (runner.running) {
      setNotice(runnerBookId && runnerBookId !== bookId
        ? "L'autopilot sta già lavorando su un altro libro: mettilo in pausa prima di avviarne un altro."
        : "L'autopilot è già in esecuzione.");
      return;
    }
    setRunnerBookId(bookId);
    setStopAfterRequested(false);
    const promise: Promise<void> = runner.run(bookId, async () => { await refresh(); void drainGitHubOutbox(); })
      .catch(e => setNotice(e instanceof Error ? e.message : "Errore di esecuzione."))
      .finally(async () => {
        const gracefulStop = runner.stopAfterCurrentRequested;
        setRunnerBookId(null);
        setStopAfterRequested(false);
        if (runPromise.current === promise) runPromise.current = null;
        if (gracefulStop && (await getBook(bookId).catch(() => undefined))?.status === "paused")
          setNotice("Autopilot in pausa: il task in corso è stato completato e salvato. Puoi intervenire o riprendere.");
      });
    runPromise.current = promise;
  }
  function execute() {
    if (!current) return;
    setNotice("");
    startRunner(current.id);
  }
  function pause() { runner.stop(); setNotice("Pausa richiesta: arresto della chiamata in corso e salvataggio del checkpoint."); }
  function stopAfterCurrentTask() {
    runner.stopAfterCurrent();
    setStopAfterRequested(true);
    setNotice("L'autopilot si fermerà appena il task in corso sarà completato e salvato.");
  }
  function openIntervention() {
    setPage("dashboard");
    window.setTimeout(() => {
      interventionRef.current?.scrollIntoView({ block: "center" });
      interventionRef.current?.focus();
    }, 50);
  }
  function prepareActivityRevision(item:Activity) {
    const rewrite = current && !interventionScopeBlocker(current, "rewrite");
    setIntervention(rewrite
      ? `Rivedi quanto prodotto nel task "${item.title}" (fase ${item.phase}): `
      : `A proposito del task "${item.title}" (fase ${item.phase}): `);
    setInterventionScope(rewrite ? "rewrite" : "next_step");
    openIntervention();
    if(current?.status==="running")setNotice("Intervento preparato: completa il testo, poi usa «Interrompi e registra intervento».");
    else setNotice("Intervento preparato: completa il testo e scegli come applicarlo. Non ripristina automaticamente un checkpoint storico.");
  }
  async function submitIntervention(mode: InterventionSubmitMode) {
    if (!current || interventionBusy) return;
    // Capture the revision displayed to the author, not one reloaded after the
    // click: a stale tab must see the conflict and keep its draft.
    const { id, updatedAt } = current;
    const instruction = intervention;
    const scope = interventionScope;
    setInterventionBusy(true);
    try {
      let expected = updatedAt;
      let activityId: string | undefined;
      let stepLabel: string | undefined;
      if (mode === "interrupt_and_record") {
        if (runnerBookId !== id) throw new Error("L'autopilot non è in esecuzione in questa scheda.");
        activityId = runningActivity?.id;
        stepLabel = nextStep?.headline;
        runner.stop();
        await runPromise.current;
        // Our own runner just committed the cancelled task and paused the book.
        const latest = await getBook(id);
        if (!latest) throw new Error("Libro non trovato.");
        expected = latest.updatedAt;
      }
      const result = await recordAuthorIntervention(id, { instruction, scope, activityId, stepLabel }, expected);
      setIntervention("");
      await refresh();
      const message = result.effect === "note" ? "Intervento registrato: verrà usato dal prossimo task di scrittura."
        : result.effect === "constraint" ? "Intervento registrato come vincolo permanente."
        : result.effect === "replan" ? "Intervento registrato: alla ripresa verrà rifatto il piano dei capitoli."
        : "Intervento registrato: alla ripresa l'autopilot analizzerà l'impatto e riscriverà le scene coinvolte.";
      if (mode === "record_and_continue") {
        setNotice(message + " Autopilot ripartito.");
        startRunner(id);
      } else setNotice(message + (mode === "interrupt_and_record"
        ? " Il task interrotto sarà ripetuto alla ripresa."
        : current.status === "idle" && result.effect !== "revision"
          ? " Premi Autopilot per iniziare." : " Premi Riprendi per continuare."));
    } catch (e) {
      await refresh(); // Present the current state; the draft stays for a deliberate retry.
      setNotice(e instanceof Error ? e.message : "Intervento non registrato.");
    } finally { setInterventionBusy(false); }
  }
  async function approveEditorialScene(sceneId: string) {
    if (!current) return;
    if (!window.confirm(
      "Hai riletto la scena fusa e verificato indizi, segreti, continuità e stile? " +
      "Confermando diventerà canonica nel browser, ma NON sarà pubblicata automaticamente su GitHub.",
    )) return;
    try {
      await confirmEditorialScene(current.id, sceneId, current.updatedAt);
      await refresh();
      setNotice("Scena canonizzata dopo conferma dell'autore. Verifica la continuità prima del push manuale.");
    } catch (error) {
      // An editor in another tab may have advanced the canon. Discard our
      // stale render so the author must inspect the current scene again.
      await refresh();
      setNotice(error instanceof Error ? error.message : "Conferma scena non riuscita.");
    }
  }

  async function persistSettings(next: AppSettings) {
    await saveSettings(next); adoptSaved(next); setNotice("Impostazioni salvate in IndexedDB.");
  }
  async function toggleTheme() {
    const theme: AppSettings["theme"] = settingsRef.current.theme === "dark" ? "light" : "dark";
    setSettings(old => ({ ...old, theme }));
    // Persist only the theme: unsaved endpoint edits stay drafts until «Salva impostazioni».
    try {
      await saveSettings({ ...await loadSettings(), theme });
      setSavedJson(old => old ? JSON.stringify({ ...(JSON.parse(old) as AppSettings), theme }) : old);
    }
    catch { setNotice("Impossibile salvare il tema nel browser."); }
  }
  function updateEndpoint(id: string, update: Partial<EndpointProfile>) {
    setSettings(old => ({ ...old, endpoints: old.endpoints.map(e => e.id === id ? { ...e, ...update } : e) }));
    // Without authentication there is no key to keep: drop any typed draft.
    if (update.authMode === "none") setKeyDrafts(old => { const next = { ...old }; delete next[id]; return next; });
  }
  async function discardSettingsChanges() {
    try {
      adoptSaved(await loadSettings());
      setKeyDrafts({});
      setNotice("Modifiche annullate: ripristinate le impostazioni salvate.");
    } catch { setNotice("Impossibile rileggere le impostazioni salvate."); }
  }
  async function saveEndpointSettings() {
    // Capture the actual inputs at the click, not a possibly stale render.
    const snapshot = { settings: settingsRef.current, keyDrafts: keyDraftsRef.current };
    try {
      await endpointSettingsSave.save(snapshot,
        () => ({ settings: settingsRef.current, keyDrafts: keyDraftsRef.current }),
        encryptLocal, saveSettings, next => {
          adoptSaved(next);
          setKeyDrafts({});
          setSavedAt(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
          setNotice("Impostazioni salvate in IndexedDB.");
        });
    } catch (e) {
      if (e instanceof StaleEndpointSettingsSave && e.superseded) return;
      setNotice(e instanceof Error ? e.message : "Impossibile salvare la configurazione.");
    }
  }
  async function discoverModels(endpointId: string) {
    const endpoint = settingsRef.current.endpoints.find(e => e.id === endpointId);
    if (!endpoint) { setNotice("Endpoint non più presente: nessun catalogo applicato."); return; }
    const startingDraft = keyDraftsRef.current[endpointId] ?? "";
    const attempt = (latestModelInventoryRequest.current[endpointId] ?? 0) + 1;
    latestModelInventoryRequest.current[endpointId] = attempt;
    setNotice("Ricerca catalogo modelli in corso…");
    const newest = () => latestModelInventoryRequest.current[endpointId] === attempt;
    const current = () => isCurrentModelInventoryRequest(
      endpoint, settingsRef.current, startingDraft,
      keyDraftsRef.current[endpointId] ?? "", attempt,
      latestModelInventoryRequest.current[endpointId],
    );
    const discardStale = () => {
      if (!newest()) return; // A newer explicit lookup owns the outcome.
      setNotice("Catalogo ignorato: endpoint, chiave o modelli modificati durante la ricerca. Premi di nuovo Leggi /models.");
    };
    try {
      const authMode = endpointAuthMode(endpoint.authMode, endpoint.baseUrl);
      const secret = authMode === "none" ? null :
        startingDraft || (endpoint.secret ? await decryptLocal(endpoint.secret) : "");
      if (!current()) { discardStale(); return; }
      if (authMode === "api_key" && !secret) throw new Error("Inserisci prima la chiave API.");
      const models = await fetchModels(endpoint.baseUrl, secret);
      if (!current()) { discardStale(); return; }
      // Optional, loopback-only: which thinking levels each LM Studio model declares.
      const reasoning = authMode === "none" ? await fetchLmStudioReasoningCatalog(endpoint.baseUrl) : undefined;
      if (!current()) { discardStale(); return; }
      // Synchronous ref-based commit: there is no async gap after the guard
      // and no side effect inside a React state updater.
      const latest = settingsRef.current;
      setSettings({ ...latest, endpoints: latest.endpoints.map(profile =>
        profile === endpoint ? { ...profile, models,
          ...(reasoning ? { modelReasoning: reasoning } : {}) } : profile) });
      setNotice(`Trovati ${models.length} modelli${reasoning ? " e i livelli di thinking che dichiarano" : ""}. Premi Salva impostazioni per conservarli.`);
    } catch (error) {
      if (!newest()) return;
      if (!current()) { discardStale(); return; }
      setNotice(error instanceof Error ? error.message :
        "Elenco modelli non disponibile: inserisci manualmente il nome.");
    }
  }
  async function updateBookRoute(task: TaskKind, endpointId: string, modelId: string) {
    if (!current) return;
    // The UI may hold an older snapshot than IndexedDB after another tab
    // saved or an AI checkpoint advanced. Never overwrite the whole book.
    const { id, updatedAt } = current;
    try {
      await updateBookModelRoute(id, updatedAt, task, endpointId, modelId);
      await refresh();
      setNotice("Modello per il libro aggiornato in sicurezza.");
    } catch (error) {
      await refresh(); // A stale route should show the newest saved value.
      // A lock failure can leave updatedAt unchanged: refresh alone does not
      // reset an uncontrolled input's visible, rejected edit.
      setBookModelResets(old => ({ ...old, [task]: (old[task] ?? 0) + 1 }));
      setNotice(error instanceof Error ? error.message : "Modello del libro non aggiornato.");
    }
  }


  function applyRecommendedThinking() {
    const result = recommendedReasoningPreset(settingsRef.current);
    setSettings(s => ({ ...s, taskReasoningEfforts: result.efforts }));
    setNotice(result.applied === 0 && result.withoutReasoning === 0
      ? "Nessun livello applicato: leggi prima i modelli con «Leggi /models» (solo LM Studio dichiara i livelli di thinking)."
      : `Thinking consigliato applicato a ${result.applied} attività` +
        (result.withoutReasoning ? `; ${result.withoutReasoning} usano modelli senza thinking` : "") +
        (result.unverified ? `; ${result.unverified} lasciate invariate (modello non verificato)` : "") +
        ". Premi Salva impostazioni per conservarlo.");
  }

  async function updateBookReasoning(kind:TaskKind,value:TaskReasoning|undefined){
    if(!current)return;
    const {id,updatedAt}=current;
    try{
      await updateBookTaskReasoning(id,updatedAt,kind,value);
      await refresh();
      setNotice("Reasoning del task aggiornato per questo libro.");
    }catch(error){
      await refresh();
      setNotice(error instanceof Error?error.message:"Reasoning del task non salvato.");
    }
  }

  async function updateBookEditorial(mode: "full" | "light") {
    if (!current) return;
    const { id, updatedAt } = current;
    try {
      await updateBookEditorialMode(id, updatedAt, mode);
      await refresh();
      setNotice(mode === "light"
        ? "Redazione leggera attiva: i NUOVI cicli usano 5 revisori (6 con fonti storiche) e il direttore. I capitoli congelati così sono marcati."
        : "Redazione completa ripristinata: i NUOVI cicli usano 12 revisori.");
    } catch (error) {
      await refresh();
      setNotice(error instanceof Error ? error.message : "Modalità di redazione non salvata.");
    }
  }

  async function updateBookConcurrency(value: number) {
    if (!current) return;
    const { id, updatedAt } = current;
    try {
      await updateBookEditorialConcurrency(id, updatedAt, value);
      await refresh();
      setNotice(value > 1
        ? `Revisori in parallelo: fino a ${value} richieste insieme nei NUOVI passi di revisione. Ogni revisore non ricorda più le proprie note dei segmenti precedenti.`
        : "Revisori in sequenza (predefinito).");
    } catch (error) {
      await refresh();
      setNotice(error instanceof Error ? error.message : "Parallelismo non salvato.");
    }
  }

  async function makeBackup() {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const cleartext = backupMode === "full" && !backupPassword;
      if (cleartext && !window.confirm("ATTENZIONE: senza password lo ZIP conterrà API key in chiaro. Chiunque ottenga il file potrà usarle e generare costi. Procedere?")) return;
      if (backupPassword && backupPassword.length < 12) throw new Error("Usa una password ZIP di almeno 12 caratteri.");
      const blob = await createBackup(backupMode, backupPassword || undefined, cleartext);
      downloadBackup(blob, backupMode);
      setBackupPassword("");
      setNotice("Backup ZIP generato. Conservalo in un luogo sicuro; verifica periodicamente il ripristino.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Esportazione non riuscita.");
    } finally { setBusy(false); }
  }
  async function restoreBackup() {
    if (!importFile || busy) return;
    if (books.some(book => book.status === "running"))
      { setNotice("Metti prima in pausa l'autopilot."); return; }
    setBusy(true); setNotice("");
    try {
      const restored = await readBackup(importFile, restorePassword || undefined);
      const wantsSettings = restored.kind === "full" &&
        window.confirm("Il backup contiene le configurazioni, comprese le API key. Vuoi sostituire le impostazioni di questo browser? I libri vengono comunque aggiunti come copie.");
      if (!window.confirm("Importare " + restored.books.length + " libri come copie senza cancellare quelli esistenti?")) return;
      const count = await importBackup(restored, wantsSettings);
      if (wantsSettings) adoptSaved(await loadSettings());
      await refresh();
      setImportFile(null); setRestorePassword("");
      setNotice(count + " libri importati come copie. I dati preesistenti non sono stati sovrascritti.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Importazione non riuscita.");
    } finally { setBusy(false); }
  }
  async function downloadBook(format: "epub" | "docx" | "pdf") {
    if (!current || busy) return;
    setBusy(true); setNotice("");
    try {
      switch (format) {
        case "epub": exportEpub(current); break;
        case "docx": await exportDocx(current); break;
        case "pdf": await exportPdf(current); break;
      }
      setNotice("Esportazione " + format.toUpperCase() + " completata.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Esportazione libro non riuscita.");
    } finally { setBusy(false); }
  }

  return <div className="site-nav">
    <aside className="sidebar">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold"><BookOpen className="text-emerald-500" /> BookWriter</h1>
      <p className="muted mb-7 text-xs">Autore autonomo e supervisionabile</p>
      <nav aria-label="Navigazione principale" className="space-y-1">
        {navigation.map(({ id, label, icon: Icon }) =>
          <button key={id} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm ${page === id ? "bg-emerald-600/20 text-emerald-500 font-semibold" : "hover:bg-slate-300/25 dark:hover:bg-slate-700/40"}`} onClick={() => setPage(id)}>
            <Icon size={19} /> {label}
          </button>)}
      </nav>
      <p className="muted mt-8 text-xs">v{packageInfo.version} · Local-first e GitHub sync opzionale</p>
    </aside>

    <nav className="mobile-tabs" aria-label="Navigazione mobile">
      {navigation.map(({id,label,icon:Icon}) => <button key={id} aria-label={label} aria-current={page===id ? "page" : undefined}
        className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-[10px] ${page===id ? "text-emerald-500 font-bold" : "muted"}`}
        onClick={() => setPage(id)}><Icon size={19}/><span className="block max-w-full truncate">{label}</span></button>)}
    </nav>

    <main className="min-w-0 px-3 pb-8 pt-3 sm:px-6 sm:pt-5">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{navigation.find(x => x.id === page)?.label ?? "Modelli e redazione"}</h1>
          <p className="muted text-sm">Progetto local-first · GitHub autosync opzionale <span className="sm:hidden">· v{packageInfo.version}</span></p>
        </div>
        <div className="flex items-center gap-2">
          {pwa.canInstall && <button className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-600/60 px-3 text-sm font-semibold text-emerald-500"
            onClick={() => void pwa.install()}><Download size={18}/> Installa app</button>}
          <button className="flex size-11 items-center justify-center rounded-lg border border-slate-400 disabled:opacity-50 dark:border-slate-700" aria-label="Cambia tema chiaro/scuro"
            disabled={!ready}
            onClick={() => void toggleTheme()}>
            {settings.theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      {!ready && <p role="status" className="muted mb-4">Caricamento archivio locale…</p>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{notice}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold" htmlFor="book-select">Libro attivo</label>
        <select id="book-select" className="field max-w-xs" value={selectedId} onChange={e => {
          creatingNewBook.current = e.target.value === "";
          if (e.target.value === "") setPage("dashboard"); // the new-book form lives there
          setSelectedId(e.target.value);
        }}>
          <option value="">{books.length ? "+ Nuovo libro" : "Nessun libro"}</option>
          {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        {current && <Button variant="outline" size="sm" onClick={() => setPage("bookSettings")}>
          <Settings2 size={15} /> Modelli e redazione</Button>}
      </div>

      {current && <div className="panel status-bar z-20 mb-4 flex flex-col gap-3 p-3 shadow-md sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{statusText[current.status]} · {phaseText[current.phase]}</p>
          <p className="muted truncate text-xs">{runningActivity ? `Ora: ${runningActivity.title}` : `Prossimo: ${nextStep?.headline ?? phaseText[current.phase]}`}</p>
          <p className="muted hidden text-xs sm:block">{!progressInfo?.scenes ? "Piano non ancora creato" :
            `${progressInfo.canonScenes}/${progressInfo.scenes} scene canoniche (${Math.round(progressInfo.canonScenes / progressInfo.scenes * 100)}%) · ${progressInfo.frozenChapters}/${progressInfo.chapters} capitoli congelati`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current.status === "running" ? runningHere ? <>
              <Button onClick={pause} variant="secondary"><Pause size={17} /> Pausa</Button>
              <Button variant="outline" disabled={stopAfterRequested} onClick={stopAfterCurrentTask}
                title="Lascia completare e salvare il task in corso, poi metti in pausa">
                <StopCircle size={17}/> {stopAfterRequested ? "Si ferma a fine task" : "Ferma a fine task"}</Button>
            </> : <span className="muted self-center text-xs">In esecuzione in un'altra scheda</span>
            : current.status !== "completed" || current.revision ? <Button disabled={pendingFused > 0} onClick={execute}><Play size={17} /> {current.status === "paused" || current.status === "error" ? "Riprendi" : "Autopilot"}</Button> : null}
          <Button variant="outline" onClick={openIntervention}><MessageSquareText size={17}/> Intervieni</Button>
          <Button variant="outline" className="hidden sm:inline-flex" onClick={() => setPage("activities")}><ListChecks size={17} /> Log</Button>
          {pendingFused > 0 && <Button variant="outline" onClick={() => setPage("reader")}>Rileggi scene ({pendingFused})</Button>}
        </div>
      </div>}

      {page === "library" && <LibraryPage books={books} selectedId={selectedId} lastOpenedId={lastOpenedId}
        onOpen={id => { creatingNewBook.current = false; setSelectedId(id); setPage("dashboard"); }}
        onOpenSettings={id => { creatingNewBook.current = false; setSelectedId(id); setPage("bookSettings"); }}
        onNew={() => { creatingNewBook.current = true; setSelectedId(""); setPage("dashboard"); }} />}

      {page === "bookSettings" && (current
        ? <BookOverrideTable book={current} settings={settings} labels={LABELS} resets={bookModelResets}
          onRoute={(kind, endpointId, modelId) => void updateBookRoute(kind, endpointId, modelId)}
          onReasoning={(kind, value) => void updateBookReasoning(kind, value)}
          onEditorialMode={mode => void updateBookEditorial(mode)}
          onConcurrency={value => void updateBookConcurrency(value)} />
        : <Empty>Scegli un libro dalla Libreria per configurarne modelli e redazione.</Empty>)}

      {page === "dashboard" && <div className="space-y-4">
        {ready && !current && <NewBookPanel onCreate={createProject}/>}
        {current && <div className="flex min-w-0 flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
            <div className="order-1 min-w-0 xl:order-none">
              <AutopilotFocusPanel book={current} activities={activities} live={liveAi}
                inspectionEnabled={settings.inspectAiRequests===true} runningHere={runningHere}
                modelWarning={modelWarning} onOpenReader={() => setPage("reader")} onOpenSettings={() => setPage("settings")}/>
            </div>
            <div className="order-4 min-w-0 xl:order-none">
              <AiTaskWorkspace bookId={current.id} activities={activities}
                live={liveAi} inspectionEnabled={settings.inspectAiRequests===true}
                onPrepareRevision={prepareActivityRevision} onOpenFull={()=>setPage("activities")} compact/>
            </div>
          </div>
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
            <div className="order-2 min-w-0 xl:order-none">
              <AuthorInterventionPanel book={current} draft={intervention} onDraftChange={setIntervention}
                scope={interventionScope} onScopeChange={setInterventionScope} runningHere={runningHere}
                busy={interventionBusy} onSubmit={mode => void submitIntervention(mode)} textareaRef={interventionRef}/>
            </div>
            <div className="order-3 min-w-0 xl:order-none">
              <CostGlance book={current} activities={activities} settings={settings} onOpen={() => setPage("costs")}/>
            </div>
          </div>
        </div>}
        {current && <details open={current.status!=="running"} className="min-w-0">
          <summary className="mb-3 cursor-pointer rounded-lg border border-slate-400/40 p-3 text-sm font-semibold">
            Brief, redazione, memoria e sincronizzazione
          </summary>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[1.65fr_1fr]">
        <div className="space-y-4">
          <Section title="Brief e visione del libro">
            {current.brief ? <p className="whitespace-pre-wrap text-sm leading-7">{current.brief}</p>
              : <p className="muted text-sm">Nessuna descrizione: l'autopilot sviluppa il libro a partire dal titolo.</p>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><p className="muted text-xs">Stile</p><p className="text-sm">{current.writingStyle}</p></div>
              <div><p className="muted text-xs">Audience</p><p className="text-sm">{current.audience}</p></div>
            </div>
            {current.startMode === "synopsis" && (current.authorChapterSynopses?.length ?? 0) > 0 &&
              <details className="mt-4 rounded-lg border border-slate-400/40 p-3">
                <summary className="cursor-pointer text-sm font-semibold">Sinossi vincolante dell'autore ({current.authorChapterSynopses!.length} capitoli)</summary>
                <ol className="mt-2 list-decimal space-y-2 pl-6 text-sm">
                  {current.authorChapterSynopses!.map((chapter, index) => <li key={index} className="whitespace-pre-wrap break-words">
                    {chapter.title && <b>{chapter.title}: </b>}{chapter.synopsis}</li>)}
                </ol>
              </details>}
          </Section>
          {current.ideas && <Section title="Idee long / mid / short term"><div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{current.ideas}</div></Section>}
        </div>
        <div className="space-y-4">
          <EditorialBoardPanel book={current} onRefresh={refresh}/>
          <Section title="Memoria narrativa" description="Dettagli completi nella pagina Memoria.">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["Capitoli", current.chapters.length],
                ["Scene canoniche", progressInfo?.canonScenes ?? 0],
                ["Personaggi", Object.keys(current.memory.characters).length],
                ["Luoghi", Object.keys(current.memory.locations).length],
                ["Fazioni", Object.keys(current.memory.factions).length],
                ["Oggetti", Object.keys(current.memory.items).length],
                ["Segreti", Object.keys(current.memory.secrets).length],
                ["Eventi timeline", current.memory.timeline.length],
              ].map(([label,value]) => <div key={String(label)} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
                <div className="muted text-xs">{label}</div><div className="text-xl font-bold">{value}</div>
              </div>)}
            </div>
          </Section>
          <Section title="Sincronizzazione e checkpoint">
            <SyncStatusSummary book={current} openArchive={() => setPage("export")}/>
          </Section>
        </div>
        </div>
        </details>}
      </div>}

      {page === "activities" && (current ?
        <AiTaskWorkspace book={current} bookId={current.id} activities={activities} live={liveAi}
          inspectionEnabled={settings.inspectAiRequests===true}
          onPrepareRevision={prepareActivityRevision}
          onForkCreated={async(forkBookId)=>{
            await refresh();
            setSelectedId(forkBookId);
            setNotice("Fork locale separato creato dallo ZIP verificato: selezionato il nuovo libro in pausa. L'originale è invariato; controlla capitoli, freeze, dipendenze e modelli prima di riprendere.");
          }}/>
        : <Section title="Registro delle attività"><Empty>Seleziona un libro per ispezionare le attività.</Empty></Section>)}

      {page === "costs" && (current ?
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start">
          <AiBudgetPanel key={current.id} book={current} settings={settings}
            activities={activities} onRefresh={refresh}/>
          <AiUsagePanel activities={activities} endpoints={settings.endpoints}/>
        </div>
        : <Section title="Costi AI"><Empty>Seleziona un libro per vedere consumi e budget.</Empty></Section>)}

      {page === "reader" && <div className="space-y-4">
        {current && <>
          <VoiceReaderPanel book={current} settings={settings} />
          <SemanticSearchPanel book={current} settings={settings} />
        </>}
        <Section title="Il libro" description="Le scene canoniche sono il testo approvato; bozze e scene pianificate sono ancora in lavorazione. Esporta EPUB, DOCX e PDF dall'Archivio.">
        {!current?.chapters.length ? <Empty>Non c'è ancora un piano capitoli. Avvia l'autopilot.</Empty>
          : current.chapters.map(ch => <article key={ch.id} className="mb-8">
            <h3 className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-slate-300 pb-2 text-xl font-bold dark:border-slate-700">
              <span>Capitolo {ch.number} — {ch.title}</span>
              {ch.frozenAt && <span className="rounded-full border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">congelato</span>}
            </h3>
            <p className="muted mb-4 text-sm">{ch.purpose}</p>
            {ch.scenes.map(s => <section key={s.id} id={`book-scene-${s.id}`} className="mb-6 scroll-mt-24">
              <h4 className="mb-2 font-semibold">{s.number}. {s.title} <span className="muted text-xs">({sceneStatusText[s.status]})</span></h4>
              {s.text ? <p className="whitespace-pre-wrap break-words text-[1rem] leading-8">{s.text}</p>
                : <p className="muted text-sm">Scena non ancora scritta. Obiettivo: {s.objective}</p>}
              {current.editorialReviewSceneIds?.includes(s.id) && <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 p-3">
                <p className="text-sm">Questa scena fusa richiede la tua rilettura e conferma prima di riprendere l'autopilot.</p>
                <Button variant="outline" disabled={busy || current.status === "running"}
                  onClick={() => void approveEditorialScene(s.id)}>
                  <CheckCircle2 size={16}/> Conferma scena come canonica
                </Button>
              </div>}
            </section>)}
          </article>)}
        </Section>
      </div>}

      {page === "atlas" && <div className="grid gap-4 lg:grid-cols-2">
        {(["characters", "locations", "factions", "items", "secrets"] as const).map(kind => <Section key={kind} title={{characters:"Personaggi",locations:"Luoghi",factions:"Fazioni",items:"Oggetti",secrets:"Segreti (solo autore)"}[kind]}>
          {Object.entries(current?.memory[kind] ?? {}).length
            ? Object.entries(current?.memory[kind] ?? {}).map(([key,value]) => <div key={key} className="mb-3"><b>{key}</b><p className="muted whitespace-pre-wrap text-sm">{value}</p></div>)
            : <Empty>Nessuna informazione consolidata.</Empty>}
        </Section>)}
        <Section title="Timeline">
          {current?.memory.timeline.length ? current.memory.timeline.map((x,i) => <p className="mb-2 text-sm" key={i}>• {x}</p>) : <Empty>Ancora nessun evento.</Empty>}
        </Section>
        <Section title="Stato corrente"><p className="whitespace-pre-wrap text-sm">{current?.memory.currentState || "Non ancora disponibile."}</p></Section>
      </div>}

      {page === "export" && <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <GitHubSyncPanel book={current} settings={settings} onRefresh={refresh}
            onSaveSettings={persistSettings} onSelectBook={setSelectedId}/>
        </div>
        <div className="lg:col-span-2">
          <ConflictReviewPanel book={current} settings={settings} hasGitHubToken={!!settings.githubToken}
            onRefresh={refresh} onSelectBook={setSelectedId}/>
        </div>
        <Section title="Backup ZIP" description="Copia portabile di tutti i libri presenti su questo browser, con log, riassunti e checkpoint.">
          <div className="space-y-4">
            <Field label="Tipo di backup"><select className="field" value={backupMode} onChange={e => setBackupMode(e.target.value as BackupMode)}>
              <option value="content">Solo libri e attività (senza credenziali)</option>
              <option value="full">Completo: libri, modelli, endpoint e API key</option>
            </select></Field>
            {backupMode === "full" && <>
              <Field label="Password per cifrare i dati nello ZIP (raccomandata)">
                <input type="password" autoComplete="new-password" className="field" value={backupPassword} onChange={e => setBackupPassword(e.target.value)} placeholder="Almeno 12 caratteri" />
              </Field>
              <p className="muted flex items-start gap-2 text-sm"><ShieldCheck size={17} className="shrink-0" />
                Il file ZIP con password include un payload cifrato AES-GCM. Non è il formato di password ZIP tradizionale: l'importazione si effettua da BookWriter.</p>
              {!backupPassword && <p className="text-sm text-amber-600 dark:text-amber-300">Senza password le credenziali verranno esportate in chiaro: sarà richiesta una conferma aggiuntiva.</p>}
            </>}
            <Button disabled={busy} onClick={() => void makeBackup()}><Download size={17}/> Scarica backup ZIP</Button>
          </div>
        </Section>
        <Section title="Ripristina backup ZIP" description="I libri importati sono creati come nuove copie: il contenuto locale esistente resta intatto.">
          <div className="space-y-4">
            <Field label="Archivio BookWriter (.zip)">
              <input className="field" type="file" accept=".zip,application/zip" onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Field label="Password del backup (se cifrato)">
              <input className="field" type="password" autoComplete="off" value={restorePassword} onChange={e => setRestorePassword(e.target.value)} placeholder="Lascia vuoto se non richiesta"/>
            </Field>
            <p className="muted text-xs">Verranno verificati formato, dimensioni e struttura. Il recupero di chiavi API richiede una conferma distinta.</p>
            <Button disabled={!importFile || busy} onClick={() => void restoreBackup()} variant="secondary"><Upload size={17}/> Importa ZIP</Button>
          </div>
        </Section>
        <Section title="Esporta libro" description="Genera un'edizione leggibile dalle scene canoniche già completate, senza inviare il testo a servizi esterni.">
          {!current ? <Empty>Seleziona un libro per esportarlo.</Empty> : <>
            <p className="mb-4 text-sm font-semibold">{current.title}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} variant="outline" onClick={() => void downloadBook("epub")}><BookOpen size={17}/> EPUB</Button>
              <Button disabled={busy} variant="outline" onClick={() => void downloadBook("docx")}><FileText size={17}/> Word (DOCX)</Button>
              <Button disabled={busy} variant="outline" onClick={() => void downloadBook("pdf")}><FileText size={17}/> PDF</Button>
            </div>
            <p className="muted mt-3 text-xs">La prima versione esporta prosa e struttura; copertine e illustrazioni non sono ancora supportate.</p>
          </>}
        </Section>
      </div>}

      {ready && page === "settings" && <div className="space-y-3">
        <SaveBar dirty={settingsDirty} savedAt={savedAt}
          onSave={() => void saveEndpointSettings()} onDiscard={() => void discardSettingsChanges()} />
        <section className="panel min-w-0 space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Endpoint OpenAI-compatible</h2>
              <p className="muted text-xs">Le chiavi sono cifrate nel browser, che parla direttamente con l'endpoint (nessun proxy). Senza autenticazione solo per localhost.</p>
            </div>
            <Button variant="outline" onClick={() => setSettings(s => ({ ...s, endpoints: [...s.endpoints, { id: crypto.randomUUID(), name: "Nuovo endpoint", baseUrl: "https://api.openai.com/v1", secret: null, models: [] }] }))}><Plus size={16} /> Aggiungi endpoint</Button>
          </div>
          {settings.endpoints.map(endpoint => <EndpointCard key={endpoint.id} endpoint={endpoint} settings={settings}
            keyDraft={keyDrafts[endpoint.id] ?? ""}
            onKeyDraft={value => setKeyDrafts(old => ({ ...old, [endpoint.id]: value }))}
            onUpdate={update => updateEndpoint(endpoint.id, update)}
            onRatesChange={aiPriceRates => setSettings(s => ({ ...s, aiPriceRates }))}
            onDiscover={() => void discoverModels(endpoint.id)}
            onRemove={settings.endpoints.length > 1
              ? () => setSettings(s => ({ ...s, endpoints: s.endpoints.filter(x => x.id !== endpoint.id) })) : undefined} />)}
        </section>
        <ModelRouterTable settings={settings} setSettings={setSettings} labels={LABELS} notify={setNotice}
          onRecommendedThinking={applyRecommendedThinking} />
        <ModelCapabilitiesPanel settings={settings} updateSettings={setSettings} />
        {current && <p className="muted text-xs">I modelli, il thinking, la redazione leggera e i revisori in parallelo di un singolo libro
          si impostano nella pagina del libro. <button type="button" className="underline" onClick={() => setPage("bookSettings")}>Apri Modelli e redazione di «{current.title}»</button></p>}
        <Section title="Trasparenza e ispezione delle richieste AI" description="Le tracce contengono prompt, testi del romanzo e possibili segreti: restano solo nel database locale del browser, con il tuo consenso, mai nei ZIP o su GitHub.">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={settings.inspectAiRequests === true}
              onChange={e => {
                const inspectAiRequests = e.target.checked;
                // Controlled checkbox: update at once; persist only this preference, never other unsaved edits.
                setSettings(old => ({ ...old, inspectAiRequests }));
                void (async () => {
                  try {
                    await saveSettings({ ...await loadSettings(), inspectAiRequests });
                    setSavedJson(old => old ? JSON.stringify({ ...(JSON.parse(old) as AppSettings), inspectAiRequests }) : old);
                    setNotice("Preferenza d'ispezione salvata localmente.");
                  } catch { setNotice("Impossibile salvare la preferenza d'ispezione."); }
                })();
              }} />
            <span>Ispezione locale richieste AI: mostra e conserva i messaggi system/user e le risposte dei prossimi task. Disattivata per impostazione predefinita, non retroattiva.</span>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void (async () => {
              if (!window.confirm("Eliminare definitivamente tutte le richieste e risposte AI conservate localmente in questo browser?")) return;
              try { const count = await clearAiTraces(); setNotice(`Eliminate ${count} tracce AI locali.`); }
              catch { setNotice("Impossibile eliminare le tracce AI locali."); }
            })()}>Cancella tutte le tracce AI locali</Button>
            <span className="muted text-xs">Questa preferenza si salva subito. Lo streaming è un'anteprima non approvata; il reasoning compare solo se il modello lo trasmette.</span>
          </div>
        </Section>
        <Section title="Google / Microsoft / GitHub" description="Login cloud non ancora attivi in questa versione.">
          <p className="muted flex items-start gap-2 text-sm"><Users size={18} className="shrink-0" /> Nessun login Google/Microsoft simulato. Il PAT GitHub si configura nell'Archivio e resta cifrato nel browser; sincronizzazione manuale, autosync e lease del writer sono lì.</p>
        </Section>
      </div>}

      <footer className="muted mt-10 flex flex-wrap items-center gap-2 text-xs"><BrainCircuit size={14} /> Autopilot nel browser aperto: nessuna attività garantita in background. <FileText size={14} /> Versione iniziale.</footer>
    </main>


  </div>;
}
