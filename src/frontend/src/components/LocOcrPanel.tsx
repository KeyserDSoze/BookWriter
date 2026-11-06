import { useState } from "react";
import { BookOpenText,ExternalLink,ShieldAlert } from "lucide-react";
import { activeArchivalItems } from "../domain/archival-catalog";
import { activeInstitutionalInspections } from "../domain/institutional-inspection";
import { activeLocOcrExcerpts,allLocOcrExcerpts,
  type LocOcrRights } from "../domain/loc-ocr";
import { attachLocOcrExcerpt } from "../application/loc-ocr";
import type { BookProject,Chapter } from "../domain/types";
import { Button } from "./ui/button";

export function LocOcrPanel({
  book,chapter,onRefresh,
}: {book:BookProject;chapter:Chapter;onRefresh:()=>Promise<void>}) {
  const dossier=chapter.historicalDossier;
  const catalog=activeArchivalItems(dossier);
  const inspections=activeInstitutionalInspections(dossier);
  const eligible=inspections.filter(i=>i.hasTextResourceLink&&i.accessRestricted!==true&&
    catalog.some(item=>item.id===i.catalogItemId));
  const active=activeLocOcrExcerpts(dossier);
  const inactive=allLocOcrExcerpts(dossier).filter(x=>!active.some(a=>a.id===x.id));
  const [inspectionId,setInspectionId]=useState(eligible[0]?.id??"");
  const selected=eligible.find(i=>i.id===inspectionId)??eligible[0];
  const item=catalog.find(x=>x.id===selected?.catalogItemId);
  const [rightsBasis,setRightsBasis]=useState<LocOcrRights["rightsBasis"]>("public_domain");
  const [rightsNote,setRightsNote]=useState("");
  const [attested,setAttested]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const locked=busy||book.status==="running"||!!book.editorialCycle;

  async function importExcerpt(){
    setError("");setMessage("");
    if(!item||!selected||!attested||rightsNote.trim().length<16){
      setError("Seleziona una scheda ispezionata e attesta la base dei diritti.");
      return;
    }
    if(!window.confirm([
      "CONSENSO ALL'ACQUISIZIONE DEL TESTO OCR LIBRARY OF CONGRESS",
      "Documento istituzionale: "+item.title,
      item.url,
      "L'API di www.loc.gov riceverà SOLO l'ID pubblico "+item.itemId+".",
      "Leggeremo al massimo UN file .txt su tile.loc.gov/storage-services/.",
      "Non scaricheremo PDF, immagini, file HTML, siti esterni o altri testi.",
      "Base dichiarata di riutilizzo: "+rightsBasis,
      "Motivazione: "+rightsNote.trim(),
      "Attesto che ho personalmente valutato la possibilità di conservare un piccolo estratto e inviarlo ai modelli AI.",
      "",
      "AVVERTENZE:",
      "Il testo può contenere errori OCR, trascrizioni moderne o diritti altrui.",
      "La Library non certifica automaticamente il pubblico dominio né il diritto di ristampa.",
      "Il frammento archiviato entrerà in IndexedDB/ZIP, potrà essere inviato a GitHub e allo specialista storico/giudice AI.",
      "Nessun manoscritto, canone privato, chiave o PAT verrà inviato alla Library.",
      "Su capitolo congelato verranno riaperte le review e disattivato autosync.",
      "Procedere?",
    ].join("\n")))return;
    setBusy(true);
    try{
      const result=await attachLocOcrExcerpt(book.id,chapter.id,book.updatedAt,
        item.id,selected.id,{rightsBasis,rightsNote:rightsNote.trim(),rightsAttested:true});
      setMessage("Breve testo OCR acquisito dalla risorsa istituzionale come fonte non autenticata. "+
        (result.reopened?"Review del capitolo e successivi da ripetere.":""));
      setAttested(false);setRightsNote("");
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Impossibile leggere il testo OCR.");
    }finally{setBusy(false);}
  }

  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <BookOpenText size={16}/> Estratti OCR istituzionali · {active.length} attivi
    </summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="muted">
        Legge esclusivamente un file di testo .txt segnalato da una scheda e ispezione LoC attive.
        L'OCR potrebbe essere inaccurato; la Library non attesta la verità storica né concede
        automaticamente i diritti. Il testo NON viene aggiunto alla prosa del libro.
      </p>
      {eligible.length>0?<div className="space-y-3">
        <label className="block font-semibold">Scheda con riferimento testuale disponibile
          <select aria-label={"Documento OCR capitolo "+chapter.number} className="field mt-1"
            value={selected?.id??""} disabled={locked}
            onChange={e=>setInspectionId(e.target.value)}>
            {eligible.map(i=><option key={i.id} value={i.id}>
              {catalog.find(x=>x.id===i.catalogItemId)?.title??i.itemId} · {i.itemId}
            </option>)}
          </select>
        </label>
        <label className="block font-semibold">Base dei diritti valutata personalmente dall'autore
          <select aria-label={"Diritti OCR capitolo "+chapter.number} className="field mt-1"
            disabled={locked} value={rightsBasis}
            onChange={e=>setRightsBasis(e.target.value as LocOcrRights["rightsBasis"])}>
            <option value="public_domain">Pubblico dominio (verificato dall'autore)</option>
            <option value="permission">Permesso/licenza per questa consultazione e uso</option>
          </select>
        </label>
        <label className="block font-semibold">Motivazione documentabile dei diritti (16–280 caratteri)
          <textarea aria-label={"Motivazione diritti OCR capitolo "+chapter.number}
            className="field mt-1 min-h-20" maxLength={280} value={rightsNote}
            disabled={locked} onChange={e=>setRightsNote(e.target.value)}
            placeholder="Indica la fonte dei diritti, il permesso o la norma che hai verificato."/>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={attested}
            disabled={locked} onChange={e=>setAttested(e.target.checked)}/>
          <span>Confermo di aver verificato personalmente la base di utilizzo del testo,
            i possibili diritti di terzi e l'invio del frammento al modello AI, a ZIP e GitHub.
            La mia attestazione NON equivale a una licenza certificata.</span>
        </label>
        <Button size="sm" variant="outline"
          disabled={locked||!selected||!attested||rightsNote.trim().length<16}
          onClick={()=>void importExcerpt()}>
          {busy?"Acquisizione OCR in corso…":"Acquisisci breve estratto OCR"}
        </Button>
      </div>:<p className="muted">
        Cerca una scheda LoC e usa prima «Verifica accesso e diritti della scheda».
        Serve un riferimento testuale, senza restrizione d'accesso esplicita.
        Se non appare, non esistono risorse .txt ammissibili o l'API non le espone.
      </p>}
      {chapter.frozenAt&&<p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/>
        Aggiornare un estratto OCR riapre questo capitolo e invalida i successivi.
      </p>}
      {active.map(e=><div key={e.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <a href={e.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-start gap-1 font-semibold text-blue-700 underline dark:text-blue-300">
          {e.title}<ExternalLink size={13}/>
        </a>
        <p className="muted">OCR LoC acquisito il {new Date(e.acquiredAt).toLocaleString("it-IT")}.
          SHA-256 {e.contentSha256.slice(0,16)}… · offset {e.excerptOffset} ·
          provenienza <a href={e.textUrl} target="_blank" rel="noopener noreferrer"
            className="underline">file testuale istituzionale</a></p>
        <p className="mt-2 whitespace-pre-wrap">{e.excerpt}</p>
        <p className="muted">Diritti dichiarati dall'autore: {e.rightsBasis}. {e.rightsNote}.
          Stato: <b>NON verificati dal software</b>. La frase coincide solo col testo OCR recuperato,
          non necessariamente con il documento originale.</p>
      </div>)}
      {inactive.length>0&&<details className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <summary className="font-semibold">Storico OCR non più attivi ({inactive.length})</summary>
        <p className="muted">Conservati per audit, non utilizzati nelle nuove review.</p>
        {inactive.map(e=><div key={e.id} className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          <p>{e.title} · {e.acquiredAt}</p>
          <p className="whitespace-pre-wrap">{e.excerpt}</p>
        </div>)}
      </details>}
      {error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status">{message}</p>}
    </div>
  </details>;
}
