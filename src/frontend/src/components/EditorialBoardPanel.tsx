import { useState } from "react";
import { BookCheck, RotateCcw, ShieldAlert, Users } from "lucide-react";
import type { BookProject, Chapter } from "../domain/types";
import { NarrativeEventDecisionsPanel } from "./NarrativeEventDecisionsPanel";
import { EditorialVerificationPlanPanel } from "./EditorialVerificationPlanPanel";
import { EDITORIAL_ROLES, ROLE_LABELS, acceptedRepairs,
  buildEditorialRecommendationDisagreements, isNarrativeEvidenceAnchorCurrent, type EditorialRound,
  type EditorialReport, type EditorialJudgment } from "../domain/editorial-board";
import { reopenChapterReview } from "../application/editorial-control";
import { Button } from "./ui/button";
import { HistoricalResearchPanel } from "./HistoricalResearchPanel";
import { HistoricalSourceRelationsPanel } from "./HistoricalSourceRelationsPanel";
import { BibliographyPanel } from "./BibliographyPanel";
import { ArchiveCatalogPanel } from "./ArchiveCatalogPanel";
import { LocOcrPanel } from "./LocOcrPanel";
import { LocIiifPanel } from "./LocIiifPanel";
import type { HistoricalSource } from "../domain/historical-research";
import { activeManualEvidence, allManualEvidence, type ManualDocumentExcerpt } from "../domain/manual-evidence";
import { ManualEvidencePanel } from "./ManualEvidencePanel";
import { WikisourcePanel } from "./WikisourcePanel";
import { allWikisourceExcerpts, activeWikisourceExcerpts,
  wikisourceRevisionUrl, type WikisourceExcerpt } from "../domain/wikisource-excerpts";

function RoundDetails({ round, reports, judgment, chapter, sources = [], manualSources = [], activeManualIds = [],
  wikisourceSources = [], activeWikisourceIds = [] }: {
  round: number; reports: EditorialReport[]; judgment?: EditorialJudgment; chapter: Chapter;
  sources?: HistoricalSource[];
  manualSources?: ManualDocumentExcerpt[];
  activeManualIds?: string[];
  wikisourceSources?: WikisourceExcerpt[];
  activeWikisourceIds?: string[];
}) {
  const judged = new Map((judgment?.decisions ?? []).map(d => [d.findingId,d]));
  const findings = reports.flatMap(r => r.findings);
  const discrepancies=buildEditorialRecommendationDisagreements({reports},chapter);
  const corrections=new Map((judgment?.recommendationReconciliations??[])
    .map(x=>[JSON.stringify([...x.findingIds].sort()),x]));
  return <div className="space-y-3">
    <p className="text-sm font-semibold">Tornata {round} · {reports.length} verifiche · {findings.length} rilievi</p>
    <div className="space-y-2">
      {EDITORIAL_ROLES.map(role => {
        const own = reports.filter(r => r.role === role);
        return <details key={role} className="rounded-lg border border-slate-300 p-3 text-xs dark:border-slate-700">
          <summary className="cursor-pointer font-semibold">
            {ROLE_LABELS[role]} · {own.length} esami · {own.reduce((n,r)=>n+r.findings.length,0)} rilievi
          </summary>
          {!own.length && <p className="muted mt-2">Revisore ancora da eseguire.</p>}
          {own.map(report => <div key={report.role + ":" + report.segmentIndex} className="mt-3 space-y-2 border-t border-slate-300 pt-2 dark:border-slate-700">
            <p><b>Segmento {report.segmentIndex + 1}/{report.segmentCount}:</b> {report.summary}</p>
            {!report.findings.length && <p className="text-emerald-700 dark:text-emerald-300">Nessun problema segnalato.</p>}
            {report.findings.map(f => {
              const ruling = judged.get(f.id);
              const quoteVerified = isNarrativeEvidenceAnchorCurrent(chapter,f);
              return <div key={f.id} className="space-y-1 rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <p className="font-semibold">{f.severity.toUpperCase()} · {f.category} · Scena {f.sceneId}</p>
                <p><b>Prova:</b> {f.evidence}</p>
                {quoteVerified && f.evidenceAnchor ? <div className="space-y-1 rounded border border-emerald-600/40
                  p-2 break-words" aria-label={"Prova narrativa verificata " + f.id}>
                  <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                    Citazione letterale nel segmento {f.evidenceAnchor.segmentIndex + 1}
                    {" "}· offset {f.evidenceAnchor.offset}
                    {f.evidenceAnchor.occurrences > 1 ?
                      " · " + f.evidenceAnchor.occurrences + " occorrenze (prima mostrata)" : ""}
                  </p>
                  <p className="whitespace-pre-wrap"><b>Testo trovato:</b> “{f.evidenceAnchor.quote}”</p>
                  <p className="whitespace-pre-wrap muted"><b>Contesto:</b> {f.evidenceAnchor.context}</p>
                  <p className="muted">Corrispondenza di testo, NON prova della fondatezza della critica.</p>
                </div> : <p className="text-amber-700 dark:text-amber-300">
                  Report precedente, modificato o senza ancoraggio valido: la prova narrativa non è confermata nel segmento attuale.
                  Una nuova correzione richiede una review verificata.
                </p>}
                {f.priorSceneConflict && <div className="rounded border border-amber-400/50
                  p-2 break-words" aria-label={"Ipotesi da scena precedente " + f.id}>
                  <p className="font-semibold">Confronto con prosa precedente NON attestata</p>
                  <p><b>Dimensione:</b> {f.priorSceneConflict.dimension}</p>
                  <p><b>Fonte:</b> {f.priorSceneConflict.chapterId} / {f.priorSceneConflict.sceneId};
                    {" "}offset {f.priorSceneConflict.offset}</p>
                  <p><b>Citazione precedente:</b> «{f.priorSceneConflict.quote}»</p>
                  <p><b>Ipotesi:</b> {f.priorSceneConflict.hypothesis}</p>
                  <p className="muted">La frase è soltanto prosa verificata, non
                    una conferma di evento, cronologia o identità. Il giudice
                    può respingere il rilievo. Fonte rivalidata prima del repair.</p>
                </div>}
                {f.narrativeConflict && <div className="rounded border border-amber-400/50
                  p-2 break-words" aria-label={"Ipotesi di conflitto narrativo " + f.id}>
                  <p className="font-semibold">Ipotesi narrativa attestata, non contraddizione accertata</p>
                  <p><b>Dimensione:</b> {f.narrativeConflict.dimension}</p>
                  <p><b>Fonte precedente:</b> {f.narrativeConflict.priorEventDecisionId}</p>
                  <p><b>Ipotesi dello specialista:</b> {f.narrativeConflict.hypothesis}</p>
                  <p className="muted">Solo il giudice può valutare il contesto e approvare o
                    respingere la remediation. La fonte è un'annotazione, non un fatto certificato.</p>
                </div>}
                <p><b>Problema:</b> {f.reason}</p>
                <p><b>Remediation proposta:</b> {f.remediation}</p>
                {f.historical && <div className="space-y-1 rounded-md border border-slate-300 p-2 dark:border-slate-700">
                  <p><b>Accertamento storico:</b> {f.historical.assessment === "consistent_with_excerpt"
                    ? "Coerente con l'estratto (non certificato)" :
                    f.historical.assessment === "contradicts_excerpt"
                      ? "Potenziale contraddizione con l'estratto" :
                    f.historical.assessment === "conflicting_excerpts"
                      ? "Possibile divergenza fra fonti (interpretazione NON certificata)" :
                        "Non verificato con documenti"}</p>
                  <p><b>Affermazione:</b> {f.historical.claim}</p>
                  {f.historical.sourcePositions?.map(position => <p key={position.sourceId}
                    className="whitespace-pre-wrap text-amber-800 dark:text-amber-300">
                    <b>Interpretazione {position.sourceId} — {position.position === "supports"
                      ? "sembra sostenere" : position.position === "disputes"
                        ? "sembra contraddire" : "contesto incerto"}:</b> {position.rationale}
                  </p>)}
                  {f.historical.assessment === "conflicting_excerpts" && <p className="muted">
                    Le posizioni sono proposte dal revisore: una citazione letterale non dimostra
                    incompatibilità storica. Consulta il contesto completo e il giudizio critico.
                  </p>}
                  {f.historical.conflictContext ? <div className="mt-2 space-y-2 rounded-md
                    border border-amber-400/50 p-2 break-words" aria-label="Contesto del conflitto">
                    <p className="font-semibold">Confronto di evento, periodo, luogo ed edizione
                      (valutazioni del revisore, non verificate)</p>
                    <p><b>Identità dell'evento proposta:</b> {f.historical.conflictContext.comparison.eventIdentity
                      === "same" ? "Probabilmente lo stesso" :
                      f.historical.conflictContext.comparison.eventIdentity === "different"
                        ? "Eventi differenti" : "Non determinabile"}</p>
                    <p className="whitespace-pre-wrap">{f.historical.conflictContext.comparison.rationale}</p>
                    {f.historical.conflictContext.sources.map(scope=><div key={scope.sourceId}
                      className="border-t border-slate-300 pt-2 dark:border-slate-700">
                      <p className="font-semibold">Fonte {scope.sourceId}</p>
                      <p><b>Evento/oggetto:</b> {scope.subject ?? "Non determinato"}</p>
                      <p><b>Periodo:</b> {scope.period ?? "Non determinato"}</p>
                      <p><b>Luogo:</b> {scope.place ?? "Non determinato"}</p>
                      <p><b>Edizione/versione:</b> {scope.edition ?? "Non determinata"}</p>
                      <p className="whitespace-pre-wrap"><b>Incertezza:</b> {scope.uncertainty}</p>
                    </div>)}
                  </div> : f.historical.assessment === "conflicting_excerpts" ?
                    <p className="muted">Report legacy privo di verifica esplicita del contesto:
                      l'evento, la data, il luogo e l'edizione restano da controllare.</p> : null}
                  {f.historical.sourceQuote && <p><b>Citazione legacy (singola fonte):</b> “{f.historical.sourceQuote}”</p>}
                  {f.historical.sourceIds.map(id => {
                    const source = sources.find(s => s.id === id);
                    const manual = manualSources.find(s => s.id === id);
                    const wikisource = wikisourceSources.find(s => s.id === id);
                    const evidence = f.historical?.sourceEvidence?.find(entry => entry.sourceId === id);
                    return wikisource ? <div key={id} className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700">
                      <p><b>Wikisource: trascrizione collaborativa NON autenticata:</b>{" "}
                        <a href={wikisourceRevisionUrl(wikisource.revisionId)}
                          className="text-blue-700 underline dark:text-blue-300"
                          target="_blank" rel="noopener noreferrer">{wikisource.title}</a>
                        {" "}(revisione {wikisource.revisionId}, diritti originali da verificare)</p>
                      {evidence&&<p className="mt-1 whitespace-pre-wrap">
                        <b>Citazione associata alla trascrizione:</b> “{evidence.quote}”
                      </p>}
                      <p className="muted">Confrontata con il frammento della revisione richiesta, non con l'originale storico.
                        {wikisource.revisionProof ? " SHA-256 wikitesto: " + wikisource.revisionProof.contentSha256.slice(0,16) + "…" :
                          " Vecchia fonte v0.9.5 priva di prova per la revisione."}</p>
                      {!activeWikisourceIds.includes(id)&&<p className="text-amber-700 dark:text-amber-300">
                        Revisione conservata per audit, non più attiva per nuove review.
                      </p>}
                    </div> : manual ? <div key={id} className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700">
                      <p><b>Trascrizione dell'autore, NON autenticata:</b>{" "}
                        <a className="text-blue-700 underline dark:text-blue-300" href={manual.url}
                          rel="noopener noreferrer" target="_blank">{manual.title}</a>
                        {" "}(collocazione: {manual.locator}; diritti dichiarati: {manual.rightsBasis})</p>
                      {evidence && <p className="mt-1 whitespace-pre-wrap"><b>Citazione nella trascrizione:</b> “{evidence.quote}”</p>}
                      <p className="muted">Il software ha confrontato la citazione solo con il testo immesso dall'autore.</p>
                      {!activeManualIds.includes(id) && <p className="text-amber-700 dark:text-amber-300">
                        Snapshot storico: oggi non attivo per nuove citazioni.
                      </p>}
                    </div> : source ? <div key={id} className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700">
                      <p><b>Fonte terziaria:</b>{" "}
                        <a className="text-blue-700 underline dark:text-blue-300" href={source.revisionId ? "https://it.wikipedia.org/w/index.php?oldid=" + source.revisionId : source.url}
                          rel="noopener noreferrer" target="_blank">{source.title}</a>
                        {" "}(revisione {source.revisionId ?? "non nota"})</p>
                      {evidence && <p className="mt-1 whitespace-pre-wrap"><b>Citazione associata:</b> “{evidence.quote}”</p>}
                      {!evidence && (f.historical?.sourceIds.length ?? 0) > 1 &&
                        <p className="text-amber-700 dark:text-amber-300">
                          Report precedente privo di citazione individuale: non considerare questa fonte corroborante.
                        </p>}
                    </div>
                      : <p key={id} className="text-amber-700 dark:text-amber-300">
                          Fonte citata non più reperibile nel dossier: {id}
                        </p>;
                  })}
                </div>}
                {ruling ? <div className="border-t border-slate-300 pt-2 dark:border-slate-700">
                  <p className={ruling.action === "reject" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>
                    <b>Giudice: {ruling.action === "accept" ? "Accettato" : "Respinto"}</b>
                  </p>
                  <p><b>Perché:</b> {ruling.rationale}</p>
                  {ruling.narrativeReview && <div className="mt-2 space-y-1 rounded border
                    border-slate-300 p-2 break-words dark:border-slate-700"
                    aria-label="Giudizio narrativo strutturato">
                    <p className="font-semibold">Analisi narrativa indipendente — {
                      ruling.narrativeReview.assessment === "supported_conflict"
                        ? "incoerenza plausibilmente supportata" :
                        ruling.narrativeReview.assessment === "explained_or_nonconflicting"
                          ? "spiegazione alternativa" : "prove insufficienti"}</p>
                    <p><b>Identità:</b> {ruling.narrativeReview.subjectIdentity} —
                      {" "}{ruling.narrativeReview.identityReason}</p>
                    <p><b>Cronologia:</b> {ruling.narrativeReview.chronology} —
                      {" "}{ruling.narrativeReview.chronologyReason}</p>
                    <p><b>Causalità:</b> {ruling.narrativeReview.causality} —
                      {" "}{ruling.narrativeReview.causalityReason}</p>
                    <p><b>Contesto artistico:</b> {ruling.narrativeReview.artisticContext} —
                      {" "}{ruling.narrativeReview.artisticReason}</p>
                    <p><b>Conclusione critica:</b> {ruling.narrativeReview.conclusion}</p>
                    <p className="muted">Valutazioni fallibili del giudice, non conferma del canone.</p>
                  </div>}
                  {ruling.knowledgeReview && <div className="mt-2 space-y-1 rounded border
                    border-slate-300 p-2 break-words dark:border-slate-700"
                    aria-label="Valutazione percorso delle conoscenze">
                    <p className="font-semibold">Come ha appreso l'informazione? — {
                      ruling.knowledgeReview.assessment === "supported_knowledge_conflict"
                        ? "possibile incompatibilità motivata" : "conoscenza non dimostrata"}</p>
                    <p><b>Citazione precedente:</b> {ruling.knowledgeReview.priorClaimMode} —
                      {" "}{ruling.knowledgeReview.priorReason}</p>
                    <p><b>Citazione corrente:</b> {ruling.knowledgeReview.currentClaimMode} —
                      {" "}{ruling.knowledgeReview.currentReason}</p>
                    <p><b>Accesso all'informazione:</b> {ruling.knowledgeReview.accessPath} —
                      {" "}{ruling.knowledgeReview.accessReason}</p>
                    <p><b>Conclusione:</b> {ruling.knowledgeReview.conclusion}</p>
                    <p className="muted">Un nome o una voce non provano che il personaggio sappia davvero un segreto.
                      La valutazione del giudice non modifica il canone.</p>
                  </div>}
                  {ruling.informationTransferReview && <div className="mt-2 space-y-1 rounded border
                    border-slate-300 p-2 break-words dark:border-slate-700"
                    aria-label="Esame dei possibili passaggi informativi">
                    <p className="font-semibold">Possibili comunicazioni precedenti — non fatti accertati</p>
                    {ruling.informationTransferReview.candidateAssessments.map(assessment=>
                      <div key={assessment.candidateId} className="border-t border-slate-300 pt-1
                        dark:border-slate-700">
                        <p><b>Pista:</b> {assessment.candidateId}</p>
                        <p><b>Valutazione:</b> {assessment.disposition==="possible_path"
                          ? "Possibile percorso della notizia" :
                          assessment.disposition==="unrelated" ? "Non pertinente" :
                            assessment.disposition==="unreliable_report" ?
                              "Racconto non attendibile" : "Non determinabile"}</p>
                        <p><b>Motivazione:</b> {assessment.rationale}</p>
                      </div>)}
                    <p><b>Conclusione del giudice:</b> {ruling.informationTransferReview.conclusion}</p>
                    <p className="muted">I riferimenti corrispondono a citazioni di scene precedenti;
                      non dimostrano né la consegna né la comprensione del messaggio.</p>
                  </div>}
                  {ruling.conflictReview && <div className="mt-2 space-y-1 rounded border
                    border-slate-300 p-2 break-words dark:border-slate-700"
                    aria-label="Controllo critico del direttore">
                    <p className="font-semibold">Verifica critica del direttore — evento: {
                      ruling.conflictReview.eventIdentity === "same" ? "forse identico" :
                      ruling.conflictReview.eventIdentity === "different" ? "differente" : "incerto"}</p>
                    <p><b>Cronologia:</b> {ruling.conflictReview.chronology}</p>
                    <p><b>Geografia:</b> {ruling.conflictReview.geography}</p>
                    <p><b>Edizione:</b> {ruling.conflictReview.edition}</p>
                    <p><b>Indipendenza:</b> {ruling.conflictReview.independence}</p>
                    <p><b>Conclusione:</b> {ruling.conflictReview.conclusion}</p>
                  </div>}
                  {ruling.action === "accept" && <p><b>Correzione approvata:</b> {ruling.remediation}</p>}
                </div> : <p className="muted">In attesa del giudizio editoriale.</p>}
              </div>;
            })}
          </div>)}
        </details>;
      })}
    </div>
    {(discrepancies.groups.length>0||discrepancies.unreviewableFindingIds.length>0)&&
      <section aria-label="Divergenze tra raccomandazioni"
        className="space-y-2 rounded-lg border border-slate-300 p-3 text-xs dark:border-slate-700">
        <h3 className="font-semibold">Correzioni alternative sulla stessa citazione</h3>
        <p className="muted">
          Le proposte differenti non sono voti contrari né dimostrano una
          contraddizione nel romanzo. Il giudice deve esaminarle separatamente:
          una citazione valida prova soltanto che il testo esiste.
        </p>
        {discrepancies.groups.map(g=>{
          const review=corrections.get(JSON.stringify([...g.findingIds].sort()));
          return <details key={JSON.stringify(g.findingIds)}
            className="rounded border border-slate-300 p-2 dark:border-slate-700">
            <summary className="cursor-pointer font-semibold">
              Scena {g.sceneId}, segmento {g.segmentIndex+1} · {g.category}
              {" "}· {g.recommendations.length} proposte
            </summary>
            <p className="mt-2 break-words"><b>Fonte letterale:</b> «{g.quote}»</p>
            <ul className="mt-2 space-y-2">
              {g.recommendations.map(rec=><li key={rec.findingId}
                className="rounded border border-slate-200 p-2 dark:border-slate-700">
                <p><b>{ROLE_LABELS[rec.role]}</b> · {rec.severity}</p>
                <p><b>Motivo:</b> {rec.reason}</p>
                <p><b>Intervento suggerito:</b> {rec.proposedEdit}</p>
                <p className="muted">Rilievo {rec.findingId}</p>
              </li>)}
            </ul>
            {review?<div className="mt-2 space-y-1 border-t border-slate-300 pt-2
              dark:border-slate-700">
              <p className="font-semibold">Riconciliazione del giudice — {
                review.resolution==="reject_all"?"nessuna modifica":
                review.resolution==="choose_one"?"una proposta scelta":
                "più modifiche ritenute compatibili"}</p>
              <p><b>Valutazione delle prove:</b> {
                review.evidenceAssessment==="unresolved"?"non risolta":
                "ritenute sufficienti per gli interventi scelti"}</p>
              <p><b>Motivazione:</b> {review.rationale}</p>
              <p><b>Prova mancante o limite:</b> {review.missingEvidence}</p>
              <p><b>Prossimo controllo suggerito:</b> {review.nextCheck}</p>
              <p className="muted">Il controllo è un suggerimento: non viene
                eseguito automaticamente e non modifica il canone.</p>
            </div>:<p className="muted mt-2">
              Il giudice non ha ancora riconciliato le proposte di questa tornata.
            </p>}
          </details>;
        })}
        {discrepancies.unreviewableFindingIds.length>0&&<p
          className="text-amber-700 dark:text-amber-300">
          Copertura parziale: {discrepancies.omittedGroupCount} gruppi omessi,
          {" "}{discrepancies.oversizedGroupCount} gruppi troppo estesi.
          Non autorizzare correzioni di questi rilievi senza esame manuale.
        </p>}
      </section>}
    {judgment && <div className="space-y-2 rounded-lg border border-slate-300 p-3 text-xs dark:border-slate-700">
      <p className="font-semibold">Decisione finale: {judgment.verdict === "freeze" ? "Nessun rilievo accettato: può congelare" : "Sono richieste correzioni"}</p>
      <p className="whitespace-pre-wrap">{judgment.reasoning}</p>
      {judgment.authorTransferCritique&&<section
        aria-label="Confronto critico con le piste dell'autore"
        className="mt-2 space-y-2 rounded border border-slate-300 p-2 dark:border-slate-700">
        <p className="font-semibold">Confronto indipendente con le piste autorizzate</p>
        <p className="muted">
          Sono interpretazioni fallibili: nessuna citazione prova ricezione,
          conoscenza, cronologia o verità. Il giudice può dissentire dall'autore
          senza modificare automaticamente il canone.
        </p>
        {judgment.authorTransferCritique.witnessAssessments.map((item,index)=>
          <div key={index} className="min-w-0 break-words border-t border-slate-300 pt-2
            dark:border-slate-700">
            <p>Capitolo {item.chapterNumber}, scena {item.sceneNumber},
              {" "}offset {item.offset} · {item.sender} → {item.recipient}</p>
            <p className="mt-1 break-words">«{item.quote}»</p>
            <p><b>Interpretazione dell'autore:</b> {
              item.authorVerdict==="author_attested_report"
                ?"Comunicazione descritta secondo l'autore" :
              item.authorVerdict==="possible_path"?"Pista possibile":
                "Pista respinta"}</p>
            <p><b>Lettura indipendente del giudice:</b> {
              item.judgeReading==="possible_access"?"Accesso possibile":
              item.judgeReading==="unreliable_or_unrelated"
                ?"Fonte inattendibile o non pertinente":"Accesso indeterminato"}</p>
            <p><b>Confronto:</b> {
              item.relationToAuthor==="agrees"?"Concorda":
              item.relationToAuthor==="challenges"?"Contesta":"Non decide"}
              {" — "}{item.rationale}</p>
          </div>)}
        <p><b>Conclusione del giudice:</b> {
          judgment.authorTransferCritique.conclusion}</p>
      </section>}
    </div>}
  </div>;
}

export function EditorialBoardPanel({
  book, onRefresh,
}: { book: BookProject; onRefresh: () => Promise<void> }) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const cycle = book.editorialCycle;
  const chapter = cycle && book.chapters.find(ch => ch.id === cycle.chapterId);
  const completedReports = cycle?.reports.length ?? 0;
  const totalSlots = cycle?.reports[0]?.segmentCount ?
    cycle.reports[0].segmentCount * EDITORIAL_ROLES.length : null;
  const pending = cycle?.judgment ? acceptedRepairs(cycle).length : 0;

  async function reopen(chapterId: string) {
    if (busy || book.status === "running") return;
    if (!window.confirm(
      "Vuoi riaprire questo capitolo alla redazione? Il capitolo e i successivi " +
      "perderanno il congelamento fino a nuova approvazione. La review può consumare molte chiamate AI. " +
      "Autosync sarà disabilitato e la coda remota cancellata.",
    )) return;
    setBusy(true);setError("");setMessage("");
    try {
      await reopenChapterReview(book.id, chapterId, instruction);
      setInstruction("");
      setMessage("Capitolo riaperto. Premi Riprendi nella barra dell'autopilot per cominciare il panel.");
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile riaprire il capitolo.");
    } finally { setBusy(false); }
  }

  return <section aria-label="Redazione multi-agente" className="panel min-w-0 p-4 sm:p-5">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Users size={19}/> Redazione multi-agente</h2>
    <p className="muted mt-1 text-xs">
      Sette specialisti e cinque lettori in chiamate AI separate. Ogni rilievo include prova, gravità e remediation;
      il direttore può accettarlo o respingerlo motivando. Ogni capitolo completo deve essere congelato prima di avanzare.
      I capitoli dopo modifiche retroattive richiedono una nuova review, con campioni identificati delle scene precedenti.
    </p>
    {cycle && chapter && <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <p className="font-semibold">Capitolo {chapter.number}: {chapter.title}</p>
        <p className="mt-1">Tornata {cycle.round}/3 · Fase: {
          cycle.stage === "review" ? "12 revisori indipendenti" :
          cycle.stage === "adjudicate" ? "Giudizio critico" :
          cycle.stage === "repair" ? "Remediation mirate" :
          cycle.stage === "reconcile" ? "Riconciliazione del canon" :
          cycle.stage === "summary" ? "Sinossi e congelamento" : "Bloccato in attesa dell'autore"}</p>
        {chapter.continuityRecheck && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Rivalidazione obbligatoria: {chapter.continuityRecheck.trigger === "historical_evidence"
            ? "fonti storiche aggiornate nel capitolo "
            : "modifica narrativa dal capitolo "}
          {chapter.continuityRecheck.originChapterNumber}.
          La redazione recupererà campioni mirati delle scene precedenti già congelate,
          anche nei capitoli intermedi, usando entità, parole e date esplicite.
          Il ranking locale non dimostra una contraddizione e la copertura può essere parziale.
        </p>}
        <p className="muted text-xs">
          Verifiche completate: {completedReports}{totalSlots ? "/" + totalSlots : ""}.
          {cycle.judgment && " Correzioni approvate: " + pending + "."}
        </p>
      </div>
      {cycle.stage === "blocked" && <div className="space-y-2 rounded-lg border border-amber-500/40 p-3">
        <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={18} className="shrink-0"/> {cycle.blockedReason}
        </p>
        <label className="block text-sm font-semibold">
          Istruzione dell'autore per una nuova tornata
          <textarea className="field mt-1 min-h-24" value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder="Accetta questa eccezione perché… oppure cambia la voce e riesamina i capitoli…"/>
        </label>
        <Button disabled={busy || instruction.trim().length < 12}
          onClick={() => void reopen(chapter.id)}>
          <RotateCcw size={16}/> Riparti con i nuovi vincoli
        </Button>
      </div>}
      <EditorialVerificationPlanPanel book={book} cycle={cycle} chapter={chapter}/>
      <RoundDetails round={cycle.round} reports={cycle.reports} judgment={cycle.judgment}
        chapter={chapter} sources={chapter.historicalDossier?.sources}
        manualSources={allManualEvidence(chapter.historicalDossier)}
        activeManualIds={activeManualEvidence(chapter.historicalDossier).map(x=>x.id)}
        wikisourceSources={allWikisourceExcerpts(chapter.historicalDossier)}
        activeWikisourceIds={activeWikisourceExcerpts(chapter.historicalDossier).map(x=>x.id)}/> 
      {cycle.priorRounds.map(round => <details key={round.round} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
        <summary className="cursor-pointer text-sm font-semibold">Storico della tornata {round.round}</summary>
        <div className="mt-3"><RoundDetails {...round} chapter={chapter} sources={chapter.historicalDossier?.sources}
          manualSources={allManualEvidence(chapter.historicalDossier)}
          activeManualIds={activeManualEvidence(chapter.historicalDossier).map(x=>x.id)}
          wikisourceSources={allWikisourceExcerpts(chapter.historicalDossier)}
          activeWikisourceIds={activeWikisourceExcerpts(chapter.historicalDossier).map(x=>x.id)}/></div>
      </details>)}
    </div>}
    <NarrativeEventDecisionsPanel key={book.id} book={book} onRefresh={onRefresh}/>
    {book.chapters.length > 0 && <div className="mt-4 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><BookCheck size={17}/> Stato dei capitoli</h3>
      {book.chapters.map(ch => <div key={ch.id} className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{ch.number}. {ch.title}</p>
            <p className="muted text-xs">{ch.frozenAt ?
              "Congelato il " + new Date(ch.frozenAt).toLocaleString("it-IT") :
              cycle?.chapterId === ch.id ? "In review" : "Non ancora congelato"}</p>
          </div>
          {ch.scenes.length > 0 && ch.scenes.every(s => !!s.text.trim() && s.status !== "planned") &&
            <Button size="sm" variant="outline" disabled={busy || book.status === "running" || !!(cycle && cycle.stage !== "blocked")}
              onClick={() => void reopen(ch.id)}><RotateCcw size={15}/> Rivaluta</Button>}
        </div>
        {ch.continuityRecheck && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300"
          aria-label={"Rivalidazione capitolo " + ch.number}>
          <b>Rivalidazione obbligatoria:</b> {ch.continuityRecheck.trigger === "historical_evidence"
            ? "dossier storico modificato nel capitolo "
            : "modifica a monte nel capitolo "}
          {ch.continuityRecheck.originChapterNumber}. Verificare segreti, timeline,
          personaggi e causa-effetto con i dodici agenti prima del nuovo congelamento.
          I capitoli precedenti vanno approvati in ordine.
          Il confronto recupera scene pertinenti anche nei capitoli intermedi, con
          campioni testuali limitati: la pertinenza non prova una contraddizione.
        </p>}
        {ch.frozenAt && ch.lastContinuityReview && <p className="mt-2 text-xs muted"
          aria-label={"Storico rivalidazione capitolo " + ch.number}>
          Rivalidazione editoriale completata dopo {ch.lastContinuityReview.trigger === "historical_evidence"
            ? "l'aggiornamento delle fonti del capitolo "
            : "la modifica al capitolo "}
          {ch.lastContinuityReview.originChapterNumber} il
          {" "}{new Date(ch.lastContinuityReview.completedAt).toLocaleString("it-IT")}.
          {ch.lastContinuityReview.retrievalMethod === "local_structured_lexical_v1"
            ? " Recupero mirato locale: " +
              ch.lastContinuityReview.sampledSceneIds.length + " scene selezionate su " +
              (ch.lastContinuityReview.candidateSceneCount ?? 0) + " precedenti; " +
              (ch.lastContinuityReview.unscannedSceneCount ?? 0) +
              " non esaminate dal ranking per limite operativo."
            : ""}
          {ch.lastContinuityReview.partialCoverage
            ? " Il confronto campiona solo alcune scene o finestre, non tutta la continuità."
            : " I campioni identificati non certificano coerenza semantica."}
        </p>}
        {ch.summary && <details className="mt-2">
          <summary className="cursor-pointer text-xs">Sinossi del capitolo</summary>
          <p className="mt-2 whitespace-pre-wrap text-xs">{ch.summary}</p>
        </details>}
        <HistoricalResearchPanel key={ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <HistoricalSourceRelationsPanel key={"relations-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <BibliographyPanel key={"doi-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <ArchiveCatalogPanel key={"archive-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <LocOcrPanel key={"ocr-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <LocIiifPanel key={"iiif-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <WikisourcePanel key={"wikisource-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <ManualEvidencePanel key={"excerpts-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        {(ch.editorialRounds?.length ?? 0) > 0 && <details className="mt-2">
          <summary className="cursor-pointer text-xs">Giudizi archiviati ({ch.editorialRounds?.length})</summary>
          <div className="mt-3">
            <EditorialVerificationPlanPanel book={book} chapter={ch}
              cycle={{
                chapterId:ch.id,round:1,stage:"blocked",reports:[],
                repairCursor:0,priorRounds:ch.editorialRounds??[],
              }}/>
          </div>
          {ch.editorialRounds?.map((round, i) =>
            <div key={i} className="mt-3"><RoundDetails {...round} chapter={ch} sources={ch.historicalDossier?.sources}
                manualSources={allManualEvidence(ch.historicalDossier)}
                activeManualIds={activeManualEvidence(ch.historicalDossier).map(x=>x.id)}
                wikisourceSources={allWikisourceExcerpts(ch.historicalDossier)}
                activeWikisourceIds={activeWikisourceExcerpts(ch.historicalDossier).map(x=>x.id)}/></div>)}
        </details>}
      </div>)}
    </div>}
    {!cycle && !book.chapters.length && <p className="muted mt-3 text-sm">L'editorial board si attiva dopo la stesura del primo capitolo.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
