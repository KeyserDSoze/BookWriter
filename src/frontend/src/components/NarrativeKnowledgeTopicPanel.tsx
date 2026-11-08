import {useState} from "react";
import type {BookProject} from "../domain/types";
import {buildNarrativeKnowledgeRegistry,type CurrentKnowledgeDecision}
  from "../domain/narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTopicRegistry,MAX_KNOWLEDGE_TOPIC_DECISIONS,
  type NarrativeKnowledgeTopicDecision}
  from "../domain/narrative-knowledge-topic-decisions";
import {recordNarrativeKnowledgeTopicDecision}
  from "../application/narrative-knowledge-topic-decisions";
import {Button} from "./ui/button";

const VERDICTS:Record<NarrativeKnowledgeTopicDecision["verdict"],string>={
  same_information:"Stessa informazione secondo l'autore",
  different_information:"Informazioni distinte secondo l'autore",
};
function label(entry:CurrentKnowledgeDecision):string{
  const c=entry.source.candidate;
  return c.actor+" — cap. "+c.chapterNumber+", scena "+c.sceneNumber+
    ": "+entry.source.decision.quote;
}
function actorsDiffer(first:CurrentKnowledgeDecision,second:CurrentKnowledgeDecision):boolean{
  return first.source.candidate.actor.normalize("NFC").toLocaleLowerCase("it") !==
    second.source.candidate.actor.normalize("NFC").toLocaleLowerCase("it");
}

/** Deliberate local pairwise interpretation, separate from all AI consents. */
export function NarrativeKnowledgeTopicPanel({book,onRefresh}:{
  book:BookProject;onRefresh:()=>Promise<void>;
}){
  const knowledge=buildNarrativeKnowledgeRegistry(book).current;
  const registry=buildNarrativeKnowledgeTopicRegistry(book);
  const history=book.narrativeKnowledgeTopicDecisions??[];
  const [firstId,setFirstId]=useState("");
  const [secondId,setSecondId]=useState("");
  const [rationale,setRationale]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const first=knowledge.find(x=>x.decision.id===firstId)??knowledge[0];
  const eligible=first?knowledge.filter(x=>x.decision.id!==first.decision.id &&
    actorsDiffer(first,x)):[];
  const second=eligible.find(x=>x.decision.id===secondId)??eligible[0];
  if(!first && history.length===0)return null;
  const saved=first&&second?registry.current.find(entry=>
    [entry.first.decision.id,entry.second.decision.id].includes(first.decision.id) &&
    [entry.first.decision.id,entry.second.decision.id].includes(second.decision.id)):undefined;
  const disabled=busy||book.status==="running"||
    (!!book.editorialCycle&&book.editorialCycle.stage!=="blocked")||
    !first||!second||history.length>=MAX_KNOWLEDGE_TOPIC_DECISIONS||
    rationale.trim().length<20||rationale.trim().length>650;

  async function save(verdict:NarrativeKnowledgeTopicDecision["verdict"]){
    if(disabled||!first||!second)return;
    if(!window.confirm(
      "Confermare la tua interpretazione delle DUE citazioni? " +
      "La relazione riguarda soltanto questa coppia, NON stabilisce che " +
      "i personaggi abbiano comunicato, né prova verità, identità di segreti " +
      "o ordine cronologico degli eventi. I nuovi collegamenti rimangono " +
      "PRIVATI ai modelli AI anche con vecchi consensi di condivisione; " +
      "non aggiornano il canone. Backup ZIP e push GitHub MANUALI possono " +
      "includere spoiler. L'autosync sarà disabilitato."))return;
    setBusy(true);setMessage("");setError("");
    try{
      await recordNarrativeKnowledgeTopicDecision(book.id,book.updatedAt,
        first.decision.id,second.decision.id,verdict,rationale.trim());
      setRationale("");
      await onRefresh();
      setMessage("Relazione fra le due conoscenze registrata. Canone e consensi AI invariati.");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Relazione non registrata.");
    }finally{setBusy(false);}
  }
  return <details aria-label="Relazioni conoscenze autore"
    className="mt-3 min-w-0 rounded border border-slate-300 p-2 dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">
      Collegare informazioni fra personaggi ({registry.current.length} relazioni correnti)
    </summary>
    <p className="muted mt-2 text-xs">
      L'autore confronta <b>due citazioni letterali già attestate</b> di personaggi
      diversi. Non sono inferite equivalenze da parole simili, nomi/alias o
      cronologie. Nemmeno una coppia approvata dimostra che l'informazione
      sia stata trasmessa; due collegamenti non generano automaticamente un terzo.
      Questi dati privati non entrano nei prompt AI, nemmeno con i precedenti consensi.
      {" "}Storico: {history.length}/{MAX_KNOWLEDGE_TOPIC_DECISIONS}.
    </p>
    {message&&<p role="status" className="mt-2 text-xs text-emerald-700">{message}</p>}
    {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {first&&eligible.length>0&&<fieldset aria-label="Confronta due conoscenze"
      className="mt-2 min-w-0 rounded border border-slate-200 p-2 dark:border-slate-700">
      <legend className="text-xs font-semibold">Confronto motivato dell'autore</legend>
      <label className="mt-2 block text-xs font-semibold">
        Prima conoscenza attestata
        <select className="field mt-1" aria-label="Prima conoscenza da confrontare"
          value={first.decision.id}
          onChange={e=>{setFirstId(e.target.value);setSecondId("");setRationale("");}}>
          {knowledge.map(x=><option key={x.decision.id} value={x.decision.id}>
            {label(x)}
          </option>)}
        </select>
      </label>
      <label className="mt-2 block text-xs font-semibold">
        Seconda conoscenza di un altro personaggio
        <select className="field mt-1" aria-label="Seconda conoscenza da confrontare"
          value={second?.decision.id??""} onChange={e=>setSecondId(e.target.value)}>
          {eligible.map(x=><option key={x.decision.id} value={x.decision.id}>
            {label(x)}
          </option>)}
        </select>
      </label>
      <p className="mt-2 break-words text-xs"><b>Fonte A:</b> «{first.source.decision.quote}»</p>
      {second&&<p className="mt-1 break-words text-xs">
        <b>Fonte B:</b> «{second.source.decision.quote}»
      </p>}
      {saved&&<p className="mt-2 text-xs">
        Interpretazione corrente della coppia: <b>{VERDICTS[saved.decision.verdict]}</b>
      </p>}
      <label className="mt-2 block text-xs font-semibold">
        Motivazione privata sul contenuto comune o distinto (20–650 caratteri)
        <textarea className="field mt-1 min-h-20" maxLength={650}
          aria-label="Motivazione relazione conoscenze" value={rationale}
          onChange={e=>setRationale(e.target.value)}/>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={()=>void save("same_information")}>
          Conferma stessa informazione
        </Button>
        <Button disabled={disabled} onClick={()=>void save("different_information")}>
          Conferma informazioni differenti
        </Button>
      </div>
    </fieldset>}
    {first&&eligible.length===0&&<p className="muted mt-2 text-xs">
      Serve una seconda conoscenza confermata di un altro personaggio.
    </p>}
    {registry.current.length>0&&<div aria-label="Confronti correnti fra personaggi"
      className="mt-3 max-h-80 space-y-2 overflow-y-auto">
      {registry.current.map(link=><div key={link.decision.id}
        className="min-w-0 rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
        <p className="font-semibold">{VERDICTS[link.decision.verdict]}</p>
        <p className="mt-1 break-words"><b>{link.first.source.candidate.actor}</b> —
          {" "}cap. {link.first.source.candidate.chapterNumber}, scena {
            link.first.source.candidate.sceneNumber}: «{link.first.source.decision.quote}»</p>
        <p className="mt-1 break-words"><b>{link.second.source.candidate.actor}</b> —
          {" "}cap. {link.second.source.candidate.chapterNumber}, scena {
            link.second.source.candidate.sceneNumber}: «{link.second.source.decision.quote}»</p>
        <p className="mt-1">Tempo della prima fonte: {
          link.firstTiming?.decision.accessMoment??"non determinato dall'autore"}
          {" "}· tempo della seconda: {
            link.secondTiming?.decision.accessMoment??"non determinato dall'autore"}</p>
        <p className="muted mt-1">
          Sono etichette relative alle rispettive scene, NON una prova dell'ordine
          temporale tra le due notizie né di un passaggio di informazione.
        </p>
        <p className="mt-1 break-words">Motivazione autore: {link.decision.rationale}</p>
      </div>)}
    </div>}
    {history.length>0&&<details aria-label="Storico relazioni conoscenze"
      className="mt-3 rounded border border-slate-200 p-2 dark:border-slate-700">
      <summary className="cursor-pointer text-xs font-semibold">
        Storico relazioni fra conoscenze ({history.length})
      </summary>
      <p className="muted mt-1 text-xs">
        Non correnti o superate: {registry.nonCurrentCount}. Gli archivi importati
        non autenticano l'autore e non rimettono in vigore fonti obsolete.
      </p>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {[...history].reverse().map(d=><li key={d.id}
          className="min-w-0 rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          <p>{VERDICTS[d.verdict]} · {d.decidedAt}</p>
          <p className="break-words">{d.firstKnowledgeDecisionId} / {
            d.secondKnowledgeDecisionId}</p>
          <p className="break-words">{d.rationale}</p>
        </li>)}
      </ul>
    </details>}
  </details>;
}
