import {useState} from "react";
import type {BookProject} from "../domain/types";
import {buildNarrativeKnowledgeRegistry}
  from "../domain/narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTimingRegistry,MAX_KNOWLEDGE_TIMING_DECISIONS,
  type KnowledgeAccessMoment,type NarrativeTemporalOrder}
  from "../domain/narrative-knowledge-timing";
import {recordNarrativeKnowledgeTimingDecision}
  from "../application/narrative-knowledge-timing";
import {Button} from "./ui/button";

const MOMENT_LABELS:Record<KnowledgeAccessMoment,string>={
  acquired_in_scene:"Appresa in questa scena",
  known_before_scene:"Già nota prima della scena",
  not_yet_known:"Non ancora nota nella scena",
  uncertain:"Momento non determinabile",
};
const ORDER_LABELS:Record<NarrativeTemporalOrder,string>={
  chronological:"Sequenza della storia considerata cronologica",
  flashback_or_reordered:"Flashback o ordine narrativo riorganizzato",
  undetermined:"Ordine nella storia non determinato",
};

/** Private author annotations, strictly distinct from AI consent and canon. */
export function NarrativeKnowledgeTimingPanel({book,onRefresh}:{
  book:BookProject;onRefresh:()=>Promise<void>;
}){
  const registry=buildNarrativeKnowledgeRegistry(book);
  const timeline=buildNarrativeKnowledgeTimingRegistry(book);
  const [knowledgeId,setKnowledgeId]=useState("");
  const [moment,setMoment]=useState<KnowledgeAccessMoment>("uncertain");
  const [order,setOrder]=useState<NarrativeTemporalOrder>("undetermined");
  const [rationale,setRationale]=useState("");
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const current=registry.current.find(x=>x.decision.id===knowledgeId) ??
    registry.current[0];
  if(!registry.current.length && !(book.narrativeKnowledgeTimingDecisions?.length))return null;
  const count=(book.narrativeKnowledgeTimingDecisions??[]).length;
  const blocked=saving||book.status==="running"||
    (!!book.editorialCycle && book.editorialCycle.stage!=="blocked")||
    !current||count>=MAX_KNOWLEDGE_TIMING_DECISIONS||
    rationale.trim().length<20||rationale.trim().length>650||
    (current.decision.verdict==="still_secret"
      ? !["not_yet_known","uncertain"].includes(moment)
      : moment==="not_yet_known");
  async function save(){
    if(blocked||!current)return;
    if(!window.confirm(
      "Registrare il momento narrativo secondo la tua interpretazione? " +
      "La posizione nel manoscritto NON dimostra l'ordine nella storia. " +
      "Questa nota privata NON verrà inviata ai modelli AI, neppure ai ruoli " +
      "già autorizzati a leggere la conoscenza: richiederà un futuro consenso " +
      "separato. Nessun canone o segreto sarà modificato. Il backup ZIP e un push " +
      "GitHub manuale possono contenere le note. L'autosync sarà disabilitato."))return;
    setSaving(true);setMessage("");setError("");
    try{
      await recordNarrativeKnowledgeTimingDecision(book.id,book.updatedAt,
        current.decision.id,moment,order,rationale.trim());
      setRationale("");
      await onRefresh();
      setMessage("Momento della conoscenza registrato. Canone e consensi AI invariati.");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Momento non registrato.");
    }finally{setSaving(false);}
  }
  return <details aria-label="Timeline conoscenze autore"
    className="mt-3 min-w-0 rounded border border-slate-300 p-2 dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">
      Quando i personaggi sanno? ({timeline.current.length} posizioni correnti)
    </summary>
    <p className="muted mt-2 text-xs">
      Ordine delle scene nel manoscritto, NON timeline certificata degli eventi.
      Nessun rapporto causale o passaggio di notizie fra personaggi viene inferito.
      Il giudizio temporale è privato e NON entra nei prompt AI anche se hai
      già autorizzato la condivisione della conoscenza. Storico: {count}/{
        MAX_KNOWLEDGE_TIMING_DECISIONS}.
    </p>
    {message&&<p role="status" className="mt-2 text-xs text-emerald-700">{message}</p>}
    {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {current&&<fieldset aria-label="Annotazione temporale conoscenza"
      className="mt-2 rounded border border-slate-200 p-2 dark:border-slate-700">
      <legend className="text-xs font-semibold">Interpretazione temporale dell'autore</legend>
      <label className="mt-2 block text-xs font-semibold">
        Conoscenza attestata e interpretata
        <select className="field mt-1" aria-label="Conoscenza da collocare nel tempo"
          value={current.decision.id}
          onChange={e=>{
            setKnowledgeId(e.target.value);setMoment("uncertain");setOrder("undetermined");
            setRationale("");
          }}>
          {registry.current.map(({decision,source})=>
            <option key={decision.id} value={decision.id}>
              Cap. {source.candidate.chapterNumber}, scena {source.candidate.sceneNumber} —
              {" "}{source.candidate.actor}: {source.decision.quote}
            </option>)}
        </select>
      </label>
      <p className="mt-1 break-words text-xs">
        <b>Citazione:</b> «{current.source.decision.quote}» ·
        {" "}cap. {current.source.candidate.chapterNumber},
        scena {current.source.candidate.sceneNumber}, offset {current.source.decision.offset}
      </p>
      <label className="mt-2 block text-xs font-semibold">
        Quando conosce la notizia rispetto alla scena?
        <select className="field mt-1" aria-label="Momento accesso conoscenza"
          value={moment} onChange={e=>setMoment(e.target.value as KnowledgeAccessMoment)}>
          {(Object.keys(MOMENT_LABELS) as KnowledgeAccessMoment[])
            .filter(x=>current.decision.verdict==="still_secret"?
              ["not_yet_known","uncertain"].includes(x):x!=="not_yet_known")
            .map(x=><option key={x} value={x}>{MOMENT_LABELS[x]}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-xs font-semibold">
        Ordine degli eventi della storia rispetto alla scena
        <select className="field mt-1" aria-label="Ordine narrativo conoscenza"
          value={order} onChange={e=>setOrder(e.target.value as NarrativeTemporalOrder)}>
          {(Object.keys(ORDER_LABELS) as NarrativeTemporalOrder[])
            .map(x=><option key={x} value={x}>{ORDER_LABELS[x]}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-xs font-semibold">
        Motivazione temporale privata (20–650 caratteri)
        <textarea className="field mt-1 min-h-20" maxLength={650}
          aria-label="Motivazione tempo conoscenza" value={rationale}
          onChange={e=>setRationale(e.target.value)}/>
      </label>
      <Button disabled={blocked} onClick={()=>void save()}>
        Registra momento della conoscenza
      </Button>
    </fieldset>}
    {timeline.byCharacter.length>0&&<div className="mt-3" aria-label="Timeline testuale per personaggio">
      <p className="font-semibold text-xs">
        Posizioni nel manoscritto per personaggio — non successione temporale verificata
      </p>
      {timeline.byCharacter.map(group=><div key={group.actorName}
        className="mt-2 rounded border border-slate-200 p-2 dark:border-slate-700">
        <p className="font-semibold text-xs">{group.actorName} · {group.entries.length}
          {" "}annotazioni correnti</p>
        <ol className="mt-1 space-y-2">
          {group.entries.map(({decision,knowledge})=><li key={decision.id}
            className="min-w-0 border-t border-slate-200 pt-1 text-xs dark:border-slate-700">
            <p><b>Cap. {knowledge.source.candidate.chapterNumber}, scena {
              knowledge.source.candidate.sceneNumber}</b> · {MOMENT_LABELS[decision.accessMoment]}</p>
            <p>{ORDER_LABELS[decision.narrativeOrder]}</p>
            <p className="break-words">«{knowledge.source.decision.quote}»</p>
            <p className="break-words">Motivo autore: {decision.rationale}</p>
          </li>)}
        </ol>
      </div>)}
    </div>}
    {count>0&&<details aria-label="Storico tempi conoscenza"
      className="mt-3 rounded border border-slate-200 p-2 dark:border-slate-700">
      <summary className="cursor-pointer text-xs font-semibold">
        Storico delle interpretazioni temporali ({count})
      </summary>
      <p className="muted mt-2 text-xs">
        Non correnti o superate: {timeline.nonCurrentCount}. Le importazioni
        non autenticano l'autore e non riattivano fonti obsolete.
      </p>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {[...(book.narrativeKnowledgeTimingDecisions??[])].reverse()
          .map(entry=><li key={entry.id}
            className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            <p>{MOMENT_LABELS[entry.accessMoment]} · {ORDER_LABELS[entry.narrativeOrder]}</p>
            <p className="break-words">{entry.rationale}</p>
            <p className="break-words">Fonte: {entry.knowledgeDecisionId}
              {" "}· {entry.decidedAt}
            </p>
          </li>)}
      </ul>
    </details>}
  </details>;
}
