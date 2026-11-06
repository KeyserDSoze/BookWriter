import { useState } from "react";
import { Archive, ExternalLink, SearchCheck, ShieldAlert } from "lucide-react";
import type { BookProject, Chapter } from "../domain/types";
import { activeArchivalItems, normalizeArchiveQueries } from "../domain/archival-catalog";
import { activeInstitutionalInspections } from "../domain/institutional-inspection";
import { attachInstitutionalInspection } from "../application/institutional-inspection";
import { attachArchiveCatalog } from "../application/archival-catalog";
import { Button } from "./ui/button";

export function ArchiveCatalogPanel({
  book,chapter,onRefresh,
}: {book:BookProject;chapter:Chapter;onRefresh:()=>Promise<void>}) {
  const catalog=chapter.historicalDossier?.archiveCatalog;
  const items=activeArchivalItems(chapter.historicalDossier);
  const details=activeInstitutionalInspections(chapter.historicalDossier);
  const [input,setInput]=useState((catalog?.queries ?? []).join("\n"));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const locked=busy||book.status==="running"||!!book.editorialCycle;

  async function inspect(catalogItemId:string,itemId:string) {
    setError("");setMessage("");
    if(!window.confirm([
      "ISPEZIONE DOCUMENTALE LIBRARY OF CONGRESS",
      "Leggeremo SOLO i metadati della scheda pubblica "+itemId+" su www.loc.gov.",
      "Non verranno inviate le query del libro, la prosa, i segreti, credenziali o token.",
      "Riceveremo segnalazioni di restrizione, digitalizzazione e condizioni d'accesso/diritti.",
      "NON scaricheremo o leggeremo l'originale, il PDF, il testo OCR o immagini.",
      "La presenza online non implica diritto di ripubblicazione: verifica manualmente ogni licenza.",
      "L'ispezione sarà salvata in IndexedDB e nei backup; se sincronizzi il libro può raggiungere GitHub.",
      "Se il capitolo è congelato, verrà riaperto con invalidazione dei successivi; autosync disabilitato.",
      "Vuoi procedere?",
    ].join("\n")))return;
    setBusy(true);
    try{
      const result=await attachInstitutionalInspection(
        book.id,chapter.id,book.updatedAt,catalogItemId);
      setMessage("Avvisi istituzionali salvati. Nessun originale è stato letto. "+
        (result.reopened?"Riesegui la review di questo capitolo e dei successivi.":""));
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Ispezione istituzionale non disponibile.");
    }finally{setBusy(false);}
  }
  async function search() {
    setError("");setMessage("");
    let queries:string[];
    try {queries=normalizeArchiveQueries(input.split("\n").filter(x=>x.trim()));}
    catch(cause){setError(cause instanceof Error?cause.message:"Ricerche non valide.");return;}
    if(!window.confirm([
      "CONSENSO RICERCA ARCHIVIO ISTITUZIONALE",
      "Invieremo SOLO queste stringhe a www.loc.gov (Library of Congress):",
      ...queries.map(x=>"• "+x),
      "",
      "Non vengono aggiunti manoscritto, timeline privata, segreti o credenziali.",
      "Le parole digitate possono tuttavia rivelare dettagli del tuo progetto: annulla se sono riservate.",
      "Riceverai SCHEDE di catalogo, non il contenuto accertato dei documenti. Nessuna scheda vale come prova storica.",
      "L'operazione disabilita autosync; su capitolo congelato invalida anche i freeze successivi.",
      "Vuoi procedere?",
    ].join("\n"))) return;
    setBusy(true);
    try {
      const result=await attachArchiveCatalog(book.id,chapter.id,book.updatedAt,queries);
      setMessage(result.itemCount+" schede recuperate. "+
        (result.missingQueries.length?result.missingQueries.length+" query senza schede. ":"")+
        (result.reopened?"Redazione del capitolo e dei successivi da ripetere. ":"")+
        "Apri gli originali prima di usare informazioni storiche.");
      await onRefresh();
    } catch(cause){
      setError(cause instanceof Error?cause.message:"Catalogo non disponibile.");
    } finally {setBusy(false);}
  }
  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <Archive size={16}/> Archivi istituzionali · {items.length} schede attive
    </summary>
    <div className="mt-3 space-y-3">
      <p className="muted text-xs">
        Cerca una-tre frasi storiche PUBBLICHE nell'archivio digitale della Library of Congress.
        Il catalogo identifica possibili documenti, mappe o foto: non legge né certifica il loro contenuto.
        Il servizio può non funzionare nel browser se la rete o CORS impediscono la richiesta.
      </p>
      <label className="block text-xs font-semibold">
        Ricerche archivistiche approvate dall'autore
        <textarea aria-label={"Ricerche archivistiche capitolo "+chapter.number}
          className="field mt-1 min-h-24" value={input} disabled={locked}
          onChange={e=>setInput(e.target.value)}
          placeholder={"telegraph history 1848\nrailways nineteenth century"}/>
      </label>
      <Button size="sm" variant="outline" disabled={locked||!input.trim()}
        onClick={()=>void search()}><SearchCheck size={16}/>
        {busy?"Consultazione in corso...":"Cerca schede archivistiche"}
      </Button>
      {book.editorialCycle && <p className="muted text-xs">
        Termina la review attiva prima di sostituire il catalogo.
      </p>}
      {chapter.frozenAt && <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/>
        Aggiornare il catalogo riapre questo capitolo e quelli successivi.
      </p>}
      {catalog && <div className="space-y-2 text-xs">
        <p className="font-semibold">Schede recuperate il{" "}
          {new Date(catalog.searchedAt).toLocaleString("it-IT")}</p>
        {catalog.missingQueries.length>0 && <p className="text-amber-700 dark:text-amber-300">
          Nessuna scheda utilizzabile per: {catalog.missingQueries.join("; ")}
        </p>}
        {items.map(item=><div className="rounded-md border border-slate-200 p-2 dark:border-slate-700"
          key={item.id}>
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-start gap-1 break-all font-semibold text-blue-700 underline dark:text-blue-300">
            {item.title}<ExternalLink size={13} className="shrink-0"/>
          </a>
          <p className="muted">Library of Congress · ID {item.itemId} · ricerca «{item.query}»</p>
          {item.date&&<p><b>Data del catalogo:</b> {item.date}</p>}
          {item.description&&<p className="mt-1 whitespace-pre-wrap">{item.description}</p>}
          <div className="mt-2 space-y-2">
            <Button size="sm" variant="outline" disabled={locked}
              onClick={()=>void inspect(item.id,item.itemId)}>
              {busy?"Ispezione in corso…":"Verifica accesso e diritti della scheda"}
            </Button>
            {details.filter(d=>d.catalogItemId===item.id).map(d=><div key={d.id}
              className="space-y-1 rounded border border-slate-200 p-2 dark:border-slate-700">
              <p className="font-semibold">Avvisi LoC consultati il {new Date(d.inspectedAt).toLocaleString("it-IT")}</p>
              <p>Digitalizzazione: {d.digitized===null?"non dichiarata":d.digitized?"indicata":"non indicata"}.
                Restrizione accesso: {d.accessRestricted===null?"non dichiarata":d.accessRestricted?"segnalata":"non segnalata"}.</p>
              <p>Risorse digitali in catalogo: {d.hasDigitalResources?"indicate":"non indicate"}.
                Riferimenti a possibili risorse testuali: {d.hasTextResourceLink?"presenti":"non rilevati"}.
                Nessun file o testo è stato scaricato.</p>
              {d.rightsAdvisory.length>0?<div><b>Avvisi istituzionali sui diritti:</b>
                {d.rightsAdvisory.map((note,i)=><p key={i} className="mt-1 whitespace-pre-wrap">{note}</p>)}
              </div>:<p>Nessun avviso sui diritti riportato: **non** equivale ad autorizzazione.</p>}
              {d.accessAdvisory.length>0&&<div><b>Condizioni d'accesso:</b>
                {d.accessAdvisory.map((note,i)=><p key={i} className="mt-1 whitespace-pre-wrap">{note}</p>)}
              </div>}
              <p className="muted">Stato diritti: <b>NON verificati</b>. Sono soltanto metadati del catalogo,
                non una lettura dell'originale e non sono citabili come prova storica.</p>
            </div>)}
          </div>
          <p className="muted mt-1">Metadati istituzionali, NON citazione del contenuto. Verifica originali e diritti sul sito.</p>
        </div>)}
        {!items.length && <p className="muted">Nessuna scheda disponibile: non è prova dell'assenza del documento.</p>}
      </div>}
      <p className="muted text-xs">
        Le query e i metadati rimangono nel dossier locale e nei backup; possono divenire visibili
        su repository GitHub pubbliche. Le schede non entrano in historical.sourceIds.
      </p>
      {error&&<p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status" className="text-xs">{message}</p>}
    </div>
  </details>;
}
