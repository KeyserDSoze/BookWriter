import { useEffect, useState } from "react";
import { Cloud, Download, Github, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import type { AppSettings, BookProject, GitHubRemote, SyncOutboxItem } from "../domain/types";
import { encryptLocal } from "../infrastructure/crypto";
import { getBook, saveBook } from "../infrastructure/db";
import { acknowledgeOutbox, getOutbox, retryBlockedSync } from "../infrastructure/outbox";
import { drainGitHubOutbox } from "../application/auto-sync";
import {
  inspectWriterLease, isLeaseRecoverable, recoverExpiredWriterLease,
  type WriterLeaseStatus,
} from "../infrastructure/github-lease";
import {
  importGitHubBook, inspectRepository, pushGitHubBook, validateRemote,
  type RepoInfo,
} from "../infrastructure/github-sync";

interface Props {
  book?: BookProject;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectBook: (bookId: string) => void;
}

function InputField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; type?: string;
}) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-sm font-semibold">{label}</span>
    <input className="field" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} type={type} autoComplete="off"/>
  </label>;
}

/** PAT never leaves IndexedDB except as Bearer token to api.github.com. */
export function GitHubSyncPanel({ book, settings, onSaveSettings, onRefresh, onSelectBook }: Props) {
  const [patDraft, setPatDraft] = useState("");
  const [owner, setOwner] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [publicConsent, setPublicConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [outbox, setOutbox] = useState<SyncOutboxItem | undefined>();
  const [writerLease, setWriterLease] = useState<WriterLeaseStatus | null>(null);
  const [leaseCheckError, setLeaseCheckError] = useState("");

  useEffect(() => {
    setOwner(book?.remote?.owner ?? "");
    setRepository(book?.remote?.repository ?? "");
    setBranch(book?.remote?.branch ?? "main");
    setInfo(null);
    setPublicConsent(false);
  }, [book?.id]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!book) { setOutbox(undefined); return; }
      void getOutbox(book.id).then(item => { if (active) setOutbox(item); });
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [book?.id, book?.updatedAt, book?.remote?.lastSyncedCommit]);

  useEffect(() => {
    let mounted = true;
    const checkLease = () => {
      if (!book?.remote || !settings.githubToken) {
        if (mounted) { setWriterLease(null); setLeaseCheckError(""); }
        return;
      }
      void inspectWriterLease(book.remote, book.id).then(value => {
        if (mounted) { setWriterLease(value); setLeaseCheckError(""); }
      }).catch(() => {
        if (mounted) setLeaseCheckError("Impossibile verificare il lock GitHub; non presumere che il libro sia libero.");
      });
    };
    checkLease();
    const timer = setInterval(checkLease, 20_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [book?.id, book?.remote?.branch, book?.remote?.repository, book?.remote?.owner, settings.githubToken]);

  async function recoverWriter() {
    return doWork(async () => {
      if (!book?.remote) throw new Error("Collega prima una repository GitHub.");
      if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      if (!writerLease || !isLeaseRecoverable(writerLease))
        throw new Error("Il lease non è ancora scaduto con il margine di sicurezza.");
      if (!window.confirm("Recuperare la scrittura su questo libro? Un altro dispositivo potrebbe avere la pagina sospesa. Il suo autopilot si arresterà quando ritrova la connessione. Procedere?"))
        return "Recupero annullato.";
      await recoverExpiredWriterLease(book.remote, book.id);
      setWriterLease(await inspectWriterLease(book.remote, book.id));
      return "Lease remoto recuperato e rilasciato. Ora puoi avviare l'autopilot da questo dispositivo.";
    });
  }

  function remote(): GitHubRemote {
    return validateRemote({ owner, repository, branch });
  }

  async function doWork(action: () => Promise<string>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try { setMessage(await action()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operazione GitHub non riuscita."); }
    finally { setBusy(false); }
  }

  async function savePat(): Promise<void> {
    return doWork(async () => {
      if (patDraft.trim().length < 20) throw new Error("Inserisci un PAT GitHub fine-grained valido.");
      const encrypted = await encryptLocal(patDraft.trim());
      await onSaveSettings({ ...settings, githubToken: encrypted });
      setPatDraft("");
      return "PAT salvato cifrato nel browser. Non è stato inviato al repository del libro.";
    });
  }

  async function removePat(): Promise<void> {
    return doWork(async () => {
      await onSaveSettings({ ...settings, githubToken: null });
      setPatDraft("");
      return "PAT locale cancellato dalle impostazioni. Il token GitHub non viene revocato automaticamente.";
    });
  }

  async function verify(): Promise<void> {
    return doWork(async () => {
      const target = remote();
      const result = await inspectRepository(target);
      setInfo(result);
      setPublicConsent(false);
      return result.private
        ? "Repository privata verificata. " + (result.canPush ? "Scrittura autorizzata." : "PAT senza permesso di scrittura.")
        : "ATTENZIONE: repository pubblica. Manoscritto e segreti saranno visibili a tutti.";
    });
  }

  async function connect(): Promise<void> {
    return doWork(async () => {
      if (!book) throw new Error("Seleziona prima un libro.");
      if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      const target = remote();
      const repo = await inspectRepository(target);
      setInfo(repo);
      if (!repo.private && !publicConsent)
        throw new Error("Devi confermare esplicitamente la pubblicazione su una repository pubblica.");
      if (!repo.canPush) throw new Error("Il PAT necessita di Contents: write su questa repository.");
      const existing = book.remote;
      if (existing?.lastSyncedCommit &&
          (existing.owner !== target.owner || existing.repository !== target.repository ||
           existing.branch !== target.branch))
        throw new Error("Il libro è già sincronizzato altrove. Effettua un backup e una migrazione esplicita.");
      const updated = await getBook(book.id);
      if (!updated) throw new Error("Libro non più presente nel browser.");
      updated.remote = { ...existing, ...target };
      await saveBook(updated);
      await onRefresh();
      return "Libro collegato a " + repo.fullName + " (" + target.branch + "). Salva un checkpoint con Sincronizza.";
    });
  }

  async function push(): Promise<void> {
    return doWork(async () => {
      if (!book) throw new Error("Nessun libro selezionato.");
      if (book.remote?.autoSync) throw new Error("Con autosync attivo, usa il controllo della coda invece della sincronizzazione manuale.");
      const result = await pushGitHubBook(book.id, publicConsent);
      const item = await getOutbox(book.id);
      if (item) await acknowledgeOutbox(book.id, item.operationId, result.sourceRevision);
      setOutbox(await getOutbox(book.id));
      await onRefresh();
      return "Sincronizzato " + result.repository +
        " · commit " + result.commit.slice(0, 12) + " · " + result.paths + " file. Nessun force push.";
    });
  }

  async function importRemote(): Promise<void> {
    return doWork(async () => {
      if (book?.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      const target = remote();
      const imported = await importGitHubBook(target);
      await onRefresh();
      onSelectBook(imported.id);
      return "Libro importato: " + imported.title +
        ". Controlla le chiavi e i modelli AI prima di riprendere la scrittura.";
    });
  }

  async function toggleAutoSync(enabled: boolean): Promise<void> {
    return doWork(async () => {
      if (!book?.remote) throw new Error("Collega prima il libro a GitHub.");
      if (enabled && book.editorialReviewSceneIds?.length)
        throw new Error("Conferma prima tutte le scene fuse nel Lettore, poi riattiva autosync.");
      if (enabled && (book.editorialCycle || book.chapters.some(ch =>
        !ch.frozenAt && ch.scenes.some(s => s.status !== "planned"))))
        throw new Error("Completa e congela tutti i capitoli in review prima di riattivare autosync.");
      if (enabled && !book.remote.lastSyncedCommit)
        throw new Error("Esegui prima una sincronizzazione manuale del libro.");
      if (enabled && !navigator.locks?.request)
        throw new Error("Questo browser non supporta Web Locks: autosync disabilitato per evitare scritture concorrenti tra schede.");
      let allowPublicSync = book.remote.allowPublicSync ?? false;
      if (enabled) {
        const inspected = await inspectRepository(book.remote);
        setInfo(inspected);
        if (!inspected.private && !allowPublicSync) {
          if (!publicConsent) throw new Error("Repository pubblica: verifica e autorizza esplicitamente la sincronizzazione automatica dei contenuti.");
          allowPublicSync = true;
        }
      }
      const current = await getBook(book.id);
      if (!current?.remote) throw new Error("Libro o repository non più disponibili.");
      current.remote = { ...current.remote, autoSync: enabled, allowPublicSync: enabled && allowPublicSync };
      await saveBook(current, enabled);
      await onRefresh();
      setOutbox(await getOutbox(book.id));
      if (enabled) void drainGitHubOutbox();
      return enabled ? "Autosync attivato: checkpoint principali in coda e tentativi mentre la pagina è aperta." :
        "Autosync disattivato. I dati locali e le richieste pendenti restano conservati.";
    });
  }
  async function retryNow(): Promise<void> {
    return doWork(async () => {
      if (!book) throw new Error("Libro non selezionato.");
      await retryBlockedSync(book.id);
      setOutbox(await getOutbox(book.id));
      void drainGitHubOutbox();
      return "Nuovo tentativo richiesto. Se il branch è cambiato, occorre prima risolvere il conflitto.";
    });
  }

  const connected = book?.remote;
  const dirty = !!connected && connected.lastSyncedLocalUpdatedAt !== book.updatedAt;

  return <section className="panel min-w-0 p-4 sm:p-5">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Github size={20}/> GitHub — sincronizzazione del libro</h2>
    <p className="muted mt-1 text-sm">Ogni libro usa una sua repository. Salvataggio Markdown leggibile + checkpoint JSON senza credenziali.</p>
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={16}/> PAT fine-grained</p>
        <p className="muted mb-3 text-xs">
          {settings.githubToken ? "Configurato nel browser." : "Non configurato."}
          {" "}Crea un PAT con permesso Contents read/write limitato alle repository dei libri. Non usare un token con accesso globale.
        </p>
        <InputField type="password" label={settings.githubToken ? "Sostituisci PAT" : "PAT GitHub"}
          placeholder="github_pat_..." value={patDraft} onChange={setPatDraft}/>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!patDraft.trim() || busy} onClick={() => void savePat()}>
            Salva PAT cifrato
          </Button>
          {settings.githubToken && <Button variant="destructive" disabled={busy} onClick={() => void removePat()}>
            Rimuovi PAT locale
          </Button>}
        </div>
        <p className="muted mt-2 text-xs">Questo token è protetto da Web Crypto nello stesso browser, non è E2EE contro script malevoli. Non viene incluso negli ZIP e non viene recuperato automaticamente su un nuovo dispositivo.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField label="Owner GitHub" value={owner} onChange={value => { setOwner(value); setInfo(null); setPublicConsent(false); }} placeholder="KeyserDSoze"/>
        <InputField label="Repository del libro" value={repository} onChange={value => { setRepository(value); setInfo(null); setPublicConsent(false); }} placeholder="romanzo-privato"/>
        <InputField label="Branch" value={branch} onChange={value => { setBranch(value); setInfo(null); setPublicConsent(false); }} placeholder="main"/>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!settings.githubToken || busy} onClick={() => void verify()}>
          <RefreshCw size={16}/> Verifica repository
        </Button>
        <Button variant="outline" disabled={!settings.githubToken || !book || busy} onClick={() => void connect()}>
          Collega questo libro
        </Button>
      </div>
      {info && <p className={"text-sm " + (info.private ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-300")}>
        {info.fullName} · {info.private ? "Privata" : "PUBBLICA"} · {info.canPush ? "Permessi di scrittura" : "Solo lettura"}
      </p>}
      {info && !info.private && <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={publicConsent} onChange={e => setPublicConsent(e.target.checked)} className="mt-1"/>
        Autorizzo esplicitamente la pubblicazione di libro, trame e segreti su GitHub.
      </label>}
      {connected && <div className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <p><b>Repository:</b> {connected.owner}/{connected.repository} · {connected.branch}</p>
        <p className="muted">Ultimo commit: {connected.lastSyncedCommit?.slice(0, 12) ?? "Mai sincronizzato"}</p>
        <p className="muted">Stato: {dirty ? "Modifiche locali da sincronizzare" : "Checkpoint locale sincronizzato"}</p>
      </div>}
      {connected && <div className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <p className="font-semibold">Scrittura protetta tra dispositivi</p>
        {!leaseCheckError && !writerLease && <p className="muted mt-2">Nessun lock remoto attivo. L'autopilot ne acquisisce uno prima di chiamare i modelli AI.</p>}
        {writerLease && <div className="mt-2 space-y-1">
          <p><b>Lease:</b> {writerLease.state === "released" ? "Rilasciato" :
            isLeaseRecoverable(writerLease) ? "Scaduto: recupero manuale possibile" :
            Date.parse(writerLease.expiresAt) <= Date.now() ? "Scaduto, in attesa del margine di sicurezza" : "Scrittura in uso"}</p>
          <p className="muted text-xs">Sessione: {writerLease.sessionId.slice(0, 8)} · Scadenza: {new Date(writerLease.expiresAt).toLocaleString("it-IT")}</p>
          {isLeaseRecoverable(writerLease) &&
            <Button variant="outline" size="sm" disabled={busy || book?.status === "running"} onClick={() => void recoverWriter()}>
              Recupera lease scaduto
            </Button>}
        </div>}
        {leaseCheckError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{leaseCheckError}</p>}
        <p className="muted mt-2 text-xs">Ogni attività AI richiede un lease GitHub valido per i libri collegati. Il lock viene rinnovato finché la pagina scrive, e liberato al termine. In assenza di rete l'autopilot si arresta. La verifica dell'orologio GitHub è approssimativa: rileva solo scarti molto grandi tramite la finestra X-RateLimit-Reset; il takeover resta manuale con margine di sicurezza.</p>
      </div>}
      {connected && <div className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <label className="flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-emerald-600"
            checked={!!connected.autoSync} disabled={busy || (!connected.autoSync && (!!book?.editorialReviewSceneIds?.length || !!book?.editorialCycle))}
            onChange={e => void toggleAutoSync(e.target.checked)}/>
          <span className="font-semibold">Sincronizzazione automatica ai checkpoint</span>
        </label>
        <p className="muted mt-2 text-xs">Opt-in: dopo il primo commit manuale, scrive automaticamente i checkpoint confermati. La scheda deve restare aperta. Un lease GitHub riduce le sessioni AI concorrenti, ma non sostituisce un coordinatore transazionale perfetto.</p>
        {outbox && <div role="status" className="mt-2 space-y-1 text-xs">
          <p><b>Coda:</b> {outbox.state === "blocked" ? "Bloccata" : outbox.state === "syncing" ? "Invio GitHub in corso" : "In attesa di GitHub"}</p>
          <p>Operazioni accumulate: {outbox.revision} · tentativi: {outbox.attempts}</p>
          {outbox.retryAfter && <p>Riprova dopo: {new Date(outbox.retryAfter).toLocaleString("it-IT")}</p>}
          {outbox.lastError && <p className="text-red-600 dark:text-red-300">{outbox.lastError}</p>}
          {outbox.state === "blocked" && connected.autoSync &&
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void retryNow()}>Riprova sincronizzazione</Button>}
        </div>}
        {!outbox && <p className="muted mt-2 text-xs">{dirty ? "Modifiche locali: nessuna operazione remota in esecuzione" : "Nessuna modifica in attesa"}</p>}
      </div>}
      {!!book?.editorialReviewSceneIds?.length && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
        {book.editorialReviewSceneIds.length} scene fuse attendono conferma nel Lettore: push e riattivazione autosync bloccati.
      </p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!settings.githubToken || !connected || !book || busy || book.status === "running" || !!connected.autoSync || !!book.editorialReviewSceneIds?.length || !!book.editorialCycle || book.chapters.some(ch => !ch.frozenAt && ch.scenes.some(s => s.status !== "planned"))}
          onClick={() => void push()}><Cloud size={17}/> Sincronizza su GitHub</Button>
        <Button variant="secondary" disabled={!settings.githubToken || busy} onClick={() => void importRemote()}>
          <Download size={17}/> Importa un libro remoto
        </Button>
      </div>
      {message && <p role="status" className="rounded-lg border border-amber-500/40 p-3 text-sm">{message}</p>}
      <p className="muted text-xs">
        Il salvataggio automatico usa una coda persistente e Web Locks tra schede dello stesso browser. I modelli AI sono protetti da un lease GitHub con heartbeat. La risoluzione automatica di capitoli divergenti resta disabilitata. Il lease tra dispositivi è conservativo; il confronto dei conflitti e le bozze richiedono conferma esplicita.
      </p>
    </div>
  </section>;
}
