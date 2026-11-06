import { useState } from "react";
import { GitFork, ShieldAlert } from "lucide-react";
import type { BookProject, Chapter } from "../domain/types";
import { activeHistoricalSources, activeHistoricalSourceRelations,
  type HistoricalSourceRelation, type HistoricalSourceRelationKind } from "../domain/historical-research";
import { activeManualEvidence } from "../domain/manual-evidence";
import { activeWikisourceExcerpts } from "../domain/wikisource-excerpts";
import { activeLocOcrExcerpts } from "../domain/loc-ocr";
import { attestHistoricalSourceRelation } from "../application/historical-source-relations";
import { Button } from "./ui/button";

const RELATION_LABELS: Record<HistoricalSourceRelationKind, string> = {
  same_original:"Stesso originale o ristampa dello stesso testo",
  derived:"Una fonte deriva dall'altra (non indipendente)",
  unknown:"Relazione non stabilita (rettifica di una precedente dichiarazione)",
};

/** Only explicit author statements, NEVER inferred independence or provenance certification. */
export function HistoricalSourceRelationsPanel({
  book, chapter, onRefresh,
}: {book: BookProject; chapter: Chapter; onRefresh: () => Promise<void>}) {
  const [first,setFirst]=useState("");
  const [second,setSecond]=useState("");
  const [kind,setKind]=useState<HistoricalSourceRelationKind>("same_original");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const dossier=chapter.historicalDossier;
  const options=[
    ...activeHistoricalSources(dossier).map(x=>({id:x.id,label:"Wikipedia · "+x.title+" · "+x.id})),
    ...activeWikisourceExcerpts(dossier).map(x=>({id:x.id,label:"Wikisource · "+x.title+" · "+x.id})),
    ...activeManualEvidence(dossier).map(x=>({id:x.id,label:"Trascrizione autore · "+x.title+" · "+x.id})),
    ...activeLocOcrExcerpts(dossier).map(x=>({id:x.id,label:"OCR LoC · "+x.title+" · "+x.id})),
  ];
  let relations:HistoricalSourceRelation[]=[];
  let invalidHistory="";
  try { relations=activeHistoricalSourceRelations(dossier); }
  catch (cause) {
    invalidHistory=cause instanceof Error?cause.message:"Storico della provenienza non valido.";
  }
  const locked=busy||book.status==="running"||!!book.editorialCycle;
  const valid=!!dossier&&!invalidHistory&&options.length>=2&&
    !!first&&!!second&&first!==second&&
    options.some(x=>x.id===first)&&options.some(x=>x.id===second)&&
    note.trim().length>=24&&note.trim().length<=400;

  async function save() {
    setError("");setStatus("");
    if (!valid||locked) return;
    const warning=[
      "DICHIARAZIONE LOCALE DI PROVENIENZA: SOLO L'AUTORE",
      "Prima fonte: "+first,
      "Seconda fonte: "+second,
      "Relazione dichiarata: "+RELATION_LABELS[kind],
      "Motivazione completa: "+note.trim(),
      "",
      "Non abbiamo letto o autenticato gli originali. Le dipendenze same_original/derived impediranno di considerare queste fonti indipendenti nelle nuove review. La rettifica unknown rimuove il vincolo attivo, ma NON prova indipendenza.",
      "Questa nota resta nel dossier, nella cronologia e nei backup; potrebbe raggiungere un modello AI durante la review o la repository GitHub che scegli di sincronizzare.",
      "L'operazione disabilita autosync e invalida il freeze del capitolo e dei successivi quando presente. Nessuna richiesta esterna parte ora.",
      "",
      "Confermi la dichiarazione?",
    ].join("\n");
    if(!window.confirm(warning))return;
    setBusy(true);
    try {
      const result=await attestHistoricalSourceRelation(
        book.id,chapter.id,book.updatedAt,first,second,kind,note.trim(),true);
      setNote("");setFirst("");setSecond("");
      setStatus(result.reopened?
        "Dichiarazione salvata. Capitolo e successivi riaperti per la redazione.":
        "Dichiarazione salvata senza chiamate esterne. Le prossime review terranno conto dei legami noti.");
      await onRefresh();
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"Impossibile registrare la relazione fra fonti.");
    } finally {setBusy(false);}
  }

  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <GitFork size={16}/> Provenienza e dipendenze fra fonti · {relations.length} relazioni attive
    </summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="muted">
        Quando due riferimenti riprendono lo stesso originale o uno deriva dall'altro,
        dichiaralo qui. Il software non certifica provenienza, diritti o indipendenza:
        considera il legame come un vincolo prudenziale sulle nuove review.
      </p>
      {invalidHistory&&<p role="alert" className="text-red-700 dark:text-red-300">
        {invalidHistory}. Non modificare il dossier finché lo storico non è verificato.
      </p>}
      {options.length<2&&<p className="muted">
        Servono almeno due estratti attivi e citabili nel capitolo.
      </p>}
      <label className="block font-semibold">
        Prima fonte
        <select aria-label={"Prima fonte relazione capitolo "+chapter.number}
          className="field mt-1 w-full" value={first} onChange={e=>setFirst(e.target.value)}
          disabled={locked||!!invalidHistory}>
          <option value="">Seleziona la prima fonte</option>
          {options.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label className="block font-semibold">
        Seconda fonte
        <select aria-label={"Seconda fonte relazione capitolo "+chapter.number}
          className="field mt-1 w-full" value={second} onChange={e=>setSecond(e.target.value)}
          disabled={locked||!!invalidHistory}>
          <option value="">Seleziona la seconda fonte</option>
          {options.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label className="block font-semibold">
        Relazione dichiarata
        <select aria-label={"Tipo relazione capitolo "+chapter.number}
          className="field mt-1 w-full" value={kind}
          onChange={e=>setKind(e.target.value as HistoricalSourceRelationKind)}
          disabled={locked||!!invalidHistory}>
          {Object.entries(RELATION_LABELS).map(([value,label])=>
            <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block font-semibold">
        Motivazione della relazione (24–400 caratteri)
        <textarea aria-label={"Motivazione relazione capitolo "+chapter.number}
          className="field mt-1 min-h-24" maxLength={400}
          value={note} onChange={e=>setNote(e.target.value)}
          disabled={locked||!!invalidHistory}
          placeholder="Ho confrontato la citazione e il riferimento bibliografico: la seconda fonte riprende la prima…"/>
      </label>
      <Button size="sm" variant="outline" disabled={!valid||locked}
        onClick={()=>void save()}><GitFork size={16}/>
        {busy?"Registrazione...":"Registra relazione di provenienza"}
      </Button>
      {chapter.frozenAt&&<p className="flex gap-1 text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/> La modifica riapre il capitolo e quelli successivi.
      </p>}
      {book.editorialCycle&&<p className="muted">Completa la review in corso prima di aggiornare le relazioni.</p>}
      {!!relations.length&&<div className="space-y-2" aria-label="Relazioni documentali attive">
        <p className="font-semibold">Ultime dichiarazioni per ciascuna coppia (non certificate)</p>
        {relations.map(x=><div key={x.id} className="rounded border border-slate-300 p-2 dark:border-slate-700">
          <p className="break-all font-semibold">{x.sourceAId} · {x.sourceBId}</p>
          <p>{RELATION_LABELS[x.relation]}</p>
          <p className="whitespace-pre-wrap">{x.note}</p>
          <p className="muted">{new Date(x.recordedAt).toLocaleString("it-IT")}</p>
        </div>)}
      </div>}
      {(dossier?.sourceRelations?.length??0)>0&&<p className="muted">
        Dichiarazioni conservate nell'audit: {dossier?.sourceRelations?.length}.
        Una nuova dichiarazione non cancella le precedenti. Con "Relazione non stabilita"
        puoi rettificare il vincolo attivo, senza dimostrare indipendenza.
      </p>}
      {error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {status&&<p role="status">{status}</p>}
    </div>
  </details>;
}
