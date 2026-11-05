import { useEffect, useState } from "react";
import { Cloud, Download, Github, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import type { AppSettings, BookProject, GitHubRemote } from "../domain/types";
import { encryptLocal } from "../infrastructure/crypto";
import { getBook, saveBook } from "../infrastructure/db";
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

  useEffect(() => {
    setOwner(book?.remote?.owner ?? "");
    setRepository(book?.remote?.repository ?? "");
    setBranch(book?.remote?.branch ?? "main");
    setInfo(null);
    setPublicConsent(false);
  }, [book?.id]);

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
      const result = await pushGitHubBook(book.id, publicConsent);
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
      <div className="flex flex-wrap gap-2">
        <Button disabled={!settings.githubToken || !connected || !book || busy || book.status === "running"}
          onClick={() => void push()}><Cloud size={17}/> Sincronizza su GitHub</Button>
        <Button variant="secondary" disabled={!settings.githubToken || busy} onClick={() => void importRemote()}>
          <Download size={17}/> Importa un libro remoto
        </Button>
      </div>
      {message && <p role="status" className="rounded-lg border border-amber-500/40 p-3 text-sm">{message}</p>}
      <p className="muted text-xs">
        Sincronizzazione manuale in questo rilascio. Se il branch cambia su un altro dispositivo, BookWriter blocca il commit per proteggere le modifiche remote.
        Per automatizzare servono lease multi-dispositivo e outbox, ancora da realizzare.
      </p>
    </div>
  </section>;
}
