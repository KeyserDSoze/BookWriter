import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, Cloud, Database,
  FileText, Github, LayoutDashboard, ListChecks, Moon, Pause, Play, Plus,
  RefreshCw, Settings2, Sun, Users, WandSparkles, Download, Upload, ShieldCheck, FileArchive,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { AutopilotRunner, requestRevision } from "./application/autopilot";
import { DEFAULT_SETTINGS, TASK_KINDS, newBook, type Activity, type AppSettings, type BookProject, type EndpointProfile, type TaskKind } from "./domain/types";
import { decryptLocal, encryptLocal } from "./infrastructure/crypto";
import { fetchModels, normalizeEndpoint } from "./infrastructure/ai";
import { listActivities, listBooks, loadSettings, recoverInterruptedRuns, saveBook, saveSettings } from "./infrastructure/db";
import { createBackup, downloadBackup, importBackup, readBackup, type BackupMode } from "./infrastructure/backup";
import { exportDocx, exportEpub, exportPdf } from "./infrastructure/export-book";

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
  continuity: "Review continuità", consolidate: "Consolidamento", summarize: "Riassunti", revision: "Revisioni",
};
const statusText: Record<BookProject["status"], string> = {
  idle: "Da avviare", running: "In esecuzione", paused: "In pausa",
  error: "Errore: intervento richiesto", completed: "Libro completato",
};
const phaseText: Record<BookProject["phase"], string> = {
  brainstorm: "Brainstorming", validate: "Validazione", audience: "Audience review",
  adversarial: "Adversarial review", outline: "Outline", prose: "Scrittura scena",
  review: "Review scena", consolidate: "Consolidamento canon", revision: "Revisione autore", completed: "Completato",
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
  const [settings, setSettings] = useState<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [writingStyle, setWritingStyle] = useState("Narrativa immersiva, concreta, coerente; niente cliché.");
  const [audience, setAudience] = useState("Lettori adulti");
  const [intervention, setIntervention] = useState("");
  const [notice, setNotice] = useState("");
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
    if (selectedId) void listActivities(selectedId).then(setActivities).catch(() => setActivities([]));
    else setActivities([]);
  }, [selectedId, books]);
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
    void runner.run(current.id, refresh).catch(e => setNotice(e instanceof Error ? e.message : "Errore di esecuzione."));
  }
  function pause() { runner.stop(); setNotice("Pausa richiesta: arresto della chiamata in corso e salvataggio del checkpoint."); }
  async function sendFeedback() {
    if (!current) return;
    try {
      await requestRevision(current.id, intervention);
      setIntervention(""); setNotice("Istruzione permanente salvata. Riprendi per analizzare l'impatto e riscrivere le scene dipendenti.");
      await refresh();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Feedback non applicabile."); }
  }
  async function persistSettings(next: AppSettings) {
    await saveSettings(next); setSettings(next); setNotice("Impostazioni salvate in IndexedDB.");
  }
  function updateEndpoint(id: string, update: Partial<EndpointProfile>) {
    setSettings(old => ({ ...old, endpoints: old.endpoints.map(e => e.id === id ? { ...e, ...update } : e) }));
  }
  async function saveEndpointSettings() {
    try {
      const endpoints = await Promise.all(settings.endpoints.map(async e => {
        const newKey = keyDrafts[e.id];
        return {
          ...e,
          baseUrl: normalizeEndpoint(e.baseUrl),
          secret: newKey ? await encryptLocal(newKey) : e.secret,
        };
      }));
      await persistSettings({ ...settings, endpoints });
      setKeyDrafts({});
    } catch (e) { setNotice(e instanceof Error ? e.message : "Impossibile salvare la configurazione."); }
  }
  async function discoverModels(e: EndpointProfile) {
    try {
      const secret = keyDrafts[e.id] || (e.secret ? await decryptLocal(e.secret) : "");
      if (!secret) throw new Error("Inserisci prima la chiave API.");
      const models = await fetchModels(e.baseUrl, secret);
      updateEndpoint(e.id, { models }); setNotice(`Trovati ${models.length} modelli. Premi Salva impostazioni per conservarli.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Elenco modelli non disponibile: inserisci manualmente il nome."); }
  }
  async function updateBookRoute(task: TaskKind, endpointId: string, modelId: string) {
    if (!current) return;
    const modified = structuredClone(current);
    modified.modelRoutes = { ...modified.modelRoutes, [task]: { endpointId, modelId } };
    await saveBook(modified); await refresh();
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
      <p className="muted mt-8 text-xs">v0.1.0 · Dati locali al browser</p>
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
          <p className="muted text-sm">Progetto local-first · Cloud sync in sviluppo</p>
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
            : current.status !== "completed" || current.revision ? <Button onClick={() => void execute()}><Play size={17} /> {current.status === "paused" || current.status === "error" ? "Riprendi" : "Autopilot"}</Button> : null}
          <Button variant="outline" onClick={() => setPage("activities")}><ListChecks size={17} /> Log</Button>
        </div>
      </div>}

      {page === "dashboard" && <div className="grid min-w-0 gap-4 xl:grid-cols-[1.65fr_1fr]">
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
              <Button disabled={!intervention.trim() || current.status === "running"} onClick={() => void sendFeedback()}><WandSparkles size={16} /> Richiedi revisione</Button>
              {current.status === "running" && <span className="muted text-xs">Premi prima Pausa.</span>}
            </div>
            {current.revision && <p className="mt-3 text-sm">Revisione in corso: {current.revision.instruction} ({current.revision.cursor}/{current.revision.affectedSceneIds.length})</p>}
          </Section>}
          {current?.ideas && <Section title="Idee long / mid / short term"><div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{current.ideas}</div></Section>}
          {current?.previousError && <Section title="Attenzione">
            <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-300"><AlertTriangle size={18} className="shrink-0" /> {current.previousError}</p>
            <p className="muted mt-2 text-xs">Il flusso è fermo. Correggi l'endpoint, la chiave o il modello e premi Riprendi.</p>
          </Section>}
        </div>
        <div className="space-y-4">
          <Section title="Cosa sta facendo adesso" description="Ogni attività espone obiettivo, risultato e prossima azione.">
            {latestActivity ? <div className="space-y-3 text-sm">
              <p className="font-semibold">{latestActivity.title}</p>
              <p><b>Perché:</b> {latestActivity.reason}</p>
              <p><b>Stato:</b> {latestActivity.status}</p>
              <p><b>Risultato:</b> {latestActivity.summary || "Attività ancora in corso."}</p>
              <p><b>Prossimo:</b> {latestActivity.nextStep}</p>
              {latestActivity.modelId && <p className="muted text-xs">Modello: {latestActivity.modelId} · Endpoint: {latestActivity.endpointId}</p>}
              <Button variant="outline" onClick={() => setPage("activities")}>Apri registro attività</Button>
            </div> : <Empty>Nessuna operazione registrata.</Empty>}
          </Section>
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
          <Section title="Sincronizzazione cloud">
            <p className="muted flex items-start gap-2 text-sm"><Cloud className="shrink-0" size={18}/> Questa versione salva davvero in IndexedDB. Google, Microsoft e il salvataggio GitHub sono definiti nell'architettura ma non ancora collegati all'app.</p>
            <p className="muted mt-2 flex items-start gap-2 text-sm"><Github className="shrink-0" size={18}/> Nessun PAT viene inviato a GitHub o salvato nei file del libro.</p>
          </Section>
        </div>
      </div>}

      {page === "activities" && <Section title="Registro delle attività" description="Log persistito in IndexedDB. Tocca un'attività per leggere output, modello e motivazione.">
        {!activities.length ? <Empty>Nessun log registrato per questo libro.</Empty>
          : <div className="space-y-2">{activities.map(item => <details key={item.id} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700" open={item.status === "running"}>
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {item.status === "succeeded" ? <CheckCircle2 size={16} className="text-emerald-500" /> : item.status === "failed" ? <AlertTriangle size={16} className="text-red-500" /> : <RefreshCw size={16} />}
                  {item.title}
                </span>
                <span className="muted text-xs">{new Date(item.createdAt).toLocaleString("it-IT")}</span>
              </div>
              <p className="muted mt-1 text-xs">{item.summary ?? item.reason}</p>
            </summary>
            <div className="mt-3 space-y-2 border-t border-slate-300 pt-3 text-sm dark:border-slate-700">
              <p><b>Obiettivo:</b> {item.reason}</p>
              <p><b>Prossimo passo:</b> {item.nextStep}</p>
              <p><b>Stato:</b> {item.status}</p>
              {item.modelId && <p>Endpoint: {item.endpointId} · Modello: {item.modelId}</p>}
              {(item.inputTokens !== undefined || item.outputTokens !== undefined) && <p>Token: input {item.inputTokens ?? "N/D"}, output {item.outputTokens ?? "N/D"}</p>}
              {item.error && <p className="text-red-600 dark:text-red-300">{item.error}</p>}
              {item.output && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-900">{item.output}</pre>}
              <Button variant="outline" onClick={() => { setIntervention(`Correggi il lavoro "${item.title}" (${item.phase}): `); setPage("dashboard"); }}><WandSparkles size={16} /> Intervieni su questa attività</Button>
            </div>
          </details>)}</div>}
      </Section>}

      {page === "reader" && <Section title="Il libro" description="Anteprima della prosa canonizzata. EPUB, DOCX e PDF saranno disponibili nella sezione Export.">
        {!current?.chapters.length ? <Empty>Non c'è ancora un piano capitoli. Avvia l'autopilot.</Empty>
          : current.chapters.map(ch => <article key={ch.id} className="mb-8">
            <h3 className="mb-3 border-b border-slate-300 pb-2 text-xl font-bold dark:border-slate-700">Capitolo {ch.number} — {ch.title}</h3>
            <p className="muted mb-4 text-sm">{ch.purpose}</p>
            {ch.scenes.map(s => <section key={s.id} className="mb-6">
              <h4 className="mb-2 font-semibold">{s.number}. {s.title} <span className="muted text-xs">({s.status})</span></h4>
              {s.text ? <p className="whitespace-pre-wrap break-words text-[1rem] leading-8">{s.text}</p> : <p className="muted text-sm">Scena non ancora scritta.</p>}
            </section>)}
          </article>)}
      </Section>}

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
        <Section title="Endpoint OpenAI-compatible" description="Configura più servizi. Le chiavi vengono cifrate localmente in IndexedDB; restano utilizzabili dal JavaScript dell'app, non sono protette da un backend.">
          <div className="space-y-4">
            {settings.endpoints.map(endpoint => <div key={endpoint.id} className="space-y-3 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome endpoint"><input className="field" value={endpoint.name} onChange={e => updateEndpoint(endpoint.id, { name: e.target.value })} /></Field>
                <Field label="Base URL"><input className="field" inputMode="url" value={endpoint.baseUrl} onChange={e => updateEndpoint(endpoint.id, { baseUrl: e.target.value })} /></Field>
                <Field label={endpoint.secret ? "Nuova API key (opzionale; già salvata)" : "API key"}>
                  <input type="password" className="field" autoComplete="off" value={keyDrafts[endpoint.id] ?? ""} onChange={e => setKeyDrafts(old => ({ ...old, [endpoint.id]: e.target.value }))} placeholder={endpoint.secret ? "••••••••••" : "Inserisci la chiave"} />
                </Field>
                <Field label="Modelli rilevati / manuali">
                  <input className="field" value={endpoint.models.join(", ")} onChange={e => updateEndpoint(endpoint.id, { models: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} placeholder="es. model-a, model-b" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void discoverModels(endpoint)}><RefreshCw size={16} /> Leggi /models</Button>
                {settings.endpoints.length > 1 && <Button variant="destructive" onClick={() => setSettings(s => ({...s, endpoints:s.endpoints.filter(x => x.id !== endpoint.id)}))}>Rimuovi</Button>}
              </div>
            </div>)}
            <Button variant="outline" onClick={() => setSettings(s => ({ ...s, endpoints:[...s.endpoints, {id:crypto.randomUUID(),name:"Nuovo endpoint",baseUrl:"https://api.openai.com/v1",secret:null,models:[]}] }))}><Plus size={16}/> Aggiungi endpoint</Button>
          </div>
        </Section>
        <Section title="Router dei modelli" description="Un modello generico e un override per ogni tipo di attività. Lascia vuoto per usare il modello predefinito.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Endpoint predefinito"><select className="field" value={settings.defaultRoute.endpointId} onChange={e => setSettings(s => ({...s,defaultRoute:{...s.defaultRoute,endpointId:e.target.value}}))}>
              {settings.endpoints.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}
            </select></Field>
            <Field label="Modello predefinito"><input className="field" value={settings.defaultRoute.modelId} onChange={e => setSettings(s => ({...s,defaultRoute:{...s.defaultRoute,modelId:e.target.value}}))} placeholder="ID modello da /models" /></Field>
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
            {(["brainstorm","prose","continuity","revision","consolidate","summarize"] as TaskKind[]).map(kind => {
              const configured = current.modelRoutes?.[kind];
              return <div className="space-y-2" key={kind}>
                <p className="text-sm font-semibold">{LABELS[kind]}</p>
                <select className="field" aria-label={`Endpoint libro per ${LABELS[kind]}`} value={configured?.endpointId ?? settings.defaultRoute.endpointId} onChange={e => void updateBookRoute(kind, e.target.value, configured?.modelId ?? settings.defaultRoute.modelId)}>
                  {settings.endpoints.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <input className="field" aria-label={`Modello libro per ${LABELS[kind]}`} value={configured?.modelId ?? ""} onChange={e => void updateBookRoute(kind, configured?.endpointId ?? settings.defaultRoute.endpointId, e.target.value)} placeholder="Modello per questo libro" />
              </div>;
            })}
          </div>
        </Section>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void saveEndpointSettings()}><CheckCircle2 size={17} /> Salva impostazioni</Button>
        </div>
        <Section title="Google / Microsoft / GitHub" description="Integrazioni cloud non ancora attive in questa prima implementazione.">
          <p className="muted flex items-start gap-2 text-sm"><Users size={18} className="shrink-0" /> Nessuna login simulata: serviranno le app registration OAuth. Non inserire PAT qui fino all'attivazione del vault cloud.</p>
          <p className="muted mt-2 text-sm">La sincronizzazione GitHub con commit Markdown, lease e snapshot ZIP è specificata in docs/sync.md e verrà attivata in una fase successiva.</p>
        </Section>
      </div>}

      <footer className="muted mt-10 flex flex-wrap items-center gap-2 text-xs"><BrainCircuit size={14} /> Autopilot nel browser aperto: nessuna attività garantita in background. <FileText size={14} /> Versione iniziale.</footer>
    </main>


  </div>;
}
