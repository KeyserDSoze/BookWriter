import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { NewBookOptions } from "../domain/types";
import { MAX_TARGET_CHAPTERS, parseChapterSynopses, parseTargetChapterCount } from "../domain/book-start";
import { Button } from "./ui/button";

export interface NewBookDraft {
  title: string;
  brief: string;
  writingStyle: string;
  audience: string;
  options: NewBookOptions;
}

/** Two ways to start: a minimal idea, or a binding chapter-by-chapter synopsis. */
export function NewBookPanel({ onCreate }: { onCreate: (draft: NewBookDraft) => Promise<boolean> }) {
  const [mode, setMode] = useState<"idea" | "synopsis">("idea");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [chapters, setChapters] = useState("");
  const [writingStyle, setWritingStyle] = useState("Narrativa immersiva, concreta, coerente; niente cliché.");
  const [audience, setAudience] = useState("Lettori adulti");
  const [pauseAfterOutline, setPauseAfterOutline] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => mode === "synopsis" ? parseChapterSynopses(synopsis) : null, [mode, synopsis]);
  const target = parseTargetChapterCount(chapters);

  async function create() {
    setError("");
    let options: NewBookOptions;
    let fullBrief = brief.trim();
    if (mode === "synopsis") {
      if (!parsed || parsed.problems.length || !parsed.chapters.length) {
        setError(parsed?.problems[0] ?? "Scrivi la sinossi: almeno un capitolo.");
        return;
      }
      // Notes written before the first chapter belong to the general description.
      if (parsed.preamble) fullBrief = [fullBrief, parsed.preamble].filter(Boolean).join("\n\n");
      options = { startMode: "synopsis", authorChapterSynopses: parsed.chapters, pauseAfterOutline };
    } else {
      if (!title.trim() && !fullBrief) { setError("Inserisci almeno un titolo o una breve descrizione del libro."); return; }
      if (target === "invalid") { setError(`Numero di capitoli non valido: usa un intero da 1 a ${MAX_TARGET_CHAPTERS} oppure lascialo vuoto.`); return; }
      options = { startMode: "idea", targetChapterCount: target, pauseAfterOutline };
    }
    setBusy(true);
    try {
      const created = await onCreate({ title, brief: fullBrief, writingStyle, audience, options });
      if (created) { setTitle(""); setBrief(""); setSynopsis(""); setChapters(""); }
    } finally { setBusy(false); }
  }

  return <section aria-label="Nuovo libro" className="panel min-w-0 p-4 sm:p-5">
    <h2 className="text-lg font-semibold">Nuovo libro</h2>
    <p className="muted mt-1 text-sm">L'autopilot scrive il libro da solo, un task alla volta: ideazione, piano, scrittura delle
      scene e redazione di ogni capitolo. Puoi fermarlo e intervenire in qualsiasi momento.</p>
    <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-semibold">Come vuoi partire?</legend>
      {([
        ["idea", "Da un'idea", "Anche solo un titolo e una frase: l'AI costruisce premessa, personaggi e trama."],
        ["synopsis", "Da una sinossi capitolo per capitolo", "Decidi tu cosa succede in ogni capitolo: l'AI la rispetta e sviluppa le scene."],
      ] as const).map(([value, label, help]) => <label key={value} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${mode === value
        ? "border-emerald-500 bg-emerald-500/5" : "border-slate-300 dark:border-slate-700"}`}>
        <input type="radio" name="book-start-mode" className="mt-1 size-4 shrink-0" checked={mode === value}
          onChange={() => { setMode(value); setError(""); }}/>
        <span><span className="block font-semibold">{label}</span><span className="muted block text-xs">{help}</span></span>
      </label>)}
    </fieldset>
    <div className="mt-4 space-y-4">
      <label className="block min-w-0"><span className="mb-1 block text-sm font-semibold">Titolo provvisorio</span>
        <input className="field" value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label className="block min-w-0"><span className="mb-1 block text-sm font-semibold">Descrizione iniziale, spunti e vincoli</span>
        <textarea className="field min-h-32" rows={mode === "idea" ? 6 : 3} value={brief} onChange={e => setBrief(e.target.value)}
          placeholder={mode === "idea"
            ? "Anche poche righe: genere, ambientazione, protagonisti, tono, idee, segreti e vincoli. Più dettagli dai, più l'AI li rispetterà."
            : "Facoltativa: tono, temi, personaggi, segreti e vincoli generali."}/></label>
      {mode === "synopsis" && <div>
        <label className="block min-w-0"><span className="mb-1 block text-sm font-semibold">Sinossi capitolo per capitolo</span>
          <textarea className="field min-h-48 font-mono text-sm" rows={10} value={synopsis} onChange={e => setSynopsis(e.target.value)}
            placeholder={"Capitolo 1: L'arrivo\nMara arriva al porto e trova una lettera senza firma.\n\nCapitolo 2: La lettera\nScopre che il padre, creduto morto, è vivo…"}/></label>
        <p className="muted mt-1 text-xs">Usa «Capitolo 1: Titolo» (anche Cap. II, # Titolo), un elenco numerato «1. …» oppure un
          paragrafo per capitolo separato da una riga vuota. Il numero e l'ordine dei capitoli saranno vincolanti.</p>
        {parsed && synopsis.trim() && <section className="mt-2 rounded-lg border border-slate-400/40 p-3 text-sm" aria-label="Anteprima capitoli rilevati"
          aria-live="polite">
          <p className="font-semibold">{parsed.chapters.length === 1 ? "Rilevato 1 capitolo" : `Rilevati ${parsed.chapters.length} capitoli`}</p>
          {parsed.preamble && <p className="muted mt-1 text-xs">Il testo prima del primo capitolo sarà aggiunto alla descrizione.</p>}
          <ol className="mt-2 max-h-56 list-decimal space-y-1 overflow-y-auto pl-6 text-xs">
            {parsed.chapters.map((chapter, index) => <li key={index} className="break-words">
              {chapter.title && <b>{chapter.title}: </b>}{chapter.synopsis.length > 160 ? chapter.synopsis.slice(0, 157) + "…" : chapter.synopsis}
            </li>)}
          </ol>
          {parsed.problems.map(problem => <p key={problem} className="mt-1 text-xs text-red-700 dark:text-red-300">{problem}</p>)}
        </section>}
      </div>}
      {mode === "idea" && <label className="block min-w-0 sm:max-w-xs"><span className="mb-1 block text-sm font-semibold">Numero di capitoli (facoltativo)</span>
        <input className="field" inputMode="numeric" value={chapters} onChange={e => setChapters(e.target.value)} placeholder="Decide l'AI"/></label>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block min-w-0"><span className="mb-1 block text-sm font-semibold">Stile</span>
          <textarea className="field" rows={2} value={writingStyle} onChange={e => setWritingStyle(e.target.value)}/></label>
        <label className="block min-w-0"><span className="mb-1 block text-sm font-semibold">Audience</span>
          <input className="field" value={audience} onChange={e => setAudience(e.target.value)}/></label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 size-4 shrink-0" checked={pauseAfterOutline} onChange={e => setPauseAfterOutline(e.target.checked)}/>
        <span>Fermati dopo il piano dei capitoli: lo rileggo e lo approvo (o lo faccio rifare) prima che inizi la scrittura.</span>
      </label>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <Button disabled={busy} onClick={() => void create()}><Plus size={18}/> Crea libro</Button>
    </div>
  </section>;
}
