import {useState} from "react";
import {ShieldCheck} from "lucide-react";
import type {BookProject,Chapter} from "../domain/types";
import type {NarrativeEventCandidate} from "../domain/narrative-event-candidates";
import {authorEventStatus,type AuthorEventVerdict,
  type AuthorEventStatus} from "../domain/author-event-decisions";
import {decideAuthorNarrativeEvent} from "../application/author-event-decisions";
import {Button} from "./ui/button";

const LABELS: Record<AuthorEventStatus,string> = {
  pending:"Non valutato",
  confirmed:"Confermato dall'autore per questa revisione del testo",
  rejected:"Respinto dall'autore come fatto narrativo",
  withdrawn:"Dichiarazione ritirata",
  stale:"Decisione non più valida: la scena è cambiata o è stata riaperta",
  imported_unverified:"Dichiarazione importata: richiede riconferma locale",
};

export function AuthorEventDecisionControls({book,chapter,candidate,onRefresh}:{
  book:BookProject;chapter:Chapter;candidate:NarrativeEventCandidate;
  onRefresh:()=>Promise<void>;
}){
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  let current:AuthorEventStatus="pending";
  try{current=authorEventStatus(chapter,candidate);}
  catch(cause){return <p role="alert" className="text-xs text-red-700 dark:text-red-300">
    {cause instanceof Error?cause.message:"Storico decisioni non valido."} Nessuna conferma utilizzabile.
  </p>;}
  const locked=busy||book.status==="running"||!!book.editorialCycle||
    !!book.editorialReviewSceneIds?.length||!chapter.frozenAt;
  const validNote=note.trim().length>=24&&note.trim().length<=400&&note.length<=400;

  async function decide(verdict:AuthorEventVerdict){
    setMessage("");setError("");
    if(locked||!validNote)return;
    const warning=[
      "DECISIONE ESPLICITA DELL'AUTORE SULLA TRAMA",
      "Capitolo "+candidate.chapterNumber+", scena "+candidate.sceneNumber,
      "Frase letterale: "+candidate.quote,
      "Offset: "+candidate.offset,
      "Scelta: "+(verdict==="confirmed"
        ?"Confermo che questa menzione descrive un fatto effettivo nella storia."
        :verdict==="rejected"
          ?"Respingo questa menzione come fatto effettivo."
          :"Ritiro la dichiarazione precedente."),
      "Motivazione: "+note.trim(),
      "",
      "Questa è una dichiarazione locale, NON una firma digitale o un controllo semantico.",
      "Può essere inclusa nei backup e nella repository GitHub del libro, se sincronizzata.",
      "Una conferma nuova o il ritiro di una conferma rimette in review i capitoli successivi già scritti; NON riscrive la prosa.",
      "La sincronizzazione automatica viene disabilitata e l'outbox remoto cancellato.",
      "",
      "Confermi la scelta?",
    ].join("\n");
    if(!window.confirm(warning))return;
    setBusy(true);
    try{
      const result=await decideAuthorNarrativeEvent(book.id,book.updatedAt,
        candidate,verdict,note.trim(),true);
      setNote("");
      setMessage("Decisione autore registrata. "+
        (result.downstreamReopened>0
          ?result.downstreamReopened+" capitoli successivi richiedono una nuova redazione."
          :"Nessuna revisione successiva necessaria."));
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Impossibile salvare la decisione.");
    }finally{setBusy(false);}
  }
  return <details className="mt-2 rounded border border-slate-300 p-2 dark:border-slate-700">
    <summary className="cursor-pointer text-xs font-semibold">
      <span className="inline-flex items-center gap-1"><ShieldCheck size={14}/>
        Decisione autore: {LABELS[current]}
      </span>
    </summary>
    <div className="mt-2 space-y-2">
      <p className="muted text-xs">
        Il software individua frasi, non verità. Valuta chi sta parlando,
        se l'evento avviene davvero e quali conseguenze ha nella trama.
        Le approvazioni diventano obsolete se il testo o il freeze cambiano.
      </p>
      <label className="block text-xs font-semibold">
        Motivazione della decisione (24–400 caratteri)
        <textarea className="field mt-1 min-h-24 w-full" value={note}
          onChange={e=>setNote(e.target.value)}
          aria-label={"Motivazione evento capitolo "+chapter.number+" scena "+candidate.sceneNumber+" offset "+candidate.offset}
          maxLength={400}
          placeholder="Spiega perché è un evento effettivo, una menzogna, un sogno o un'ipotesi."/>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={locked||!validNote||current==="confirmed"}
          onClick={()=>void decide("confirmed")}>Conferma fatto narrativo</Button>
        <Button size="sm" variant="outline" disabled={locked||!validNote||current==="rejected"}
          onClick={()=>void decide("rejected")}>Respingi come fatto</Button>
        <Button size="sm" variant="outline" disabled={locked||!validNote||
          !["confirmed","rejected","imported_unverified"].includes(current)}
          onClick={()=>void decide("withdrawn")}>Ritira dichiarazione</Button>
      </div>
      {locked&&<p className="muted text-xs">
        Prima completa la review in corso o congela il capitolo. Non puoi cambiare
        il canone mentre un agente sta scrivendo.
      </p>}
      {error&&<p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status" className="text-xs">{message}</p>}
    </div>
  </details>;
}
