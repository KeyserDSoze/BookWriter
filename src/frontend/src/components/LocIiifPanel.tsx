import {useState} from "react";
import {Image as ImageIcon,ExternalLink} from "lucide-react";
import type {BookProject,Chapter} from "../domain/types";
import {activeLocScanCollations} from "../domain/loc-scan-collation";
import {activeLocOcrExcerpts} from "../domain/loc-ocr";
import {activeLocIiifReferences,type LocIiifCandidate} from "../domain/loc-iiif";
import {listLocIiifCandidates} from "../infrastructure/loc-iiif";
import {attachLocIiifReference} from "../application/loc-iiif";
import {Button} from "./ui/button";

export function LocIiifPanel({book,chapter,onRefresh}:{
  book:BookProject;chapter:Chapter;onRefresh:()=>Promise<void>;
}){
  const scans=activeLocScanCollations(chapter.historicalDossier);
  const ocr=activeLocOcrExcerpts(chapter.historicalDossier);
  const known=activeLocIiifReferences(chapter.historicalDossier);
  const [collationId,setCollationId]=useState("");
  const scan=scans.find(x=>x.id===collationId)??scans[0];
  const source=ocr.find(x=>x.id===scan?.ocrSourceId);
  const [candidates,setCandidates]=useState<LocIiifCandidate[]>([]);
  const [selection,setSelection]=useState("");
  const [samePage,setSamePage]=useState(false);
  const [rights,setRights]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const locked=busy||book.status==="running"||!!book.editorialCycle;
  const selected=candidates.find(x=>x.infoUrl===selection)??candidates[0];
  function reset(){setCandidates([]);setSelection("");setSamePage(false);setRights(false);}
  async function discover(){
    if(!source||locked)return;
    if(!window.confirm([
      "CONSENSO: CERCA METADATI IIIF LIBRARY OF CONGRESS",
      "La scheda pubblica esatta è "+source.url,
      "Invieremo SOLO l'ID pubblico "+source.itemId+" a www.loc.gov.",
      "Cercheremo soltanto URL info.json sotto tile.loc.gov/image-services/iiif.",
      "Nessuna scansione, immagine, PDF o pixel viene scaricata.",
      "Nessun segreto, testo del libro, hash OCR, diritti o token viene inviato.",
      "Le risorse di una stessa scheda possono rappresentare pagine DIVERSE.",
      "Continuare?",
    ].join("\n")))return;
    setBusy(true);setError("");setMessage("");reset();
    try{
      const found=await listLocIiifCandidates(source.itemId);
      setCandidates(found);setSelection(found[0]?.infoUrl??"");
      if(!found.length)setMessage("Nessuna risorsa IIIF ammessa e identificabile nel record. Non inventiamo una scansione.");
    }catch(e){setError(e instanceof Error?e.message:"Ricerca IIIF non riuscita.");}
    finally{setBusy(false);}
  }
  async function associate(){
    if(!source||!scan||!selected||!samePage||!rights||locked)return;
    if(!window.confirm([
      "ASSOCIA METADATI IIIF ALLA COLLAZIONE",
      "Scheda LoC: "+source.url,
      "Pagina/folio DICHIARATO dall'autore: "+scan.pageLocator,
      "URL metadati dell'immagine: "+selected.infoUrl,
      "Confermo di aver visualizzato personalmente che la risorsa scelta è la stessa pagina osservata.",
      "Confermo i diritti per registrare e condividere questi metadati.",
      "Dopo consenso leggeremo SOLO il JSON del record LoC e l'info.json della risorsa scelta.",
      "Il software NON scarica l'immagine, NON legge i suoi pixel, NON certifica OCR/originale/licenza.",
      "Il riferimento entrerà in backup/GitHub ed eventualmente nei prompt dello storico e del giudice.",
      "Il capitolo congelato e i successivi verranno riaperti; autosync sarà disabilitato.",
      "Procedere?",
    ].join("\n")))return;
    setBusy(true);setError("");setMessage("");
    try{
      const result=await attachLocIiifReference(book.id,chapter.id,book.updatedAt,
        scan.id,selected,true,true);
      setMessage("Metadati IIIF associati, senza download di immagini."+
        (result.reopened?" Review del capitolo e dei successivi da ripetere.":""));
      reset();await onRefresh();
    }catch(e){setError(e instanceof Error?e.message:"Associazione IIIF non riuscita.");}
    finally{setBusy(false);}
  }
  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <ImageIcon size={16}/> Riferimenti IIIF scansioni · {known.length} attivi
    </summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="muted">Associa a una collazione già dichiarata dall'autore
        l'identificativo tecnico di una risorsa immagine IIIF elencata dalla stessa scheda
        Library of Congress. Il software controlla solo il JSON di provenienza e dimensioni;
        non verifica che i pixel rappresentino proprio la pagina, né legge o salva immagini.</p>
      {scans.length===0?<p className="muted">Prima acquisisci un estratto OCR e registra
        una collazione visiva con pagina/folio nel pannello precedente.</p>:
      <div className="space-y-3">
        <label className="block font-semibold">Collazione OCR / scansione già dichiarata
          <select className="field mt-1" aria-label="Collazione da associare a IIIF"
            value={scan?.id??""} disabled={locked}
            onChange={e=>{setCollationId(e.target.value);reset();}}>
            {scans.map(s=><option key={s.id} value={s.id}>
              {s.pageLocator} · {s.itemId} · {s.observedAt}
            </option>)}
          </select>
        </label>
        {source&&<p>Apri la <a href={source.url} target="_blank" rel="noopener noreferrer"
          className="underline">scheda LoC originale</a> per identificare
          personalmente la pagina/immagine corrispondente a «{scan?.pageLocator}».
          Più immagini possono appartenere allo stesso documento.</p>}
        <Button size="sm" variant="outline" disabled={locked||!source}
          onClick={()=>void discover()}>
          {busy?"Ricerca in corso…":"Cerca risorse IIIF della scheda"}
        </Button>
        {candidates.length>0&&<div className="space-y-2">
          <label className="block font-semibold">Seleziona la risorsa IIIF identificata sulla pagina
            <select className="field mt-1" aria-label="Risorsa IIIF selezionata"
              disabled={locked} value={selected?.infoUrl??""}
              onChange={e=>{setSelection(e.target.value);setSamePage(false);setRights(false);}}>
              {candidates.map(c=><option key={c.infoUrl} value={c.infoUrl}>
                Risorsa {c.resourceIndex+1}, immagine {c.fileIndex<0?"principale":c.fileIndex+1} · {c.infoUrl}
              </option>)}
            </select>
          </label>
          <p className="muted">Metadati selezionati: <a href={selected?.infoUrl}
            target="_blank" rel="noopener noreferrer" className="underline">
            info.json istituzionale <ExternalLink className="inline" size={12}/></a>.
            Apri e confronta con la pagina visualizzata nel sito LoC. Un JSON IIIF non
            dimostra la corrispondenza con l'OCR né rende l'opera liberamente riutilizzabile.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={samePage} disabled={locked}
              onChange={e=>setSamePage(e.target.checked)}/>
            <span>Ho riconosciuto personalmente che questa risorsa IIIF rappresenta
              la pagina/folio già dichiarato. BookWriter non può confermarlo dai pixel.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={rights} disabled={locked}
              onChange={e=>setRights(e.target.checked)}/>
            <span>Attesto di avere valutato i diritti e autorizzo la conservazione
              e il possibile invio del solo riferimento IIIF a ZIP, GitHub e modelli AI.</span>
          </label>
          <Button size="sm" variant="outline" disabled={locked||!samePage||!rights}
            onClick={()=>void associate()}>Associa metadati IIIF alla collazione</Button>
        </div>}
      </div>}
      {known.map(x=><div key={x.id} className="rounded border border-slate-200 p-2 dark:border-slate-700">
        <p className="font-semibold">Risorsa IIIF selezionata dall'autore · {x.pageLocator}</p>
        <a href={x.infoUrl} target="_blank" rel="noopener noreferrer"
          className="underline">Metadati IIIF istituzionali</a>
        <p className="muted">Dimensioni dichiarate {x.width}×{x.height}.
          Impronta metadati {x.infoSha256.slice(0,16)}…; riferimento {x.id}.
          Stato: soli metadati tecnici, immagine non verificata, diritti dichiarati dall'autore.</p>
      </div>)}
      {error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status">{message}</p>}
    </div>
  </details>;
}
