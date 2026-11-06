import { useState } from "react";
import { BookCheck, RotateCcw, ShieldAlert, Users } from "lucide-react";
import type { BookProject } from "../domain/types";
import { EDITORIAL_ROLES, ROLE_LABELS, acceptedRepairs, type EditorialRound,
  type EditorialReport, type EditorialJudgment } from "../domain/editorial-board";
import { reopenChapterReview } from "../application/editorial-control";
import { Button } from "./ui/button";
import { HistoricalResearchPanel } from "./HistoricalResearchPanel";
import { BibliographyPanel } from "./BibliographyPanel";
import { ArchiveCatalogPanel } from "./ArchiveCatalogPanel";
import type { HistoricalSource } from "../domain/historical-research";
import { activeManualEvidence, allManualEvidence, type ManualDocumentExcerpt } from "../domain/manual-evidence";
import { ManualEvidencePanel } from "./ManualEvidencePanel";
import { WikisourcePanel } from "./WikisourcePanel";
import { allWikisourceExcerpts, activeWikisourceExcerpts,
  wikisourceRevisionUrl, type WikisourceExcerpt } from "../domain/wikisource-excerpts";

function RoundDetails({ round, reports, judgment, sources = [], manualSources = [], activeManualIds = [],
  wikisourceSources = [], activeWikisourceIds = [] }: {
  round: number; reports: EditorialReport[]; judgment?: EditorialJudgment;
  sources?: HistoricalSource[];
  manualSources?: ManualDocumentExcerpt[];
  activeManualIds?: string[];
  wikisourceSources?: WikisourceExcerpt[];
  activeWikisourceIds?: string[];
}) {
  const judged = new Map((judgment?.decisions ?? []).map(d => [d.findingId,d]));
  const findings = reports.flatMap(r => r.findings);
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
              return <div key={f.id} className="space-y-1 rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <p className="font-semibold">{f.severity.toUpperCase()} · {f.category} · Scena {f.sceneId}</p>
                <p><b>Prova:</b> {f.evidence}</p>
                <p><b>Problema:</b> {f.reason}</p>
                <p><b>Remediation proposta:</b> {f.remediation}</p>
                {f.historical && <div className="space-y-1 rounded-md border border-slate-300 p-2 dark:border-slate-700">
                  <p><b>Accertamento storico:</b> {f.historical.assessment === "consistent_with_excerpt"
                    ? "Coerente con l'estratto (non certificato)" :
                    f.historical.assessment === "contradicts_excerpt"
                      ? "Potenziale contraddizione con l'estratto" :
                        "Non verificato con documenti"}</p>
                  <p><b>Affermazione:</b> {f.historical.claim}</p>
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
                  {ruling.action === "accept" && <p><b>Correzione approvata:</b> {ruling.remediation}</p>}
                </div> : <p className="muted">In attesa del giudizio editoriale.</p>}
              </div>;
            })}
          </div>)}
        </details>;
      })}
    </div>
    {judgment && <div className="space-y-2 rounded-lg border border-slate-300 p-3 text-xs dark:border-slate-700">
      <p className="font-semibold">Decisione finale: {judgment.verdict === "freeze" ? "Nessun rilievo accettato: può congelare" : "Sono richieste correzioni"}</p>
      <p className="whitespace-pre-wrap">{judgment.reasoning}</p>
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
      <RoundDetails round={cycle.round} reports={cycle.reports} judgment={cycle.judgment}
        sources={chapter.historicalDossier?.sources}
        manualSources={allManualEvidence(chapter.historicalDossier)}
        activeManualIds={activeManualEvidence(chapter.historicalDossier).map(x=>x.id)}
        wikisourceSources={allWikisourceExcerpts(chapter.historicalDossier)}
        activeWikisourceIds={activeWikisourceExcerpts(chapter.historicalDossier).map(x=>x.id)}/> 
      {cycle.priorRounds.map(round => <details key={round.round} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
        <summary className="cursor-pointer text-sm font-semibold">Storico della tornata {round.round}</summary>
        <div className="mt-3"><RoundDetails {...round} sources={chapter.historicalDossier?.sources}
          manualSources={allManualEvidence(chapter.historicalDossier)}
          activeManualIds={activeManualEvidence(chapter.historicalDossier).map(x=>x.id)}
          wikisourceSources={allWikisourceExcerpts(chapter.historicalDossier)}
          activeWikisourceIds={activeWikisourceExcerpts(chapter.historicalDossier).map(x=>x.id)}/></div>
      </details>)}
    </div>}
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
        {ch.summary && <details className="mt-2">
          <summary className="cursor-pointer text-xs">Sinossi del capitolo</summary>
          <p className="mt-2 whitespace-pre-wrap text-xs">{ch.summary}</p>
        </details>}
        <HistoricalResearchPanel key={ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <BibliographyPanel key={"doi-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <ArchiveCatalogPanel key={"archive-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <WikisourcePanel key={"wikisource-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        <ManualEvidencePanel key={"excerpts-"+ch.id} book={book} chapter={ch} onRefresh={onRefresh}/>
        {(ch.editorialRounds?.length ?? 0) > 0 && <details className="mt-2">
          <summary className="cursor-pointer text-xs">Giudizi archiviati ({ch.editorialRounds?.length})</summary>
          {ch.editorialRounds?.map((round, i) =>
            <div key={i} className="mt-3"><RoundDetails {...round} sources={ch.historicalDossier?.sources}
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
