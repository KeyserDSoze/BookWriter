import { useState } from "react";
import { BookMarked, ExternalLink, SearchCheck, ShieldAlert } from "lucide-react";
import { normalizeDois, activeBibliography } from "../domain/bibliography";
import type { BookProject, Chapter } from "../domain/types";
import { attachBibliographyToChapter } from "../application/historical-bibliography";
import { Button } from "./ui/button";

export function BibliographyPanel({
  book,chapter,onRefresh,
}: {book:BookProject;chapter:Chapter;onRefresh:()=>Promise<void>}){
  const dossier=chapter.historicalDossier?.bibliography;
  const works=activeBibliography(chapter.historicalDossier);
  const [input,setInput]=useState((dossier?.works.filter(w=>
    dossier.activeWorkIds.includes(w.id)).map(w=>w.doi)??[]).join("\n"));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const locked=busy||book.status==="running"||!!book.editorialCycle;

  async function lookup(){
    setError("");setMessage("");
    let dois:string[];
    try{
      dois=normalizeDois(input.split("\n").filter(s=>s.trim()));
    }catch(cause){
      setError(cause instanceof Error?cause.message:"DOI non validi.");return;
    }
    if(!window.confirm([
      "RICERCA BIBLIOGRAFICA ESTERNA — CONSENSO",
      "Invieremo SOLO questi identificativi DOI a api.crossref.org:",
      ...dois.map(doi=>"• "+doi),
      "",
      "Nessun manoscritto, canone, segreto o token viene aggiunto automaticamente.",
      "Se i DOI selezionati rivelano idee private, annulla.",
      "Crossref fornisce METADATI (titolo, autori, anno), NON il testo o la verifica storica dell'opera.",
      "La ricerca disattiva autosync; per un capitolo già congelato riapre la review e invalida i successivi.",
      "Vuoi procedere?",
    ].join("\n")))return;
    setBusy(true);
    try{
      const result=await attachBibliographyToChapter(book.id,chapter.id,book.updatedAt,dois);
      setMessage(result.sourceCount+" metadati DOI salvati. "+
        (result.missingDois.length?result.missingDois.length+" non presenti in Crossref. ":"")+
        (result.reopened?"Capitolo e successivi da rivalutare. ":"")+
        "Verifica sempre il contenuto originale delle pubblicazioni.");
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Ricerca DOI non disponibile.");
    }finally{setBusy(false);}
  }

  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <BookMarked size={16}/> Bibliografia DOI · {works.length} pubblicazioni attive
    </summary>
    <div className="mt-3 space-y-3">
      <p className="muted text-xs">
        Inserisci da uno a cinque DOI pubblici di studi e libri da consultare,
        uno per riga. Esempio: 10.1234/esempio. Crossref restituisce solo
        informazioni bibliografiche, non i testi completi. Nessun fatto storico
        viene considerato verificato sulla base dei metadati.
      </p>
      <label className="block text-xs font-semibold">
        DOI autorizzati dall'autore
        <textarea aria-label={"DOI bibliografici capitolo "+chapter.number}
          className="field mt-1 min-h-24" value={input}
          disabled={locked} onChange={e=>setInput(e.target.value)}
          placeholder={"10.1234/esempio\nhttps://doi.org/10.5678/esempio2"}/>
      </label>
      <Button size="sm" variant="outline" disabled={locked||!input.trim()}
        onClick={()=>void lookup()}><SearchCheck size={16}/>
        {busy?"Consultazione DOI...":"Recupera metadati DOI"}
      </Button>
      {book.editorialCycle&&<p className="muted text-xs">
        Per sostituire la bibliografia, concludi prima la redazione attiva.
      </p>}
      {chapter.frozenAt&&<p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/>
        Aggiornare il dossier riapre questo capitolo e quelli successivi.
      </p>}
      {dossier&&<div className="space-y-2 text-xs">
        <p className="font-semibold">Metadati Crossref recuperati il{" "}
          {new Date(dossier.lookedUpAt).toLocaleString("it-IT")}</p>
        {dossier.missingDois.length>0&&<p className="text-amber-700 dark:text-amber-300">
          DOI non presenti: {dossier.missingDois.join("; ")}
        </p>}
        {works.map(work=><div className="rounded-md border border-slate-200 p-2 dark:border-slate-700" key={work.id}>
          <a className="inline-flex items-start gap-1 break-all font-semibold text-blue-700 underline dark:text-blue-300"
            href={work.url} target="_blank" rel="noopener noreferrer">
            {work.title} <ExternalLink size={13} className="shrink-0"/>
          </a>
          <p className="muted">DOI {work.doi} · {work.publicationYear??"anno non dichiarato"} · {work.workType}</p>
          {!!work.authors.length&&<p>Autori: {work.authors.join(", ")}</p>}
          {(work.venue||work.publisher)&&<p>{[work.venue,work.publisher].filter(Boolean).join(" · ")}</p>}
          <p className="muted">Crossref: metadati depositati; non è stato letto né verificato il contenuto dell'opera.</p>
        </div>)}
        {!works.length&&<p className="muted">Nessun DOI recuperato: non significa che gli studi non esistano.</p>}
      </div>}
      <p className="muted text-xs">
        I DOI approvati e i metadati rimangono nei dati del libro e negli eventuali
        backup/snapshot GitHub autorizzati. Le repository pubbliche ne rendono visibile
        la selezione. Il revisore li userà solo per orientare la bibliografia, mai
        come prova automatica di una singola affermazione.
      </p>
      {error&&<p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status" className="text-xs">{message}</p>}
    </div>
  </details>;
}
