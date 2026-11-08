import {useMemo} from "react";
import type {BookProject,Chapter} from "../domain/types";
import type {ChapterEditorialCycle} from "../domain/editorial-board";
import {
  compareEditorialArchiveToCurrentRevision,
  type ArchiveLiteralRelation,type ArchiveSuggestedCheckRelation,
  type HistoricalAuthorNoteState,
} from "../domain/editorial-archive-comparison";

const RELATION:Record<ArchiveLiteralRelation,string>={
  same_literal_anchor:"Stessa citazione, stessa posizione letterale",
  relocated_literal_quote:"Stessa citazione, posizione differente: possibile riferimento",
  ambiguous_literal_candidates:"Più corrispondenze letterali: riferimento ambiguo",
  not_observed_in_current_sample:"Non individuato nel campione corrente (non significa risolto)",
  archive_source_unverifiable:"Fonte storica non confrontabile in modo affidabile",
};
const CHECK:Record<ArchiveSuggestedCheckRelation,string>={
  same_words:"Prova mancante e controllo formulati con le stesse parole",
  changed_words:"Prova mancante o controllo formulati diversamente",
  awaiting_judge:"Nuovo giudice non ancora espresso su questo confronto",
  not_comparable:"Nessun confronto affidabile dei controlli del giudice",
};
const NOTE:Record<HistoricalAuthorNoteState,string>={
  none:"Nessuna annotazione storica associabile",
  taken_on:"Presa in carico nello storico (non trasferita alla nuova tornata)",
  dismissed:"Respinta nello storico (non trasferita alla nuova tornata)",
  reset:"Scelta storica azzerata (non trasferita)",
  ambiguous_or_stale:"Nota storica non associabile in sicurezza",
};
/** Read-only and outside agent prompts. It never marks an old check as
 * resolved, copies author decisions or offers a repair/reopen action. */
export function EditorialArchiveComparisonPanel({book,chapter,cycle}:{
  book:BookProject;chapter:Chapter;cycle:ChapterEditorialCycle;
}){
  const comparison=useMemo(()=>
    compareEditorialArchiveToCurrentRevision(book,chapter,cycle),
    [book,chapter,cycle]);
  if(!comparison.totalArchiveChecks)return null;
  return <section aria-label="Confronto verifiche con archivio"
    className="min-w-0 space-y-3 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
    <h3 className="font-semibold">Confronto verifiche storiche e nuova revisione</h3>
    <p className="muted text-xs">Il confronto è locale e soltanto letterale:
      cerca le stesse citazioni nella stessa scena e categoria. La somiglianza
      non dimostra che i rilievi descrivano lo stesso problema. La mancata
      corrispondenza non dimostra che un problema sia stato risolto.
      Le note private dell'autore restano storiche e non vengono riutilizzate
      nel nuovo giudizio o inviate agli agenti.</p>
    <p className="text-xs">
      {comparison.totalArchiveChecks} controlli irrisolti nell'archivio ·
      {" "}{comparison.currentGroupsCompared} gruppi letterali esaminati nella
      nuova tornata · {comparison.currentReportCount} report correnti.
    </p>
    {(comparison.omittedArchiveChecks>0||
      comparison.currentUnreviewableFindingCount>0)&&
      <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
        Copertura parziale: {comparison.omittedArchiveChecks} controlli storici
        non mostrati oltre il limite di 24;
        {" "}{comparison.currentUnreviewableFindingCount} rilievi nuovi fuori
        campione ({comparison.currentOmittedGroupCount} gruppi omessi e
        {" "}{comparison.currentOversizedGroupCount} sovradimensionati).
        Nessuna voce omessa è considerata risolta.</p>}
    <div className="space-y-2">
      {comparison.items.map(item=><details key={item.key}
        className="min-w-0 rounded border border-slate-300 p-2 text-xs dark:border-slate-700">
        <summary className="cursor-pointer break-words font-semibold">
          Archivio tornata {item.archiveRound} · {item.category||"Categoria non nota"}
          {" · "}{RELATION[item.relation]}
        </summary>
        <div className="mt-2 space-y-2 break-words">
          <p><b>Scena storica:</b> {item.sceneId||"Sconosciuta"}</p>
          <p className="whitespace-pre-wrap"><b>Citazione storica:</b> «{item.quote}»</p>
          <p className="whitespace-pre-wrap"><b>Prova mancante allora:</b>
            {" "}{item.oldMissingEvidence}</p>
          <p className="whitespace-pre-wrap"><b>Controllo suggerito allora:</b>
            {" "}{item.oldNextCheck}</p>
          <p><b>Rapporto testuale:</b> {RELATION[item.relation]}.
            Non è una valutazione semantica né una verifica completata.</p>
          <p><b>Confronto dei suggerimenti:</b> {CHECK[item.suggestedCheckRelation]}.</p>
          {item.current&&<>
            <p><b>Nuova tornata:</b> {item.current.round} ·
              {" "}{item.current.status==="needs_evidence"?"Prove ancora insufficienti":
                item.current.status==="awaiting_judge"?"In attesa del giudice":
                item.current.status==="approved_edit"?"Correzione approvata dal giudice":
                item.current.status==="closed_no_edit"?"Nessuna modifica approvata":
                "Da rivalidare"}.
              Questa etichetta non è una conclusione sul problema storico.</p>
            {item.current.missingEvidence&&<p className="whitespace-pre-wrap">
              <b>Prova mancante nella nuova tornata:</b>
              {" "}{item.current.missingEvidence}</p>}
            {item.current.nextCheck&&<p className="whitespace-pre-wrap">
              <b>Controllo suggerito adesso (non eseguito):</b>
              {" "}{item.current.nextCheck}</p>}
          </>}
          <p><b>Annotazione dell'autore:</b> {NOTE[item.authorNoteState]}.</p>
          {item.authorNoteRationale&&<p className="whitespace-pre-wrap">
            <b>Motivazione privata storica:</b> {item.authorNoteRationale}</p>}
          {item.authorNoteState!=="none"&&<p className="muted">
            L'archivio non conserva l'identità originaria della congelazione
            dopo la riapertura: una nota compatibile con lo snapshot non
            certifica l'esatta provenienza. Nessuna scelta viene trasferita.</p>}
        </div>
      </details>)}
    </div>
  </section>;
}
