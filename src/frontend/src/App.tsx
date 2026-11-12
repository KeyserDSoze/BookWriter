import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, Cloud, Database,
  FileText, Github, LayoutDashboard, ListChecks, Moon, Pause, Play, Plus,
  RefreshCw, Settings2, Sun, Users, WandSparkles, Download, Upload, ShieldCheck, FileArchive,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { AutopilotRunner, requestRevision } from "./application/autopilot";
import { AiTaskWorkspace } from "./components/AiTaskWorkspace";
import { clearAiTraces, currentLiveAi, subscribeLiveAi, type LiveAiTrace } from "./infrastructure/ai-observability";
import { confirmEditorialScene } from "./application/editorial-review";
import { DEFAULT_SETTINGS, TASK_KINDS, newBook, type Activity, type AppSettings, type BookProject, type EndpointProfile, type TaskKind } from "./domain/types";
import { declaredModelCapabilities } from "./domain/model-capabilities";
import { decryptLocal, encryptLocal } from "./infrastructure/crypto";
import { endpointAuthMode, fetchModels, normalizeEndpoint } from "./infrastructure/ai";
import { DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS, MIN_CHAT_HEADER_TIMEOUT_SECONDS, MAX_CHAT_HEADER_TIMEOUT_SECONDS } from "./infrastructure/ai-header-timeout";
import { listActivities, listBooks, loadSettings, recoverInterruptedRuns, saveBook, saveSettings } from "./infrastructure/db";
import { createBackup, downloadBackup, importBackup, readBackup, type BackupMode } from "./infrastructure/backup";
import { exportDocx, exportEpub, exportPdf } from "./infrastructure/export-book";
import { GitHubSyncPanel } from "./components/GitHubSyncPanel";
import { ConflictReviewPanel } from "./components/ConflictReviewPanel";
import { SyncStatusSummary } from "./components/SyncStatusSummary";
import { AiUsagePanel } from "./components/AiUsagePanel";
import { AiBudgetPanel } from "./components/AiBudgetPanel";
import { ModelCapabilitiesPanel } from "./components/ModelCapabilitiesPanel";
import { VoiceReaderPanel } from "./components/VoiceReaderPanel";
import { SemanticSearchPanel } from "./components/SemanticSearchPanel";
import { EditorialBoardPanel } from "./components/EditorialBoardPanel";
import { drainGitHubOutbox } from "./application/auto-sync";
import { updateBookModelRoute } from "./application/book-settings";
import { isCurrentModelInventoryRequest } from "./application/model-inventory";
import { EndpointSettingsSaveCoordinator, StaleEndpointSettingsSave } from "./application/endpoint-settings-save";
import packageInfo from "../package.json";

type Page = "dashboard" | "activities" | "reader" | "atlas" | "settings" | "export";
const navigation: Array<{ id: Page; label: string; icon: typeof BookOpen }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "activities", label: "Attività", icon: ListChecks },
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
  const [keyDrafts, renderKeyDrafts] = useState<Record<string, string>>({});
  const keyDraftsRef = useRef(keyDrafts);
  function setKeyDrafts(update: React.SetStateAction<Record<string, string>>): void {
    const next = typeof update === "function" ? update(keyDraftsRef.current) : update;
    keyDraftsRef.current = next;
    renderKeyDrafts(next);
  }
  const latestModelInventoryRequest = useRef<Record<string, number>>({});
  const endpointSettingsSave = useRef(new EndpointSettingsSaveCoordinator()).current;
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [writingStyle, setWritingStyle] = useState("Narrativa immersiva, concreta, coerente; niente cliché.");
  const [audience, setAudience] = useState("Lettori adulti");
  const [intervention, setIntervention] = useState("");
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

  const refresh = useCallback(async () => {
    const all = await listBooks();
    setBooks(all);
    setSelectedId(prev => prev || all[0]?.id || "");
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        await recoverInterruptedRuns();
        await refresh();
        setSettings(await loadSettings());
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
  const latestActivity = activities.find(x => x.status === "running") ?? activities[0];
  const allScenes = current?.chapters.flatMap(c => c.scenes) ?? [];
  const doneScenes = allScenes.filter(s => s.status === "canon").length;
  const progress = allScenes.length ? Math.round(doneScenes / allScenes.length * 100) : null;

  async function createProject() {
    if (!brief.trim()) { setNotice("Inserisci una descrizione iniziale del libro."); return; }
    const book = newBook(brief, title, writingStyle, audience);
    await saveBook(book); await refresh(); setSelectedId(book.id);
    setBrief(""); setTitle(""); setNotice("Libro creato in IndexedDB. Configura un modello e avvia l'autopilot.");
  }
  async function execute() {
    if (!current) return;
    setNotice("");
    void runner.run(current.id, async () => { await refresh(); void drainGitHubOutbox(); })
      .catch(e => setNotice(e instanceof Error ? e.message : "Errore di esecuzione."));
  }
  function pause() { runner.stop(); setNotice("Pausa richiesta: arresto della chiamata in corso e salvataggio del checkpoint."); }
  function prepareActivityRevision(item:Activity) {
    setIntervention(`Rivedi l'attività "${item.title}" (fase ${item.phase}, ID ${item.id}). Modifica questa scelta e analizza l'impatto sulle scene e sui capitoli dipendenti: `);
    setPage("dashboard");
    if(current?.status==="running")setNotice("Intervento preparato. Premi prima Pausa e verifica lo stato, poi richiedi la revisione.");
    else setNotice("Istruzione preparata. Modifica il testo prima di richiedere la revisione. Non ripristina automaticamente un checkpoint storico.");
  }
  async function sendFeedback() {
    if (!current) return;
    // Capture the revision displayed to the author, not an IndexedDB revision
    // reloaded only after the submit. A stale tab must ask for confirmation.
    const { id, updatedAt } = current;
    try {
      await requestRevision(id, intervention, updatedAt);
      setIntervention(""); setNotice("Istruzione permanente salvata. Riprendi per analizzare l'impatto e riscrivere le scene dipendenti.");
      await refresh();
    } catch (e) {
      await refresh(); // Present the new canon/state before the author retries.
      // Keep the user's draft: the instruction was NOT accepted or persisted.
      setNotice(e instanceof Error ? e.message : "Feedback non applicabile.");
    }
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
    await saveSettings(next); setSettings(next); setNotice("Impostazioni salvate in IndexedDB.");
  }
  function updateEndpoint(id: string, update: Partial<EndpointProfile>) {
    setSettings(old => ({ ...old, endpoints: old.endpoints.map(e => e.id === id ? { ...e, ...update } : e) }));
  }
  async function saveEndpointSettings() {
    // Capture the actual inputs at the click, not a possibly stale render.
    const snapshot = { settings: settingsRef.current, keyDrafts: keyDraftsRef.current };
    try {
      await endpointSettingsSave.save(snapshot,
        () => ({ settings: settingsRef.current, keyDrafts: keyDraftsRef.current }),
        encryptLocal, saveSettings, next => {
          setSettings(next);
          setKeyDrafts({});
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
      // Synchronous ref-based commit: there is no async gap after the guard
      // and no side effect inside a React state updater.
      const latest = settingsRef.current;
      setSettings({ ...latest, endpoints: latest.endpoints.map(profile =>
        profile === endpoint ? { ...profile, models } : profile) });
      setNotice(`Trovati ${models.length} modelli. Premi Salva impostazioni per conservarli.`);
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
      if (wantsSettings) setSettings(await loadSettings());
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
        className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-md px-2 text-[10px] ${page===id ? "text-emerald-500 font-bold" : "muted"}`}
        onClick={() => setPage(id)}><Icon size={19}/>{label}</button>)}
    </nav>

    <main className="min-w-0 px-3 pb-8 pt-3 sm:px-6 sm:pt-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{navigation.find(x => x.id === page)?.label}</h1>
          <p className="muted text-sm">Progetto local-first · GitHub autosync opzionale <span className="sm:hidden">· v{packageInfo.version}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex size-11 items-center justify-center rounded-lg border border-slate-400 dark:border-slate-700" aria-label="Cambia tema chiaro/scuro"
            onClick={() => { const next: AppSettings = { ...settings, theme: settings.theme === "dark" ? "light" : "dark" }; void persistSettings(next); }}>
            {settings.theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      {!ready && <p role="status" className="muted mb-4">Caricamento archivio locale…</p>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{notice}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold" htmlFor="book-select">Libro attivo</label>
        <select id="book-select" className="field max-w-xs" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
          <option value="">{books.length ? "+ Nuovo libro" : "Nessun libro"}</option>
          {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      </div>

      {current && <div className="panel sticky top-0 z-20 mb-4 flex flex-col gap-3 p-3 shadow-md sm:static sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{statusText[current.status]} · {phaseText[current.phase]}</p>
          <p className="muted truncate text-xs">{latestActivity?.status === "running" ? `Ora: ${latestActivity.title}` : `Prossimo: ${phaseText[current.phase]}`}</p>
          <p className="muted text-xs">{progress === null ? "Piano non ancora creato" : `${doneScenes}/${allScenes.length} scene canoniche (${progress}%)`}</p>
        </div>
        <div className="flex gap-2">
          {current.status === "running" ? <Button onClick={pause} variant="secondary"><Pause size={17} /> Pausa</Button>
            : current.status !== "completed" || current.revision ? <Button disabled={(current.editorialReviewSceneIds?.length ?? 0) > 0} onClick={() => void execute()}><Play size={17} /> {current.status === "paused" || current.status === "error" ? "Riprendi" : "Autopilot"}</Button> : null}
          <Button variant="outline" onClick={() => setPage("activities")}><ListChecks size={17} /> Log</Button>
          {(current.editorialReviewSceneIds?.length ?? 0) > 0 && <Button variant="outline" onClick={() => setPage("reader")}>Rileggi scene ({current.editorialReviewSceneIds?.length})</Button>}
        </div>
      </div>}

      {page === "dashboard" && <div className="space-y-4">
        {current&&<AiTaskWorkspace bookId={current.id} activities={activities}
          live={liveAi} inspectionEnabled={settings.inspectAiRequests===true}
          onPrepareRevision={prepareActivityRevision} compact/>}
        <details open={!current || current.status!=="running"} className="min-w-0">
          <summary className="mb-3 cursor-pointer rounded-lg border border-slate-400/40 p-3 text-sm font-semibold">
            Brief, interventi, redazione e informazioni avanzate del libro
          </summary>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[1.65fr_1fr]">
        <div className="space-y-4">
          {!current && <Section title="Nuovo libro" description="Descrivi liberamente il libro: l'AI costruirà il piano e proseguirà scena per scena.">
            <div className="space-y-4">
              <Field label="Titolo provvisorio"><input className="field" value={title} onChange={e => setTitle(e.target.value)} /></Field>
              <Field label="Descrizione iniziale, spunti e vincoli"><textarea className="field min-h-48" rows={8} value={brief} onChange={e => setBrief(e.target.value)} placeholder="Racconta l'ambientazione, i personaggi, le idee, la struttura desiderata, i segreti e tutti i vincoli. Nessun limite artificiale di testo." /></Field>
              <Field label="Stile"><textarea className="field" rows={2} value={writingStyle} onChange={e => setWritingStyle(e.target.value)} /></Field>
              <Field label="Audience"><input className="field" value={audience} onChange={e => setAudience(e.target.value)} /></Field>
              <Button onClick={() => void createProject()}><Plus size={18} /> Crea libro</Button>
            </div>
          </Section>}
          {current && <Section title="Brief e visione del libro">
            <p className="whitespace-pre-wrap text-sm leading-7">{current.brief}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><p className="muted text-xs">Stile</p><p className="text-sm">{current.writingStyle}</p></div>
              <div><p className="muted text-xs">Audience</p><p className="text-sm">{current.audience}</p></div>
            </div>
            {(current.authorConstraints?.length ?? 0) > 0 && <div className="mt-4"><h3 className="font-semibold">Vincoli inderogabili dell'autore</h3>{current.authorConstraints?.map((x,i) => <p className="mt-1 text-sm" key={i}>• {x}</p>)}</div>}
          </Section>}
          {current && <Section title="Intervieni sull'autopilot" description="Una correzione diventa un vincolo persistente. L'IA analizzerà l'impatto e riscriverà la parte interessata e le scene successive.">
            <textarea className="field min-h-28" value={intervention} onChange={e => setIntervention(e.target.value)} placeholder="No, così non va bene: modifica assolutamente..." aria-label="Istruzione di revisione" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button disabled={!intervention.trim() || current.status === "running" || !!current.editorialReviewSceneIds?.length} onClick={() => void sendFeedback()}><WandSparkles size={16} /> Richiedi revisione</Button>
              {current.status === "running" && <span className="muted text-xs">Premi prima Pausa.</span>}
            </div>
            {current.revision && <p className="mt-3 text-sm">Revisione in corso: {current.revision.instruction} ({current.revision.cursor}/{current.revision.affectedSceneIds.length})</p>}
          </Section>}
          {current?.ideas && <Section title="Idee long / mid / short term"><div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{current.ideas}</div></Section>}
          {current?.previousError && <Section title="Attenzione">
            <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-300"><AlertTriangle size={18} className="shrink-0" /> {current.previousError}</p>
            <p className="muted mt-2 text-xs">Il flusso è fermo. Controlla il registro e la Redazione multi-agente: potrebbero essere necessari interventi, crediti AI o una nuova tornata.</p>
          </Section>}
        </div>
        <div className="space-y-4">
          <Section title="Gestione ed analisi del libro" description="Controlli editoriali aggiuntivi; la timeline task è sempre visibile più in alto.">
            <Button variant="outline" onClick={() => setPage("activities")}>Apri registro attività completo</Button>
          </Section>
          {current && <EditorialBoardPanel book={current} onRefresh={refresh}/>}
          {current && <AiUsagePanel activities={activities} endpoints={settings.endpoints}/>}
          {current && <AiBudgetPanel key={current.id} book={current} settings={settings}
            activities={activities} onSaveSettings={persistSettings} onRefresh={refresh}/>}
          <Section title="Memoria narrativa">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["Capitoli", current?.chapters.length ?? 0],
                ["Scene canoniche", doneScenes],
                ["Personaggi", Object.keys(current?.memory.characters ?? {}).length],
                ["Luoghi", Object.keys(current?.memory.locations ?? {}).length],
                ["Fazioni", Object.keys(current?.memory.factions ?? {}).length],
                ["Oggetti", Object.keys(current?.memory.items ?? {}).length],
                ["Segreti", Object.keys(current?.memory.secrets ?? {}).length],
                ["Eventi timeline", current?.memory.timeline.length ?? 0],
              ].map(([label,value]) => <div key={String(label)} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
                <div className="muted text-xs">{label}</div><div className="text-xl font-bold">{value}</div>
              </div>)}
            </div>
          </Section>
          <Section title="Sincronizzazione e checkpoint">
            {current ? <SyncStatusSummary book={current} openArchive={() => setPage("export")}/> : <Empty>Crea un libro per collegare GitHub.</Empty>}
          </Section>
        </div>
        </div>
        </details>
      </div>}

      {page === "activities" && (current ?
        <AiTaskWorkspace bookId={current.id} activities={activities} live={liveAi}
          inspectionEnabled={settings.inspectAiRequests===true}
          onPrepareRevision={prepareActivityRevision}/>
        : <Section title="Registro delle attività"><Empty>Seleziona un libro per ispezionare le attività.</Empty></Section>)}

      {page === "reader" && <div className="space-y-4">
        {current && <>
          <VoiceReaderPanel book={current} settings={settings} />
          <SemanticSearchPanel book={current} settings={settings} />
        </>}
        <Section title="Il libro" description="Anteprima della prosa canonizzata. EPUB, DOCX e PDF saranno disponibili nella sezione Export.">
        {!current?.chapters.length ? <Empty>Non c'è ancora un piano capitoli. Avvia l'autopilot.</Empty>
          : current.chapters.map(ch => <article key={ch.id} className="mb-8">
            <h3 className="mb-3 border-b border-slate-300 pb-2 text-xl font-bold dark:border-slate-700">Capitolo {ch.number} — {ch.title}</h3>
            <p className="muted mb-4 text-sm">{ch.purpose}</p>
            {ch.scenes.map(s => <section key={s.id} id={`book-scene-${s.id}`} className="mb-6 scroll-mt-24">
              <h4 className="mb-2 font-semibold">{s.number}. {s.title} <span className="muted text-xs">({s.status})</span></h4>
              {s.text ? <p className="whitespace-pre-wrap break-words text-[1rem] leading-8">{s.text}</p> : <p className="muted text-sm">Scena non ancora scritta.</p>}
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

      {page === "settings" && <div className="space-y-4">
        <Section title="Trasparenza e ispezione delle richieste AI" description="Le tracce complete contengono prompt, testi del romanzo e possibili segreti: soltanto con consenso esplicito vengono conservate nel database locale del browser, mai nei ZIP o su GitHub.">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={settings.inspectAiRequests===true}
              onChange={e=>{
                const next={...settingsRef.current,inspectAiRequests:e.target.checked};
                // Controlled checkbox must update synchronously; IndexedDB write is async.
                setSettings(next);
                void saveSettings(next).then(()=>setNotice("Preferenza d'ispezione salvata localmente."))
                  .catch(()=>setNotice("Impossibile salvare la preferenza d'ispezione."));
              }}/>
            <span>Ispezione locale richieste AI: mostra e conserva i messaggi system/user e le risposte dei prossimi task. Disattivata per impostazione predefinita, non retroattiva.</span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={()=>void (async()=>{
              if(!window.confirm("Eliminare definitivamente tutte le richieste e risposte AI conservate localmente in questo browser?"))return;
              try{const count=await clearAiTraces();setNotice(`Eliminate ${count} tracce AI locali.`);}
              catch{setNotice("Impossibile eliminare le tracce AI locali.");}
            })()}>Cancella tutte le tracce AI locali</Button>
          </div>
          <p className="muted mt-2 text-xs">Il registro attività salva già gli output delle attività confermate. Lo streaming è un'anteprima non approvata e l'eventuale reasoning è mostrato soltanto se il modello lo trasmette.</p>
        </Section>
        <Section title="Endpoint OpenAI-compatible" description="Configura servizi con chiavi cifrate in IndexedDB, oppure senza autenticazione per localhost. Il browser parla direttamente con l'endpoint, senza backend proxy.">
          <div className="space-y-4">
            {settings.endpoints.map(endpoint => <div key={endpoint.id} className="space-y-3 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome endpoint"><input className="field" value={endpoint.name} onChange={e => updateEndpoint(endpoint.id, { name: e.target.value })} /></Field>
                <Field label="Base URL"><input className="field" inputMode="url" value={endpoint.baseUrl} onChange={e => updateEndpoint(endpoint.id, { baseUrl: e.target.value })} /></Field>
                <div className="block min-w-0">
                  <label className="mb-1 block text-sm font-semibold" htmlFor={`endpoint-auth-${endpoint.id}`}>Autenticazione AI</label>
                  <select id={`endpoint-auth-${endpoint.id}`} className="field" value={endpoint.authMode ?? "api_key"}
                    onChange={e => {
                      const authMode = e.target.value as "api_key" | "none";
                      updateEndpoint(endpoint.id, { authMode });
                      if (authMode === "none") setKeyDrafts(old => {
                        const next = { ...old };
                        delete next[endpoint.id];
                        return next;
                      });
                    }}>
                    <option value="api_key">API key (Bearer)</option>
                    <option value="none">Nessuna autenticazione (solo localhost)</option>
                  </select>
                </div>
                {endpoint.authMode !== "none" && <Field label={endpoint.secret ? "Nuova API key (opzionale; già salvata)" : "API key"}>
                  <input type="password" className="field" autoComplete="off" value={keyDrafts[endpoint.id] ?? ""} onChange={e => setKeyDrafts(old => ({ ...old, [endpoint.id]: e.target.value }))} placeholder={endpoint.secret ? "••••••••••" : "Inserisci la chiave"} />
                </Field>}
                <Field label="Modelli rilevati / manuali">
                  <input className="field" value={endpoint.models.join(", ")} onChange={e => updateEndpoint(endpoint.id, { models: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} placeholder="es. model-a, model-b" />
                </Field>
                <Field label="Streaming Chat Completions">
                  <select className="field" value={endpoint.streamMode??"off"}
                    onChange={e=>updateEndpoint(endpoint.id,{streamMode:e.target.value as "off"|"sse"})}>
                    <option value="off">Compatibilità JSON (nessuno streaming)</option>
                    <option value="sse">Streaming SSE (provider compatibile)</option>
                  </select>
                </Field>
                <Field label="Reasoning effort AI">
                  <select className="field" value={endpoint.reasoningEffort??""}
                    onChange={e=>updateEndpoint(endpoint.id,{
                      reasoningEffort:e.target.value===""?undefined:
                        e.target.value as "low"|"medium"|"high"|"xhigh",
                    })}>
                    <option value="">Automatico (non inviare parametro)</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">Extra high (xhigh)</option>
                  </select>
                </Field>
                <Field label="Parametro limite output API">
                  <select className="field" value={endpoint.outputTokenParameter ?? "max_tokens"}
                    onChange={e => updateEndpoint(endpoint.id, {
                      outputTokenParameter: e.target.value as "max_tokens" | "max_completion_tokens",
                    })}>
                    <option value="max_tokens">max_tokens (compatibilità precedente)</option>
                    <option value="max_completion_tokens">max_completion_tokens (modelli compatibili)</option>
                  </select>
                </Field>
                <Field label="Attesa massima header AI (secondi)">
                  <input className="field" type="number" min={MIN_CHAT_HEADER_TIMEOUT_SECONDS}
                    max={MAX_CHAT_HEADER_TIMEOUT_SECONDS} step={60}
                    value={endpoint.headerTimeoutSeconds ?? DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS}
                    onChange={e => updateEndpoint(endpoint.id, { headerTimeoutSeconds: Number(e.target.value) })} />
                </Field>
              </div>
              <p className="muted text-xs">Per LM Studio imposta http://localhost:1234/v1 e «Nessuna autenticazione» (solo localhost/127.0.0.1). Questa modalità elimina la chiave precedente al salvataggio e omette Authorization. Abilita CORS nel server locale per il browser; non esporre un server senza autenticazione in rete. Il parametro limite output si invia soltanto quando il budget AI imposta il tetto. Verifica il campo supportato dai modelli di questo endpoint: se il provider lo rifiuta, correggi la scelta e riprova manualmente, senza retry automatico e possibili doppi costi. max_completion_tokens può includere token di ragionamento non visibili. L'attesa degli header va da 60 a 1800 s (default 300), la lettura JSON ha un limite separato di 60 s e lo stream SSE un limite di dieci minuti; un timeout non esclude addebiti. Attiva SSE solo se supportato dall'endpoint: non eseguiamo retry automatici dopo un errore. Il campo reasoning_effort è facoltativo e può essere rifiutato da modelli non compatibili. Il browser comunica direttamente con localhost; verifica il Network della scheda che ospita BookWriter, non quello di altre applicazioni.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void discoverModels(endpoint.id)}><RefreshCw size={16} /> Leggi /models</Button>
                {settings.endpoints.length > 1 && <Button variant="destructive" onClick={() => setSettings(s => ({...s, endpoints:s.endpoints.filter(x => x.id !== endpoint.id)}))}>Rimuovi</Button>}
              </div>
            </div>)}
            <Button variant="outline" onClick={() => setSettings(s => ({ ...s, endpoints:[...s.endpoints, {id:crypto.randomUUID(),name:"Nuovo endpoint",baseUrl:"https://api.openai.com/v1",secret:null,models:[]}] }))}><Plus size={16}/> Aggiungi endpoint</Button>
          </div>
        </Section>
        <ModelCapabilitiesPanel settings={settings} updateSettings={setSettings} />
        <Section title="Router dei modelli" description="Predefinito Chat / scrittura per l'autopilot, più override per ogni attività. Modelli embedding/voce non vengono richiamati dall'autopilot.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Endpoint predefinito"><select className="field" value={settings.defaultRoute.endpointId} onChange={e => setSettings(s => ({...s,defaultRoute:{...s.defaultRoute,endpointId:e.target.value}}))}>
              {settings.endpoints.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}
            </select></Field>
            <Field label="Modello predefinito"><input className="field" value={settings.defaultRoute.modelId} onChange={e => setSettings(s => ({...s,defaultRoute:{...s.defaultRoute,modelId:e.target.value}}))} placeholder="Digita un ID modello Chat" /></Field>
            <div className="min-w-0">
              <label className="mb-1 block text-sm font-semibold" htmlFor="chat-model-catalog-select">Seleziona modello Chat dal catalogo</label>
              <select id="chat-model-catalog-select" className="field"
                value={settings.endpoints.find(e => e.id === settings.defaultRoute.endpointId)?.models.includes(settings.defaultRoute.modelId) ? settings.defaultRoute.modelId : ""}
                onChange={e => {
                  if (e.target.value) setSettings(s => ({...s,defaultRoute:{...s.defaultRoute,modelId:e.target.value}}));
                }}>
                <option value="">Scelta manuale / nessun modello catalogato</option>
                {settings.endpoints.find(endpoint => endpoint.id === settings.defaultRoute.endpointId)?.models
                  .filter(modelId => {
                    const endpoint = settings.endpoints.find(e => e.id === settings.defaultRoute.endpointId)!;
                    const roles = declaredModelCapabilities(endpoint, modelId);
                    return roles.length === 0 || roles.includes("chat");
                  }).map(modelId => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {TASK_KINDS.map(kind => {
              const route = settings.taskRoutes[kind];
              return <div key={kind} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
                <p className="mb-2 text-sm font-semibold">{LABELS[kind]}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select aria-label={`Endpoint per ${LABELS[kind]}`} className="field" value={route?.endpointId ?? ""} onChange={e => setSettings(s => ({...s,taskRoutes:{...s.taskRoutes,[kind]:{endpointId:e.target.value||s.defaultRoute.endpointId,modelId:route?.modelId??s.defaultRoute.modelId}}}))}>
                    <option value="">Default</option>{settings.endpoints.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <input className="field" aria-label={`Modello per ${LABELS[kind]}`} value={route?.modelId ?? ""} onChange={e => setSettings(s => ({...s,taskRoutes:{...s.taskRoutes,[kind]:{endpointId:route?.endpointId||s.defaultRoute.endpointId,modelId:e.target.value}}}))} placeholder="Default" />
                </div>
              </div>;
            })}
          </div>
        </Section>
        {current && <Section title={`Override del libro: ${current.title}`} description="Il modello scelto qui sostituisce quello globale soltanto per il libro attivo.">
          <div className="grid gap-3 md:grid-cols-2">
            {(["brainstorm","prose","continuity","revision","consolidate","summarize","merge","chapterAudit","chapterReaders","chapterJudge","chapterRepair"] as TaskKind[]).map(kind => {
              const configured = current.modelRoutes?.[kind];
              return <div className="space-y-2" key={kind}>
                <p className="text-sm font-semibold">{LABELS[kind]}</p>
                <select className="field" aria-label={`Endpoint libro per ${LABELS[kind]}`} value={configured?.endpointId ?? settings.defaultRoute.endpointId} onChange={e => void updateBookRoute(kind, e.target.value, configured?.modelId ?? settings.defaultRoute.modelId)}>
                  {settings.endpoints.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <input
                  key={`${current.id}:${kind}:${current.updatedAt}:${bookModelResets[kind] ?? 0}`}
                  className="field" aria-label={`Modello libro per ${LABELS[kind]}`}
                  defaultValue={configured?.modelId ?? ""}
                  onBlur={e => {
                    if (e.target.value !== (configured?.modelId ?? ""))
                      void updateBookRoute(kind, configured?.endpointId ?? settings.defaultRoute.endpointId, e.target.value);
                  }}
                  placeholder="Modello per questo libro"
                />
              </div>;
            })}
          </div>
        </Section>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void saveEndpointSettings()}><CheckCircle2 size={17} /> Salva impostazioni</Button>
        </div>
        <Section title="Google / Microsoft / GitHub" description="Integrazioni cloud non ancora attive in questa prima implementazione.">
          <p className="muted flex items-start gap-2 text-sm"><Users size={18} className="shrink-0" /> Nessuna login Google/Microsoft simulata. Il PAT GitHub si configura nella sezione Archivio e resta cifrato nel browser.</p>
          <p className="muted mt-2 text-sm">La sincronizzazione GitHub manuale è nella sezione Archivio. Lease, autosync e snapshot ZIP remoti sono in programma.</p>
        </Section>
      </div>}

      <footer className="muted mt-10 flex flex-wrap items-center gap-2 text-xs"><BrainCircuit size={14} /> Autopilot nel browser aperto: nessuna attività garantita in background. <FileText size={14} /> Versione iniziale.</footer>
    </main>


  </div>;
}
