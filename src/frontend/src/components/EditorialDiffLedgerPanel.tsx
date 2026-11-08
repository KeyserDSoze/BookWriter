import {useMemo} from "react";
import type {BookProject,Chapter} from "../domain/types";
import {
  buildEditorialDiffLedger,
  type EditorialLedgerTextChange,type EditorialLedgerCheckChange,
  type EditorialLedgerProvenance,type EditorialLedgerObservation,
} from "../domain/editorial-diff-ledger";

const POSITION:Record<EditorialLedgerTextChange,string>={
  first_literal_witness:"Prima occorrenza registrata nel campione",
  same_literal_position:"Citazione e posizione letterale coincidono",
  moved_literal_position:"Citazione osservata in una posizione differente",
  source_not_comparable:"Fonte o giudizio non confrontabile",
  ambiguous_literal_witness:"Più occorrenze nello stesso contesto: legame ambiguo",
};
const CHECK:Record<EditorialLedgerCheckChange,string>={
  first_suggestion:"Primo suggerimento registrato nel campione",
  same_suggestion_words:"Prova mancante e controllo con le stesse parole",
  different_suggestion_words:"Prova mancante o controllo riformulati",
  new_judge_not_available:"Nuovo controllo del giudice non disponibile",
  not_comparable:"Controlli non confrontabili in modo affidabile",
};
const SOURCE:Record<EditorialLedgerProvenance,string>={
  archived_structural:"Storico: ancore archiviate coerenti",
  archived_unverifiable:"Storico: riferimenti non verificabili",
  current_validated:"Nuovo giudizio rivalidato sul testo corrente",
  current_unvalidated:"Nuovo giudizio non convalidato: nessuna approvazione",
  current_awaiting_judge:"Nuova prova letterale in attesa del giudice",
};
function sourceLabel(obs:EditorialLedgerObservation):string{
  if(obs.source==="current")return "Revisione corrente";
  if(obs.source==="prior_round")
    return "Tornata precedente del ciclo attuale "+(obs.sourceIndex+1);
  return "Archivio del capitolo "+(obs.sourceIndex+1);
}
/** Private read-only ledger, not an author task list or AI prompt. */
export function EditorialDiffLedgerPanel({book,chapter}:{
  book:BookProject;chapter:Chapter;
}){
  const ledger=useMemo(()=>buildEditorialDiffLedger(book,chapter),[book,chapter]);
  if(!ledger.totalHistoricalUnresolved&&!ledger.currentGroupsCompared)return null;
  return <section aria-label={"Registro differenze editoriali capitolo "+chapter.number}
    className="min-w-0 space-y-3 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
    <h4 className="font-semibold">Registro delle differenze editoriali · capitolo {chapter.number}</h4>
    <p className="muted text-xs">Cronologia locale dei controlli letterali,
      non delle criticità narrative certificate. La stessa citazione in
      più tornate non prova che si tratti dello stesso problema; una citazione
      assente dal campione non significa problema risolto. Le annotazioni
      private dell'autore restano separate e non sono mai riproposte
      come permessi o nuovi compiti.</p>
    <p className="text-xs">{ledger.totalHistoricalUnresolved} verifiche
      storiche con prove insufficienti · {ledger.currentGroupsCompared}
      gruppi nella revisione corrente · {ledger.totalThreads}
      serie di corrispondenze letterali.</p>
    {(ledger.omittedThreads>0||ledger.omittedCandidateObservations>0||
      ledger.currentUnreviewableFindingCount>0||
      ledger.threads.some(x=>x.omittedObservations>0))&&
      <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
        Campionamento parziale: {ledger.omittedThreads} serie non mostrate
        (max 12); {ledger.omittedCandidateObservations} occorrenze escluse
        dalla finestra delle 240 più recenti; {ledger.threads.reduce((n,x)=>
          n+x.omittedObservations,0)} occorrenze nascoste nei dettagli (max 8
        per serie). Nuova revisione: {ledger.currentUnreviewableFindingCount}
        rilievi non esaminabili, {ledger.currentOmittedGroupCount} gruppi
        omessi, {ledger.currentOversizedGroupCount} sovradimensionati.
        Nessuna omissione equivale a una verifica conclusa.</p>}
    <div className="space-y-2">
      {ledger.threads.map(thread=><details key={thread.key}
        className="min-w-0 rounded border border-slate-300 p-2 text-xs dark:border-slate-700">
        <summary className="cursor-pointer break-words font-semibold">
          {thread.category||"Categoria non disponibile"} ·
          {" "}{thread.totalObservations} occorrenze ·
          {" "}{thread.observedInCurrentSample
            ?"Osservata nella nuova revisione"
            :ledger.hasCurrentReview
              ?"Non osservata nei gruppi nuovi esaminati (non risolta)"
              :"Solo archivio; nessuna revisione corrente"}
          {thread.ambiguousOccurrences?" · Corrispondenza ambigua":""}
        </summary>
        <div className="mt-2 space-y-2 break-words">
          <p><b>Scena:</b> {thread.sceneId||"Fonte sconosciuta"}</p>
          <p className="whitespace-pre-wrap"><b>Citazione letterale:</b>
            {" "}«{thread.quote}»</p>
          {thread.ambiguousOccurrences&&<p className="text-amber-700 dark:text-amber-300">
            Più rilievi condividono questa frase in una singola tornata:
            gli accostamenti non identificano un unico problema.</p>}
          <ol className="space-y-2">
            {thread.observations.map(obs=><li key={obs.key}
              className="min-w-0 rounded border border-slate-200 p-2 dark:border-slate-700">
              <p><b>{sourceLabel(obs)} · tornata {obs.round}</b></p>
              <p className="mt-1">{SOURCE[obs.provenance]}</p>
              <p><b>Riferimento:</b> {POSITION[obs.textChange]}</p>
              <p><b>Verifica suggerita:</b> {CHECK[obs.checkChange]}</p>
              {obs.currentStatus&&<p><b>Nuovo giudizio:</b> {
                obs.currentStatus==="needs_evidence"?"Prove ancora insufficienti":
                obs.currentStatus==="approved_edit"?"Correzione approvata dal giudice":
                obs.currentStatus==="closed_no_edit"?"Nessuna modifica approvata":
                obs.currentStatus==="awaiting_judge"?"In attesa del giudice":
                "Non convalidato"
              }. Non equivale alla soluzione del dubbio storico.</p>}
              {obs.missingEvidence&&<p className="whitespace-pre-wrap">
                <b>Prova mancante:</b> {obs.missingEvidence}</p>}
              {obs.nextCheck&&<p className="whitespace-pre-wrap">
                <b>Controllo suggerito, non eseguito:</b> {obs.nextCheck}</p>}
            </li>)}
          </ol>
        </div>
      </details>)}
    </div>
  </section>;
}
