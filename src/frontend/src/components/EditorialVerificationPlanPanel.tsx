import {useMemo,useState} from "react";
import type {BookProject,Chapter} from "../domain/types";
import type {ChapterEditorialCycle} from "../domain/editorial-board";
import {
  buildEditorialVerificationPlan,type VerificationPlanItem,
  type VerificationPlanStatus,
} from "../domain/editorial-verification-plan";

const STATUS_LABELS:Record<VerificationPlanStatus,string>={
  awaiting_judge:"In attesa del giudice",
  needs_evidence:"Da approfondire: prove insufficienti",
  approved_edit:"Correzione approvata dal giudice",
  closed_no_edit:"Nessuna modifica approvata",
  requires_recheck:"Da rivalidare: fonti o giudizio non correnti",
  archived:"Storico: non autorizza interventi",
};
type PlanFilter="pending"|"approved"|"closed"|"archived"|"all";
const FILTER_LABELS:Record<PlanFilter,string>={
  pending:"Da verificare",approved:"Correzioni approvate",
  closed:"Chiuse senza intervento",archived:"Tornate precedenti",all:"Tutte",
};
function selected(item:VerificationPlanItem,filter:PlanFilter):boolean{
  if(filter==="all")return true;
  if(filter==="pending")return [
    "awaiting_judge","needs_evidence","requires_recheck",
  ].includes(item.status);
  if(filter==="approved")return item.status==="approved_edit";
  if(filter==="closed")return item.status==="closed_no_edit";
  return item.status==="archived";
}
export function EditorialVerificationPlanPanel({book,cycle,chapter}:{
  book:BookProject;cycle:ChapterEditorialCycle;chapter:Chapter;
}){
  const [filter,setFilter]=useState<PlanFilter>("pending");
  const plan=useMemo(()=>buildEditorialVerificationPlan(book,cycle,chapter),
    [book,cycle,chapter]);
  if(!plan.totalItemCount && !plan.unreviewableFindingCount)return null;
  const filtered=plan.items.filter(item=>selected(item,filter));
  const pending=plan.counts.awaiting_judge+plan.counts.needs_evidence+
    plan.counts.requires_recheck;
  return <section aria-label="Piano verifiche editoriali"
    className="min-w-0 space-y-3 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
    <h3 className="font-semibold">Piano verifiche editoriali · capitolo {chapter.number}</h3>
    <p className="muted text-xs">Elaborato localmente dai giudizi già presenti.
      Distingue dubbi, approvazioni e storico senza nuove richieste AI,
      salvataggi o modifiche al romanzo. La prova letterale non dimostra
      la fondatezza di una raccomandazione.</p>
    <p className="text-xs">
      {pending} da verificare · {plan.counts.approved_edit} interventi approvati
      dal giudice · {plan.counts.closed_no_edit} senza modifiche ·
      {" "}{plan.counts.archived} storici.
    </p>
    {(plan.unreviewableFindingCount>0||plan.omittedItemCount>0)&&
      <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
        Copertura parziale: {plan.unreviewableFindingCount} rilievi fuori
        dal campione della riconciliazione ({plan.omittedGroupCount} gruppi
        omessi, {plan.oversizedGroupCount} sovradimensionati);
        {" "}{plan.omittedItemCount} voci di piano non mostrate.
        Non interpretare l'assenza di una voce come un problema risolto.
        I finding fuori campione non autorizzano remediation.
      </p>}
    <label className="block text-xs font-semibold" htmlFor="editorial-plan-filter">
      Visualizza
      <select id="editorial-plan-filter"
        aria-label="Filtra piano verifiche editoriali"
        className="field mt-1 w-full max-w-xs"
        value={filter} onChange={e=>setFilter(e.target.value as PlanFilter)}>
        {(Object.keys(FILTER_LABELS) as PlanFilter[]).map(value=>
          <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
      </select>
    </label>
    {!filtered.length&&<p className="muted text-xs">
      Nessuna voce in questa sezione del piano.</p>}
    <div className="space-y-2">
      {filtered.map(item=><details key={item.key}
        className="min-w-0 rounded border border-slate-300 p-2 text-xs dark:border-slate-700">
        <summary className="cursor-pointer font-semibold break-words">
          Tornata {item.round} · {item.category} · {STATUS_LABELS[item.status]}
        </summary>
        <div className="mt-2 space-y-1 break-words">
          <p><b>Scena:</b> {item.sceneId||"Fonte non disponibile"}
            {item.segmentIndex!==null?" · segmento "+(item.segmentIndex+1):""}</p>
          <p className="whitespace-pre-wrap"><b>Citazione:</b> «{item.quote}»</p>
          <p><b>Rilievi collegati:</b> {item.findingIds.join(", ")}</p>
          {item.acceptedFindingIds.length>0&&<p>
            <b>Accolti nel giudizio:</b> {item.acceptedFindingIds.join(", ")}
          </p>}
          {item.explanation&&<p className="whitespace-pre-wrap">
            <b>Ragionamento del giudice:</b> {item.explanation}</p>}
          {item.missingEvidence&&<p className="whitespace-pre-wrap">
            <b>Prova mancante o limite dichiarato:</b> {item.missingEvidence}</p>}
          {item.nextCheck&&<p className="whitespace-pre-wrap">
            <b>Controllo suggerito (non eseguito):</b> {item.nextCheck}</p>}
          {item.status==="awaiting_judge"&&<p className="muted">
            Il giudice non ha ancora indicato prove mancanti o un controllo
            specifico per questo gruppo.
          </p>}
          {item.status==="requires_recheck"&&<p className="text-amber-700
            dark:text-amber-300">Le fonti o il giudizio non sono più
            convalidati rispetto al libro corrente: non usare questo
            estratto per avviare una riparazione.</p>}
          {item.status==="archived"&&<p className="muted">
            Provenienza storica: il romanzo può essere stato modificato
            dopo questa tornata. Non è un permesso corrente.</p>}
          {item.status==="approved_edit"&&<p className="muted">
            L'approvazione del giudice non prova la correttezza del
            suggerimento né attesta che la riparazione sia già stata eseguita.
            Gli ulteriori gate della redazione restano necessari.</p>}
        </div>
      </details>)}
    </div>
  </section>;
}
