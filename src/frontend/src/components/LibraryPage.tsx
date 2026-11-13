import { BookOpen, PlayCircle, Plus, Settings2 } from "lucide-react";
import type { BookProject } from "../domain/types";
import { bookProgress } from "../domain/autopilot-step";
import { Button } from "./ui/button";

const STATUS: Record<BookProject["status"], string> = {
  idle: "Da avviare", running: "In esecuzione", paused: "In pausa",
  error: "Errore: intervento richiesto", completed: "Completato",
};

/** The author's shelf: every local book, the last one worked on highlighted. */
export function LibraryPage({ books, selectedId, lastOpenedId, onOpen, onOpenSettings, onNew }: {
  books: BookProject[]; selectedId: string; lastOpenedId: string;
  onOpen: (id: string) => void; onOpenSettings: (id: string) => void; onNew: () => void;
}) {
  const last = books.find(b => b.id === lastOpenedId);
  const sorted = [...books].sort((a, b) =>
    (a.id === lastOpenedId ? -1 : b.id === lastOpenedId ? 1 : 0) ||
    b.updatedAt.localeCompare(a.updatedAt));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">I tuoi libri</h2>
        <p className="muted text-sm">Scegli il libro su cui lavorare. I libri sono salvati su questo dispositivo.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {last && <Button onClick={() => onOpen(last.id)} aria-label={`Riprendi l'ultimo libro: ${last.title}`}>
          <PlayCircle size={17} /> Riprendi l'ultimo: {last.title}</Button>}
        <Button variant="outline" onClick={onNew}><Plus size={16} /> Nuovo libro</Button>
      </div>
    </div>
    {books.length === 0
      ? <p className="muted rounded-lg border border-dashed border-slate-400 p-5 text-sm dark:border-slate-600">
        Nessun libro: creane uno per iniziare.</p>
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
  </div>;
}
