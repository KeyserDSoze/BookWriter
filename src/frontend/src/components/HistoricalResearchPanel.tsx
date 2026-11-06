import { useState } from "react";
import { BookOpenCheck, ExternalLink, Lightbulb, SearchCheck, ShieldAlert } from "lucide-react";
import type { BookProject, Chapter } from "../domain/types";
import { activeHistoricalSources, normalizeResearchQueries } from "../domain/historical-research";
import { proposeHistoricalQueriesLocally } from "../domain/historical-query-proposals";
import { researchHistoricalChapter } from "../application/historical-research";
import { Button } from "./ui/button";

export function HistoricalResearchPanel({
  book, chapter, onRefresh,
}: { book: BookProject; chapter: Chapter; onRefresh: () => Promise<void> }) {
  const [queries, setQueries] = useState((chapter.historicalDossier?.queries ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dossier = chapter.historicalDossier;
  const sources = activeHistoricalSources(dossier);
  const locked = busy || book.status === "running" || !!book.editorialCycle;
  const draftQueries = queries.split("\n").map(s => s.trim()).filter(Boolean);

  function proposeLocally() {
    // No provider call, no browser storage, no query generation by an AI.
    setProposals(proposeHistoricalQueriesLocally(chapter.scenes));
    setError("");
    setMessage("");
  }
  function stageProposal(proposal: string) {
    if (locked) return;
    setQueries(current => {
      const draft = current.split("\n").map(s => s.trim()).filter(Boolean);
      if (draft.length >= 5 ||
          draft.some(s => s.toLocaleLowerCase("it") === proposal.toLocaleLowerCase("it")))
        return current;
      return [...draft, proposal].join("\n");
    });
  }

  async function research() {
    setError(""); setMessage("");
    let approved: string[];
    try { approved = normalizeResearchQueries(queries.split("\n").filter(x => x.trim())); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ricerche non valide."); return;
    }
    const warning = [
      "CONSENSO ALLA RICERCA ESTERNA",
      "Invieremo SOLO queste frasi di ricerca a it.wikipedia.org:",
      ...approved.map(x => "• " + x),
      "",
      "BookWriter non aggiunge automaticamente testo, segreti o credenziali. Ogni parola delle query qui sopra sarà però trasmessa: se contiene indizi inediti o dati privati, annulla.",
      "Wikipedia è una fonte terziaria: gli estratti sono indizi da controllare, non fatti certificati.",
      "La ricerca disattiva autosync; se il capitolo era congelato, riapre la redazione e invalida i successivi.",
      "",
      "Vuoi procedere?",
    ].join("\n");
    if (!window.confirm(warning)) return;
    setBusy(true);
    try {
      const result = await researchHistoricalChapter(book.id, chapter.id, book.updatedAt, approved);
      setMessage(result.sourceCount + " fonti consultate. " +
        (result.missingQueries.length ? result.missingQueries.length + " query senza riscontri. " : "") +
        (result.restartedReview
          ? "Il capitolo e i successivi devono superare di nuovo la redazione."
          : "Le fonti sono disponibili al revisore storico del prossimo ciclo."));
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ricerca storica non disponibile.");
    } finally { setBusy(false); }
  }

  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <BookOpenCheck size={16}/> Dossier storico · {sources.length} fonti attive
    </summary>
    <div className="mt-3 space-y-3">
      <p className="muted text-xs">
        Cerca prima di iniziare la review. Scrivi solo argomenti storici PUBBLICI:
        una frase per riga, massimo cinque. Il browser non invia automaticamente
        contenuto delle scene, segreti, timeline privata o credenziali a Wikipedia.
      </p>
      <div className="space-y-2 rounded-md border border-slate-300 p-2 text-xs dark:border-slate-700">
        <p className="font-semibold">Proposte locali dal capitolo (non inviate)</p>
        <p className="muted">
          Il browser riconosce soltanto alcuni temi storici pubblici predefiniti e anni
          scritti vicino al tema. Non copia frasi, nomi o segreti del romanzo.
          Il risultato non certifica un fatto e può essere incompleto. Controlla
          ogni proposta prima di inserirla nella bozza e prima del consenso alla ricerca.
        </p>
        <Button size="sm" variant="outline" disabled={locked || !chapter.scenes.length}
          onClick={proposeLocally}><Lightbulb size={16}/>
          Genera proposte locali
        </Button>
        {proposals !== null && <div aria-live="polite" className="space-y-2">
          {proposals.length ? <div aria-label="Proposte di ricerca solo locali" className="space-y-2">
            {proposals.map(proposal => {
              const staged = draftQueries.some(s => s.toLocaleLowerCase("it") ===
                proposal.toLocaleLowerCase("it"));
              return <div key={proposal} className="flex flex-wrap items-center gap-2
                rounded border border-slate-200 p-2 dark:border-slate-700">
                <span className="min-w-0 flex-1 break-words">{proposal}</span>
                <Button size="sm" variant="outline"
                  aria-label={"Aggiungi alla bozza: " + proposal}
                  disabled={locked || staged || draftQueries.length >= 5}
                  onClick={() => stageProposal(proposal)}>
                  {staged ? "Nella bozza" : "Aggiungi alla bozza"}
                </Button>
              </div>;
            })}
          </div> : <p className="muted">
            Nessun tema tra quelli riconosciuti. Inserisci manualmente un argomento pubblico.
          </p>}
          <p className="muted">
            Finché non premi «Cerca fonti pubbliche» e confermi, nessuna proposta
            viene inviata a Wikipedia né salvata nel dossier.
          </p>
        </div>}
      </div>
      <label className="block text-xs font-semibold">
        Argomenti storici autorizzati dall'autore
        <textarea aria-label={"Ricerche storiche capitolo " + chapter.number}
          className="field mt-1 min-h-24" value={queries}
          onChange={e => setQueries(e.target.value)}
          disabled={locked} placeholder={"Trasporti ferroviari in Italia 1848\nIlluminazione domestica 1848"}/>
      </label>
      <Button size="sm" variant="outline" disabled={locked || !queries.trim()}
        onClick={() => void research()}><SearchCheck size={16}/>
        {busy ? "Ricerca..." : "Cerca fonti pubbliche"}
      </Button>
      {book.editorialCycle && <p className="muted text-xs">
        La redazione è in corso: termina questo ciclo prima di sostituire le fonti.
      </p>}
      {chapter.frozenAt && <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/>
        Aggiornare le fonti riaprirà questo capitolo e quelli successivi.
      </p>}
      {dossier && <div className="space-y-2 text-xs">
        <p className="font-semibold">
          Consultazione {new Date(dossier.searchedAt).toLocaleString("it-IT")} · {sources.length} estratti
        </p>
        {!!dossier.unansweredQueries.length && <p className="text-amber-700 dark:text-amber-300">
          Nessun risultato per: {dossier.unansweredQueries.join("; ")}
        </p>}
        {sources.length ? sources.map(source => <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700" key={source.id}>
          <a className="inline-flex items-start gap-1 break-all font-semibold text-blue-700 underline dark:text-blue-300"
            href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title} <ExternalLink size={13} className="shrink-0"/>
          </a>
          <p className="muted">Wikipedia italiana · revisione {source.revisionId ?? "non dichiarata"} · ricerca «{source.query}»</p>
          {source.revisionId && <a className="inline-block text-blue-700 underline dark:text-blue-300"
            href={"https://it.wikipedia.org/w/index.php?oldid=" + source.revisionId}
            target="_blank" rel="noopener noreferrer">Apri la revisione citata</a>}
          <p className="mt-2 whitespace-pre-wrap">{source.excerpt}</p>
          <p className="muted mt-1">Testo Wikipedia · attribuzione all'articolo e ai suoi autori (CC BY-SA).</p>
        </div>) : <p className="muted">La ricerca non ha trovato estratti utilizzabili. Non è stata verificata alcuna affermazione.</p>}
      </div>}
      <p className="muted text-xs">
        Le ricerche restano nel dossier locale e negli snapshot del libro. Se sincronizzi su una
        repository pubblica, anche le query e le fonti saranno pubbliche.
        Gli estratti e Wikipedia non certificano l'accuratezza storica: verifica le fonti primarie quando necessario.
      </p>
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </div>
  </details>;
}
