import {useState} from "react";
import type {BookProject} from "../domain/types";
import {buildNarrativeEventLedger} from "../domain/narrative-event-ledger";
import {buildNarrativeKnowledgeRegistry,MAX_KNOWLEDGE_DECISIONS,
  type NarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {recordNarrativeKnowledgeDecision}
  from "../application/narrative-knowledge-decisions";
import {Button} from "./ui/button";

const VERDICT_LABELS:Record<NarrativeKnowledgeDecision["verdict"],string>={
  learned_directly:"Appresa direttamente",
  reported_by_other:"Riferita da altri",
  still_secret:"Non conosciuta / ancora segreta",
};

/** Private, author-only ledger. No inference or automatic disclosure to agents. */
export function NarrativeKnowledgeDecisionsPanel({book,onRefresh}:{
  book:BookProject;onRefresh:()=>Promise<void>;
}){
  const [sourceId,setSourceId]=useState("");
  const [rationale,setRationale]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const sources=buildNarrativeEventLedger(book).currentAffirmed
    .filter(entry=>entry.candidate.kind==="knowledge_mention");
  const source=sources.find(x=>x.decision.id===sourceId)??sources[0];
  const history=book.narrativeKnowledgeDecisions??[];
  const registry=buildNarrativeKnowledgeRegistry(book);
  const currentIds=new Set(registry.current.map(x=>x.decision.id));
  if(!sources.length && !history.length)return null;

  async function save(verdict:NarrativeKnowledgeDecision["verdict"]){
    if(busy || !source)return;
    const note=rationale.trim();
    if(!window.confirm(
      "Registrare questa interpretazione motivata sul sapere del personaggio? " +
      "Non è una certificazione e NON aggiorna canone, segreti, timeline o prosa. " +
      "Resta privata dai prompt AI in questa versione; sarà comunque inclusa nei backup " +
      "e nelle eventuali sincronizzazioni MANUALI (anche verso repository pubblici). " +
      "L'autosync verrà disabilitato e la coda GitHub svuotata."))return;
    setBusy(true);setMessage("");setError("");
    try{
      await recordNarrativeKnowledgeDecision(book.id,book.updatedAt,
        source.decision.id,verdict,note);
      setRationale("");
      await onRefresh();
      setMessage("Interpretazione delle conoscenze registrata. Canone invariato, autosync disabilitato.");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Conoscenza non registrata.");
    }finally{setBusy(false);}
  }
  const disabled=busy || book.status==="running" ||
    (!!book.editorialCycle && book.editorialCycle.stage!=="blocked") ||
    !source || history.length>=MAX_KNOWLEDGE_DECISIONS ||
    rationale.trim().length<12 || rationale.trim().length>500;
  return <details aria-label="Registro conoscenze autore"
    className="mt-3 min-w-0 rounded border border-slate-300 p-2 dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">
      Conoscenze interpretate dall'autore ({registry.current.length} correnti)
    </summary>
    <p className="muted mt-2 text-xs">
      Solo menzioni di conoscenza già confermate esplicitamente dall'autore e ancora
      ancorate a scene canoniche congelate. «Diretta», «riferita» e «segreta» sono
      interpretazioni editoriali, NON fatti verificati, identità certificate o un
      grafo completo di ciò che ogni personaggio sa. Nessuna informazione passa
      automaticamente agli agenti AI; i segreti canonici non vengono modificati.
      {" "}Storico: {history.length}/{MAX_KNOWLEDGE_DECISIONS}.
    </p>
    {message && <p role="status" className="mt-2 text-emerald-700 dark:text-emerald-300">{message}</p>}
    {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{error}</p>}
    {sources.length>0 ? <fieldset className="mt-2 min-w-0 rounded border border-slate-200 p-2 dark:border-slate-700">
      <legend className="font-semibold text-xs">Interpretazione autore della menzione</legend>
      <label className="mt-1 block text-xs font-semibold">
        Menzione di conoscenza attestata
        <select className="field mt-1" aria-label="Menzione di conoscenza attestata"
          value={source?.decision.id??""} onChange={e=>setSourceId(e.target.value)}>
          {sources.map(({decision,candidate})=>
            <option key={decision.id} value={decision.id}>
              Cap. {candidate.chapterNumber}, scena {candidate.sceneNumber} — {candidate.actor}: {candidate.quote}
            </option>)}
        </select>
      </label>
      {source && <p className="mt-2 break-words text-xs">
        <b>Prova testuale:</b> «{source.decision.quote}» · offset {source.decision.offset}
        {" "}· personaggio: {source.candidate.actor}
      </p>}
      <label className="mt-2 block text-xs font-semibold">
        Motivazione della conoscenza (12–500 caratteri)
        <textarea className="field mt-1 min-h-20" maxLength={500}
          aria-label="Motivazione conoscenza autore" value={rationale}
          onChange={e=>setRationale(e.target.value)}/>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={()=>void save("learned_directly")}>Appresa direttamente</Button>
        <Button disabled={disabled} onClick={()=>void save("reported_by_other")}>Riferita da altri</Button>
        <Button disabled={disabled} onClick={()=>void save("still_secret")}>Ancora segreta per il personaggio</Button>
      </div>
      <p className="muted mt-2 text-xs">
        Una nuova decisione rettifica la precedente senza cancellarla.
        Se la fonte viene modificata, riaperta o riattestata, la classificazione
        diventa storica. Il backup ZIP include anche le motivazioni private.
      </p>
    </fieldset> : <p className="muted mt-2 text-xs">
      Nessuna attestazione di conoscenza corrente: lo storico rimane consultabile.
    </p>}
    {registry.current.length>0 && <ul aria-label="Conoscenze correnti dell'autore"
      className="mt-2 max-h-64 space-y-2 overflow-y-auto">
      {registry.current.map(({decision,source:entry})=><li key={decision.id}
        className="min-w-0 rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
        <p className="font-semibold">{entry.candidate.actor} · {
          VERDICT_LABELS[decision.verdict]} · cap. {entry.candidate.chapterNumber},
          scena {entry.candidate.sceneNumber}</p>
        <p className="break-words">«{entry.decision.quote}» · offset {entry.decision.offset}</p>
        <p className="break-words">Motivazione dell'autore: {decision.rationale}</p>
      </li>)}
    </ul>}
    {history.length>0 && <details aria-label="Storico interpretazioni conoscenze"
      className="mt-2 rounded border border-slate-200 p-2 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">
        Storico interpretazioni conoscenze ({history.length}) — rettifiche incluse
      </summary>
      <p className="muted mt-2 text-xs">
        Decisioni non correnti: {registry.nonCurrentCount}.
        Nessun record importato autentica l'autore e nessuna interpretazione
        superata torna automaticamente valida.
      </p>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {[...history].reverse().map(d=><li key={d.id}
          className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          <p className="font-semibold">{d.actorName} · {VERDICT_LABELS[d.verdict]}
            {" "}· {currentIds.has(d.id)?"corrente":"storica/non corrente"} · {d.decidedAt}</p>
          <p className="break-words">Attestazione fonte: {d.sourceEventDecisionId}</p>
          <p className="break-words">{d.rationale}</p>
        </li>)}
      </ul>
    </details>}
  </details>;
}
