import { BookOpen, CloudDownload, PlayCircle, Plus, Settings2 } from "lucide-react";
import type { BookProject } from "../domain/types";
import type { CloudBookView, LibraryEntry } from "../domain/cloud-profile";
import { bookProgress } from "../domain/autopilot-step";
import { Button } from "./ui/button";

const STATUS: Record<BookProject["status"], string> = {
  idle: "Da avviare", running: "In esecuzione", paused: "In pausa",
  error: "Errore: intervento richiesto", completed: "Completato",
};

/** Books known to the cloud index of the author's account, as seen from this device. */
export interface CloudShelf {
  views: CloudBookView[];
  /** The cloud session is valid: removing an entry needs it; downloading from GitHub does not. */
  connected: boolean;
  busy: boolean;
  /** A GitHub PAT is stored on this device, needed to download or update a book. */
  hasPat: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString("it-IT");

function CloudBookCard({ view, shelf, onDownload, onPull, onForget }: {
  view: CloudBookView; shelf: CloudShelf;
  onDownload: (entry: LibraryEntry) => void; onPull: (bookId: string) => void; onForget: (bookId: string) => void;
}) {
  const { entry, kind } = view;
  const repo = entry.remote ? `${entry.remote.owner}/${entry.remote.repository} · ${entry.remote.branch}` : "";
  return <li className="panel min-w-0 space-y-2 p-4">
    <div className="flex items-start gap-2">
      <CloudDownload size={18} className="mt-0.5 shrink-0 text-sky-500" />
      <div className="min-w-0">
        <h3 className="break-words font-semibold">{entry.title}</h3>
        <p className="muted text-xs">{STATUS[entry.status]} · da «{entry.deviceName}»</p>
      </div>
    </div>
    <p className="muted text-xs">
      {entry.progress.scenes
        ? `${entry.progress.canonScenes}/${entry.progress.scenes} scene canoniche · ${entry.progress.frozenChapters}/${entry.progress.chapters} capitoli congelati`
        : "Piano non ancora creato"}
      {" · "}aggiornato {when(entry.bookUpdatedAt)}
    </p>
    {entry.status === "running" && <p className="muted text-xs">Segnato «in esecuzione» alle {new Date(entry.entryAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}: potrebbe non essere più vero.</p>}
    {repo && <p className="muted break-all text-xs">GitHub: {repo}</p>}
    {kind === "cloud_only" && <p className="text-xs">Non è su questo dispositivo: il testo si scarica da GitHub.</p>}
    {kind === "update_available" && <p className="text-xs">Un altro dispositivo ha sincronizzato una versione più recente.</p>}
    {kind === "unlinked" && <p className="text-xs">Il libro locale non è collegato a GitHub: collegalo in Archivio a {repo} per poterlo aggiornare.</p>}
    {kind === "no_repository" && <p className="text-xs">Questo libro non ha una repository GitHub collegata: non si può scaricare.</p>}
    {!shelf.hasPat && (kind === "cloud_only" || kind === "update_available") &&
      <p className="text-xs text-amber-700 dark:text-amber-300">Serve il PAT GitHub su questo dispositivo: applica il profilo cloud nelle Impostazioni.</p>}
    <div className="flex flex-wrap gap-2">
      {kind === "cloud_only" && <Button size="sm" disabled={!shelf.hasPat || shelf.busy} onClick={() => onDownload(entry)}
        aria-label={`Scarica da GitHub ${entry.title}`}>Scarica da GitHub</Button>}
      {kind === "update_available" && view.local && <Button size="sm" disabled={!shelf.hasPat || shelf.busy}
        onClick={() => onPull(entry.bookId)} aria-label={`Aggiorna da GitHub ${entry.title}`}>Aggiorna da GitHub</Button>}
      {(kind === "cloud_only" || kind === "no_repository") && <Button size="sm" variant="outline" disabled={!shelf.connected || shelf.busy}
        aria-label={`Rimuovi dall'elenco cloud ${entry.title}`}
        onClick={() => { if (window.confirm(`Rimuovere «${entry.title}» dall'elenco cloud? I dati su GitHub e sugli altri dispositivi non vengono toccati.`)) onForget(entry.bookId); }}>
        Rimuovi dall'elenco cloud</Button>}
    </div>
  </li>;
}

/** The author's shelf: every local book, the last one worked on highlighted. */
export function LibraryPage({ books, selectedId, lastOpenedId, onOpen, onOpenSettings, onNew, cloud, onDownload, onPull, onForget, onOpenCloud }: {
  books: BookProject[]; selectedId: string; lastOpenedId: string;
  onOpen: (id: string) => void; onOpenSettings: (id: string) => void; onNew: () => void;
  cloud?: CloudShelf; onDownload?: (entry: LibraryEntry) => void; onPull?: (bookId: string) => void;
  onForget?: (bookId: string) => void; onOpenCloud?: () => void;
}) {
  const last = books.find(b => b.id === lastOpenedId);
  const sorted = [...books].sort((a, b) =>
    (a.id === lastOpenedId ? -1 : b.id === lastOpenedId ? 1 : 0) ||
    b.updatedAt.localeCompare(a.updatedAt));
  const elsewhere = cloud?.views.filter(view => view.kind !== "in_sync" && view.kind !== "local_ahead") ?? [];
  const updates = new Set(elsewhere.filter(view => view.kind === "update_available").map(view => view.entry.bookId));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">I tuoi libri</h2>
        <p className="muted text-sm">Scegli il libro su cui lavorare. I libri sono salvati su questo dispositivo{cloud ? " e, per il testo, su GitHub" : ""}.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {last && <Button onClick={() => onOpen(last.id)} aria-label={`Riprendi l'ultimo libro: ${last.title}`}>
          <PlayCircle size={17} /> Riprendi l'ultimo: {last.title}</Button>}
        <Button variant="outline" onClick={onNew}><Plus size={16} /> Nuovo libro</Button>
      </div>
    </div>
    {books.length === 0
      ? <p className="muted rounded-lg border border-dashed border-slate-400 p-5 text-sm dark:border-slate-600">
        Nessun libro: creane uno per iniziare{cloud && elsewhere.length ? ", oppure scarica uno dei libri degli altri tuoi dispositivi qui sotto" : ""}.</p>
      : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Elenco dei libri">
        {sorted.map(book => {
          const progress = bookProgress(book);
          return <li key={book.id} className="panel min-w-0 space-y-2 p-4">
            <div className="flex items-start gap-2">
              <BookOpen size={18} className="mt-0.5 shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{book.title}</h3>
                <p className="muted text-xs">
                  {STATUS[book.status]}{book.id === lastOpenedId && " · ultimo aperto"}
                  {book.id === selectedId && " · aperto ora"}
                  {updates.has(book.id) && " · aggiornamento disponibile da un altro dispositivo"}
                </p>
              </div>
            </div>
            <p className="muted text-xs">
              {progress.scenes
                ? `${progress.canonScenes}/${progress.scenes} scene canoniche · ${progress.frozenChapters}/${progress.chapters} capitoli congelati`
                : "Piano non ancora creato"}
              {" · "}aggiornato {new Date(book.updatedAt).toLocaleString("it-IT")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onOpen(book.id)} aria-label={`Apri ${book.title}`}>Apri</Button>
              <Button size="sm" variant="outline" onClick={() => onOpenSettings(book.id)}
                aria-label={`Modelli e redazione di ${book.title}`}><Settings2 size={15} /> Modelli e redazione</Button>
            </div>
          </li>;
        })}
      </ul>}
    {cloud && onDownload && onPull && onForget && <section aria-label="Libri dagli altri dispositivi" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Dagli altri tuoi dispositivi</h2>
        <p className="muted text-sm">
          Elenco letto dal tuo account cloud{cloud.connected ? "" : " (ultima lettura: il cloud non è connesso)"}.
          Contiene titolo, stato e repository: il testo si scarica da GitHub.{" "}
          {onOpenCloud && <button type="button" className="underline" onClick={onOpenCloud}>Gestisci l'account cloud</button>}
        </p>
      </div>
      {elsewhere.length === 0
        ? <p className="muted rounded-lg border border-dashed border-slate-400 p-4 text-sm dark:border-slate-600">
          Nessun altro libro nel cloud, o tutti i libri sono già aggiornati su questo dispositivo.</p>
        : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Libri degli altri dispositivi">
          {elsewhere.map(view => <CloudBookCard key={view.entry.bookId} view={view} shelf={cloud}
            onDownload={onDownload} onPull={onPull} onForget={onForget} />)}
        </ul>}
    </section>}
  </div>;
}
