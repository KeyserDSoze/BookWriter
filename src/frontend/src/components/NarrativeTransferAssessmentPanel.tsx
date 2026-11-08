import {useState} from "react";
import type {BookProject} from "../domain/types";
import type {KnowledgeTransferPreview} from "../domain/knowledge-transfer-preview";
import {buildNarrativeTransferAssessmentRegistry,
  type NarrativeTransferVerdict} from "../domain/narrative-transfer-assessments";
import {recordNarrativeTransferAssessment}
  from "../application/narrative-transfer-assessments";
import {buildTransferSharingRegistry} from "../domain/narrative-transfer-sharing";
import {NarrativeTransferShareControl} from "./NarrativeTransferShareControl";
import {Button} from "./ui/button";

const LABELS:Record<NarrativeTransferVerdict,string>={
  author_attested_report:"Comunicazione descritta secondo l'autore",
  possible_path:"Pista possibile, non accertata",
  dismissed:"Pista respinta dall'autore",
};

export function NarrativeTransferAssessmentPanel({book,preview,onRefresh}:{
  book:BookProject;preview:KnowledgeTransferPreview;onRefresh:()=>Promise<void>;
}){
  const [selectedId,setSelectedId]=useState("");
  const [verdict,setVerdict]=useState<NarrativeTransferVerdict|"">("");
  const [rationale,setRationale]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const registry=buildNarrativeTransferAssessmentRegistry(book,preview.topic.decision.id);
  const sharing=buildTransferSharingRegistry(book);
  const history=(book.narrativeTransferAssessments??[])
    .filter(x=>x.topicDecisionId===preview.topic.decision.id);
  const selected=preview.directions.flatMap(direction=>
    direction.trace.candidates.map(candidate=>({direction,candidate})))
    .find(x=>x.candidate.id===selectedId);
  const canSave=!!selected&&!!verdict&&
    rationale.trim().length>=20&&rationale.trim().length<=650&&
    !busy&&book.status!=="running"&&
    (!book.editorialCycle||book.editorialCycle.stage==="blocked");

  async function save(){
    if(!canSave||!selected||!verdict)return;
    if(!window.confirm("Confermare il giudizio su QUESTA citazione e su questa " +
      "direzione? È solo la tua interpretazione del testo: non certifica " +
      "trasmissione, ascolto o verità e non aggiorna il canone. La nota " +
      "privata non sarà inviata ai modelli AI, ma può comparire in ZIP " +
      "e push GitHub manuali. L'autosync sarà disabilitato."))return;
    setBusy(true);setError("");setMessage("");
    try{
      await recordNarrativeTransferAssessment(
        book.id,book.updatedAt,preview.topic.decision.id,
        selected.direction.sender.decision.id,
        selected.direction.recipient.decision.id,
        selected.candidate.id,verdict,rationale.trim());
      setSelectedId("");setVerdict("");setRationale("");
      await onRefresh();
      setMessage("Giudizio privato salvato; la prosa e i consensi AI sono invariati.");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Giudizio non salvato.");
    }finally{setBusy(false);}
  }
  return <section aria-label="Piste comunicative della coppia"
    className="mt-3 min-w-0 rounded border border-slate-300 p-2 text-xs dark:border-slate-700">
    <h3 className="font-semibold">Piste di comunicazione: ricerca locale su richiesta</h3>
    <p className="muted mt-1">
      Queste sono solo <b>frasi che descrivono un possibile racconto</b>, non
      conferme che qualcuno abbia parlato, ascoltato, creduto o appreso.
      «Stessa informazione» è un collegamento dell'autore, non una prova di
      trasferimento. Ogni ricerca legge solo capitoli congelati <b>precedenti
      nel manoscritto</b> rispetto alla menzione del destinatario; flashback,
      dialoghi nella stessa scena, pronomi e notizie implicite possono sfuggire.
      La condivisione dei tuoi giudizi richiede consenso separato per ogni pista.
    </p>
    {message&&<p role="status" className="mt-2 text-emerald-700">{message}</p>}
    {error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}
    {preview.directions.map(direction=><div
      key={direction.sender.decision.id+"-"+direction.recipient.decision.id}
      className="mt-2 min-w-0 rounded border border-slate-200 p-2 dark:border-slate-700">
      <p className="font-semibold">
        {direction.sender.source.candidate.actor} → {
          direction.recipient.source.candidate.actor}
      </p>
      <p className="mt-1 break-words">
        Menzione destinatario: «{direction.recipient.source.decision.quote}»
      </p>
      <p className="muted mt-1">
        Scene esaminate: {direction.trace.scannedSceneCount}/{
          direction.trace.candidateSceneCount}.
        {" "}Non esaminate: {direction.trace.unscannedSceneCount}.
        {" "}Piste lessicali: {direction.trace.matchedCandidateCount},
        non mostrate: {direction.trace.omittedCandidateCount}.
        Limiti per scena: 6.000 caratteri e prime 12 menzioni rilevate.
      </p>
      {direction.trace.candidates.length===0&&<p className="mt-1">
        Nessuna frase candidata trovata nel campione: <b>non è una prova
        dell'assenza di comunicazione</b>.
      </p>}
      <ul className="mt-2 space-y-2">
        {direction.trace.candidates.map(candidate=>{
          const current=registry.current.find(x=>x.candidate.id===candidate.id&&
            x.decision.senderKnowledgeDecisionId===direction.sender.decision.id&&
            x.decision.recipientKnowledgeDecisionId===direction.recipient.decision.id);
          return <li key={candidate.id}
            className="min-w-0 rounded border border-slate-200 p-2 dark:border-slate-700">
            <p>Cap. {candidate.chapterNumber}, scena {candidate.sceneNumber},
              {" "}offset {candidate.offset} · parole in comune: {
                candidate.matchedTopicTerms.join(", ")}</p>
            <p className="mt-1 break-words">«{candidate.quote}»</p>
            <p className="muted mt-1">
              Citazione letterale non verificata come evento; non stabilisce
              il tempo effettivo né la ricezione della notizia.
            </p>
            {current&&<p className="mt-1">
              Giudizio corrente: <b>{LABELS[current.decision.verdict]}</b>
            </p>}
            {current&&<NarrativeTransferShareControl
              key={current.decision.id} book={book}
              assessmentId={current.decision.id}
              permission={sharing.current.find(x=>
                x.assessment.decision.id===current.decision.id)?.permission??null}
              onRefresh={onRefresh}/>}
            <Button size="sm" variant="outline"
              disabled={busy} onClick={()=>{
                setSelectedId(candidate.id);setVerdict("");setRationale("");
                setMessage("");setError("");
              }}>Valuta questa pista</Button>
          </li>;
        })}
      </ul>
    </div>)}
    {selected&&<fieldset aria-label="Valutazione autore della pista"
      className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
      <legend className="font-semibold">Interpretazione privata della citazione</legend>
      <p className="mt-1 break-words">
        {selected.direction.sender.source.candidate.actor} → {
          selected.direction.recipient.source.candidate.actor}:
        {" "}«{selected.candidate.quote}»
      </p>
      <label className="mt-2 block font-semibold">
        Valutazione della pista
        <select className="field mt-1" aria-label="Valutazione della pista"
          value={verdict} onChange={e=>
            setVerdict(e.target.value as NarrativeTransferVerdict|"")}>
          <option value="">Seleziona una tua interpretazione</option>
          {Object.entries(LABELS).map(([value,label])=>
            <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="muted mt-1">Anche «comunicazione descritta» attesta solo
        la tua lettura della frase, mai che l'altro personaggio abbia
        ricevuto, creduto o compreso il messaggio.</p>
      <label className="mt-2 block font-semibold">
        Motivazione privata (20–650 caratteri)
        <textarea className="field mt-1 min-h-20" maxLength={650}
          aria-label="Motivazione pista comunicativa" value={rationale}
          onChange={e=>setRationale(e.target.value)}/>
      </label>
      <Button size="sm" disabled={!canSave} onClick={()=>void save()}>
        Registra giudizio sulla pista
      </Button>
    </fieldset>}
    {history.length>0&&<details aria-label="Storico valutazioni comunicative"
      className="mt-3 rounded border border-slate-200 p-2 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">
        Storico valutazioni ({history.length})
      </summary>
      <p className="muted mt-1">
        Non correnti o rettificate: {registry.nonCurrentCount}.
        Le scelte in un archivio importato non autenticano l'autore.
      </p>
      <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto">
        {[...history].reverse().map(entry=><li key={entry.id}
          className="min-w-0 rounded border border-slate-200 p-2 dark:border-slate-700">
          <p>{LABELS[entry.verdict]} · {entry.decidedAt}</p>
          <p className="break-words">{entry.rationale}</p>
        </li>)}
      </ul>
    </details>}
  </section>;
}
