import { useState } from "react";
import type { BookProject } from "../domain/types";
import { buildNarrativeEventCandidateIndex, type NarrativeEventCandidate } from "../domain/narrative-event-candidates";
import { currentNarrativeEventDecision, MAX_EVENT_DECISIONS, type NarrativeEventDecision }
  from "../domain/narrative-event-decisions";
import { recordNarrativeEventDecision } from "../application/narrative-event-decisions";
import { Button } from "./ui/button";

function eventKey(event: NarrativeEventCandidate): string {
  return [event.chapterId, event.sceneId, event.kind, event.offset].join(":");
}

export function NarrativeEventDecisionsPanel({book,onRefresh}: {
  book: BookProject; onRefresh: () => Promise<void>;
}) {
  const [notes,setNotes] = useState<Record<string,string>>({});
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const index = buildNarrativeEventCandidateIndex(book);
  const history = book.narrativeEventDecisions ?? [];

  async function decide(event: NarrativeEventCandidate, verdict: NarrativeEventDecision["verdict"]) {
    if (busy) return;
    const key = eventKey(event);
    const note = (notes[key] ?? "").trim();
    if (!window.confirm(
      "Archiviare questa interpretazione dell'autore? Non modifica il canone, i segreti, la timeline " +
      "o i possessi e non prova che l'evento sia vero. L'annotazione potrà essere esportata o " +
      "sincronizzata manualmente. L'autosync sarà disabilitato e la coda GitHub svuotata.",
    )) return;
    setBusy(true); setMessage(""); setError("");
    try {
      await recordNarrativeEventDecision(book.id,book.updatedAt,event,verdict,note);
      setNotes(old=>({...old,[key]:""}));
      await onRefresh();
      setMessage("Interpretazione registrata nello storico; il canone non è cambiato. Autosync disabilitato.");
    } catch (cause) {
      setError(cause instanceof Error?cause.message:"Registrazione non riuscita.");
    } finally { setBusy(false); }
  }

  if (!book.chapters.some(ch=>!!ch.frozenAt) && !history.length) return null;
  return <details className="mt-4 min-w-0 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">
      Indice eventi candidati ({index.events.length}) — prosa congelata e decisioni autore
    </summary>
    <p className="muted mt-2 text-xs">
      Schemi lessicali locali e fallibili: dialoghi, sogni e menzogne possono produrre falsi eventi.
      Le annotazioni dell'autore NON aggiornano automaticamente canone, segreti, timeline o oggetti.
      Scene analizzate: {index.scannedSceneCount}; non analizzate: {index.unscannedSceneCount}.
      {index.eventLimitReached && " Limite di 80 menzioni raggiunto."}
      {" "}Storico: {history.length}/{MAX_EVENT_DECISIONS}.
    </p>
    {message && <p role="status" className="mt-2 text-emerald-700 dark:text-emerald-300">{message}</p>}
    {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{error}</p>}
    <ul className="mt-2 space-y-2">
      {index.events.slice(0,30).map(event=>{
        const key = eventKey(event);
        const note = notes[key] ?? "";
        const current = currentNarrativeEventDecision(book,event);
        const disabled = busy || book.status === "running" ||
          (!!book.editorialCycle && book.editorialCycle.stage !== "blocked") ||
          history.length >= MAX_EVENT_DECISIONS ||
          note.trim().length < 12 || note.trim().length > 500;
        return <li key={key} className="min-w-0 rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          <p className="font-semibold">Cap. {event.chapterNumber} · scena {event.sceneNumber} · {event.kind}</p>
          <p className="mt-1 break-words">«{event.quote}»</p>
          <p className="muted mt-1 break-words">
            Testo letterale a offset {event.offset} · soggetto: {event.actor}
            {event.recipient ? " · destinatario: "+event.recipient : ""}
            {event.sceneDate ? " · data dichiarata: "+event.sceneDate : ""}
          </p>
          {current && <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-300">
            Interpretazione attuale: {current.verdict==="affirmed" ?
              "annotato come avvenuto" : "menzione respinta"} · {current.rationale}
          </p>}
          <label className="mt-2 block font-semibold">
            Motivazione dell'autore (12–500 caratteri)
            <textarea className="field mt-1 min-h-20" maxLength={500}
              aria-label={"Motivazione evento "+key} value={note}
              onChange={e=>setNotes(old=>({...old,[key]:e.target.value}))}/>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={disabled} onClick={()=>void decide(event,"affirmed")}>Annota come avvenuto</Button>
            <Button disabled={disabled} onClick={()=>void decide(event,"dismissed")}>Respingi menzione</Button>
          </div>
        </li>;
      })}
    </ul>
    {index.events.length > 30 && <p className="muted mt-2 text-xs">
      Mostrate solo le prime 30 menzioni. La selezione non equivale a una conferma.
    </p>}
    {history.length > 0 && <details className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">
        Storico decisioni autore ({history.length}) — incluse quelle superate
      </summary>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {[...history].reverse().map(d=>{
          const candidate = index.events.find(e=>e.chapterId===d.chapterId &&
            e.sceneId===d.sceneId && e.kind===d.kind && e.offset===d.offset &&
            e.quote===d.quote);
          const current = candidate && currentNarrativeEventDecision(book,candidate)?.id===d.id;
          return <li key={d.id} className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            <p className="font-semibold">{d.verdict==="affirmed"?"Annotato avvenuto":"Respinto"}
              {" "}· {d.decidedAt} · {current?"corrente":"storico/non corrente"}</p>
            <p className="break-words">«{d.quote}» · {d.chapterId}/{d.sceneId}, offset {d.offset}</p>
            <p className="break-words">{d.rationale}</p>
          </li>;
        })}
      </ul>
      <p className="muted mt-2 text-xs">
        I record importati non autenticano chi li abbia scritti. Una scena modificata, riaperta o non
        più indicizzata rende l'annotazione non corrente. Nessun giudizio viene cancellato automaticamente.
      </p>
    </details>}
  </details>;
}
