import { useState } from "react";
import { BookText, ExternalLink, SearchCheck, ShieldAlert } from "lucide-react";
import type { BookProject, Chapter } from "../domain/types";
import {
  activeWikisourceExcerpts, allWikisourceExcerpts, normalizeWikisourceQueries,
  wikisourceRevisionUrl, hasExactRevisionProof,
} from "../domain/wikisource-excerpts";
import { attachWikisourceResearch } from "../application/wikisource-research";
import { Button } from "./ui/button";

export function WikisourcePanel({
  book,chapter,onRefresh,
}: {book:BookProject;chapter:Chapter;onRefresh:()=>Promise<void>}) {
  const dossier=chapter.historicalDossier?.wikisource;
  const active=activeWikisourceExcerpts(chapter.historicalDossier);
  const old=allWikisourceExcerpts(chapter.historicalDossier)
    .filter(x=>!active.some(y=>y.id===x.id));
  const [input,setInput]=useState((dossier?.queries??[]).join("\n"));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const locked=busy||book.status==="running"||!!book.editorialCycle;
  async function lookup(){
    setError("");setMessage("");
    let queries:string[];
    try{queries=normalizeWikisourceQueries(input.split("\n").filter(s=>s.trim()));}
    catch(e){setError(e instanceof Error?e.message:"Query Wikisource non valide.");return;}
    if(!window.confirm([
      "CONSENSO RICERCA TESTI WIKISOURCE",
      "Invieremo SOLO queste ricerche pubbliche a it.wikisource.org:",
      ...queries.map(q=>"• "+q),
      "",
      "Le parole possono rivelare indizi o temi del progetto: annulla se sono riservate.",
      "Nessuna scena, canone privato, segreto o chiave AI viene aggiunto automaticamente.",
      "Il programma leggerà il WIKITESTO della specifica revisione, e archivierà un frammento letterale e l'impronta SHA-256.",
      "Le pagine che contengono solo modelli o testo trascluso senza un frammento letterale saranno scartate. Una trascrizione Wikisource NON autentica l'originale e NON certifica che l'opera sia di pubblico dominio.",
      "Verifica sempre attribuzione, testo della singola opera e condizioni di riutilizzo prima della pubblicazione.",
      "Il dossier può essere incluso nei backup e sincronizzato su GitHub. Le nuove review inviano estratti allo storico e al giudice.",
      "La ricerca disabilita autosync e riapre i capitoli già congelati, invalidando i successivi.",
      "",
      "Vuoi procedere?",
    ].join("\n")))return;
    setBusy(true);
    try{
      const result=await attachWikisourceResearch(book.id,chapter.id,book.updatedAt,queries);
      setMessage(result.excerptCount+" estratti Wikisource recuperati. "+
        (result.missingQueries.length?result.missingQueries.length+" query senza estratti. ":"")+
        (result.reopened?"Capitolo e successivi da rivalutare. ":"")+
        "I diritti e la fedeltà all'originale non sono verificati dal software.");
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Ricerca Wikisource non disponibile.");
    }finally{setBusy(false);}
  }
  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <BookText size={16}/> Trascrizioni Wikisource · {active.length} estratti attivi
    </summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="muted">
        Wikisource contiene trascrizioni pubbliche modificate dalla comunità: non è un archivio
        che autentica gli originali. BookWriter legge il wikitesto della revisione esatta,
        senza basarsi su TextExtracts, e salva un frammento letterale con SHA-256.
        Cerca solo argomenti pubblici, massimo tre, una frase per riga.
        La ricerca è volontaria e non trasferisce parti del romanzo.
      </p>
      <label className="block font-semibold">
        Ricerche pubbliche Wikisource
        <textarea aria-label={"Ricerche Wikisource capitolo "+chapter.number}
          className="field mt-1 min-h-24" value={input}
          disabled={locked} onChange={e=>setInput(e.target.value)}
          placeholder={"Telegrafo elettrico Ottocento\nLettere politiche 1848"}/>
      </label>
      <Button size="sm" variant="outline" disabled={locked||!input.trim()} onClick={()=>void lookup()}>
        <SearchCheck size={16}/> {busy?"Ricerca in corso...":"Cerca trascrizioni Wikisource"}
      </Button>
      {book.editorialCycle&&<p className="muted">Concludi il ciclo editoriale prima di sostituire gli estratti.</p>}
      {chapter.frozenAt&&<p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/>
        Aggiornare questi testi riapre la review e invalida le approvazioni successive.
      </p>}
      {dossier&&<p className="muted">
        Ricerca del {new Date(dossier.searchedAt).toLocaleString("it-IT")}.
        {dossier.missingQueries.length?" Senza estratti: "+dossier.missingQueries.join("; "):""}
      </p>}
      {active.map(s=><div key={s.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <a href={wikisourceRevisionUrl(s.revisionId)} target="_blank"
          rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-semibold text-blue-700 underline dark:text-blue-300">
          {s.title}<ExternalLink size={13} className="shrink-0"/>
        </a>
        <p className="muted">Trascrizione comunitaria Wikisource · pagina {s.pageId} · revisione {s.revisionId}
          {" "}({new Date(s.revisionAt).toLocaleString("it-IT")}) · query «{s.query}»</p>
        <p className="mt-2 whitespace-pre-wrap">{s.excerpt}</p>
        <p className="muted mt-1">
          Frammento letterale del WIKITESTO della revisione richiesta, confrontato sul contenuto remoto.
          SHA-256 wikitesto: {s.revisionProof!.contentSha256.slice(0,16)}… · offset {s.revisionProof!.excerptOffset}.
          La verifica riguarda solo la corrispondenza testuale, NON autenticità dell'opera o diritti.
        </p>
        <p className="muted mt-1">Contenuto non utilizzabile automaticamente come pubblico dominio:
          verifica licenza, attribuzione e fedeltà all'edizione originale.</p>
      </div>)}
      {!!old.length&&<details className="rounded border p-2">
        <summary className="cursor-pointer font-semibold">
          Revisioni storiche non più attive ({old.length})
        </summary>
        <p className="muted mt-1">Conservate per audit, non disponibili per nuove citazioni.
          Le fonti della v0.9.5 prive di prova sulla revisione sono ora disattivate: ripeti la ricerca per ottenerla.</p>
        {old.map(s=><div className="mt-2 border-t pt-2" key={s.id}>
          <a href={wikisourceRevisionUrl(s.revisionId)} target="_blank"
            rel="noopener noreferrer" className="text-blue-700 underline dark:text-blue-300">
            {s.title} · revisione {s.revisionId}
          </a>
          <p className="whitespace-pre-wrap">{s.excerpt}</p>
          {!hasExactRevisionProof(s)&&<p className="text-amber-700 dark:text-amber-300">
            Fonte v0.9.5: estratto non dimostrato appartenere alla revisione citata.
            Solo storico, non riutilizzabile in nuovi rilievi.
          </p>}
        </div>)}
      </details>}
      <p className="muted">
        Wikisource e i documenti originali hanno condizioni di utilizzo potenzialmente diverse.
        Un estratto non garantisce il pubblico dominio. Confronta sempre testo, revisione e diritti
        prima di inserirlo nell'opera finale.
      </p>
      {error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status">{message}</p>}
    </div>
  </details>;
}
