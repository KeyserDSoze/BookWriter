import { useState } from "react";
import { BookOpenText,ExternalLink,ShieldAlert } from "lucide-react";
import { activeArchivalItems } from "../domain/archival-catalog";
import { activeInstitutionalInspections } from "../domain/institutional-inspection";
import { activeLocOcrExcerpts,allLocOcrExcerpts,
  type LocOcrRights } from "../domain/loc-ocr";
import { attachLocOcrExcerpt } from "../application/loc-ocr";
import { attachLocScanCollation } from "../application/loc-scan-collation";
import { activeLocScanCollations } from "../domain/loc-scan-collation";
import { quarantineLocOcrSource } from "../application/loc-ocr-audit";
import { auditStoredLocOcrExcerpt,type LocOcrAuditResult } from "../infrastructure/loc-ocr";
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
  const collations=activeLocScanCollations(dossier);
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
  const [auditResults,setAuditResults]=useState<Record<string,LocOcrAuditResult>>({});
  const [auditingId,setAuditingId]=useState<string|null>(null);
  const [collatingId,setCollatingId]=useState<string|null>(null);
  const [pageLocator,setPageLocator]=useState("");
  const [observedText,setObservedText]=useState("");
  const [observedAttested,setObservedAttested]=useState(false);
  const [rightsConfirmed,setRightsConfirmed]=useState(false);
  const locked=busy||book.status==="running"||!!book.editorialCycle;

  async function importExcerpt(){
    setAuditResults({});
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

  async function verifySource(sourceId:string){
    if(locked||auditingId)return;
    const source=active.find(x=>x.id===sourceId);
    if(!source)return;
    if(!window.confirm([
      "RIVERIFICA REMOTA OCR LIBRARY OF CONGRESS",
      "Rileggeremo da www.loc.gov la sola scheda pubblica "+source.itemId+".",
      "Se il file è ancora ammesso, leggeremo il file .txt sul dominio tile.loc.gov:",
      source.textUrl,
      "Sono due GET massime: non inviamo il libro, l'estratto, SHA-256, note sui diritti, ricerche private, API key o PAT.",
      "Confronteremo la risorsa dichiarata, la SHA-256, la lunghezza e la citazione all'offset originale.",
      "Il risultato sarà SOLO temporaneo nella schermata: nessun backup o modifica del libro.",
      "Un confronto positivo NON autentica la scansione storica né certifica il copyright.",
      "In caso di discordanza potrai decidere separatamente se escludere la fonte dalle nuove review.",
      "Vuoi procedere?",
    ].join("\n")))return;
    setAuditingId(sourceId);
    setAuditResults(prev=>{const next={...prev};delete next[sourceId];return next;});
    setError("");setMessage("");
    try{
      const outcome=await auditStoredLocOcrExcerpt(source);
      setAuditResults(prev=>({...prev,[sourceId]:outcome}));
    }catch(error){
      setError(error instanceof Error?error.message:"Riverifica OCR LoC non disponibile.");
    }finally{setAuditingId(null);}
  }
  async function quarantine(sourceId:string){
    if(locked||auditingId||auditResults[sourceId]?.matches!==false)return;
    if(!window.confirm([
      "ESCLUDERE UNA FONTE OCR DISCORDANTE?",
      "ID: "+sourceId,
      "La verifica online NON coincide con lo snapshot locale.",
      "La fonte non sarà più citabile nelle nuove review; snapshot, testi e report precedenti saranno conservati per audit.",
      "Se il capitolo è congelato verranno riaperti questo e i successivi; autosync sarà disabilitato.",
      "La discordanza NON prova che l'opera storica originale sia falsa.",
      "Confermi l'esclusione?",
    ].join("\n")))return;
    setAuditingId(sourceId);
    setError("");setMessage("");
    try{
      const result=await quarantineLocOcrSource(book.id,chapter.id,book.updatedAt,sourceId);
      setAuditResults(prev=>{const next={...prev};delete next[sourceId];return next;});
      setMessage("Fonte OCR esclusa dai nuovi rilievi; storico preservato."+
        (result.reopened?" Review del capitolo e dei successivi da ripetere.":""));
      await onRefresh();
    }catch(error){
      setError(error instanceof Error?error.message:"Esclusione OCR non riuscita.");
    }finally{setAuditingId(null);}
  }
  async function collate(sourceId:string){
    const source=active.find(x=>x.id===sourceId);
    if(!source||locked||auditingId||!observedAttested||!rightsConfirmed)return;
    if(!window.confirm([
      "COLLAZIONE SCANSIONE ORIGINALE E OCR",
      "L'autore dichiara di avere aperto la scansione dalla scheda LoC "+source.itemId+":",
      source.url,
      "Pagina o folio osservato: "+pageLocator.trim(),
      "Trascrizione da immagine (NON da OCR):",
      observedText.trim(),
      "Dichiaro di poter conservare questo breve brano e inviarlo ai modelli AI, ai backup e a GitHub.",
      "Il programma confronterà soltanto DUE TESTI: NON scaricherà immagini né ne leggerà i pixel.",
      "La somiglianza testuale NON certifica l'originale, la data o i diritti.",
      "Il risultato sarà salvato nello storico. Se il capitolo era congelato, riaprirà le review e disabiliterà autosync.",
      "Confermi il salvataggio?",
    ].join("\n")))return;
    setBusy(true);setError("");setMessage("");
    try{
      const result=await attachLocScanCollation(book.id,chapter.id,book.updatedAt,{
        ocrSourceId:sourceId,pageLocator:pageLocator.trim(),
        observedText:observedText.trim(),
        observedOriginalAttested:true,excerptRightsAttested:true,
      });
      setCollatingId(null);setObservedText("");setPageLocator("");
      setObservedAttested(false);setRightsConfirmed(false);
      setMessage(result.comparison==="text_overlap"?
        "Trascrizione osservata e OCR coincidono dopo normalizzazione di spazi e maiuscole; immagine NON verificata dal software.":
        "DISCORDANZA: il testo trascritto dalla scansione NON compare nell'OCR. Riesamina fonte e review.");
      if(result.reopened)setMessage(x=>x+" Capitolo e successivi da rivalutare.");
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Collazione con scansione non riuscita.");
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
        {collations.filter(c=>c.ocrSourceId===e.id).map(c=><div key={c.id}
          className="mt-2 rounded-md border border-slate-300 p-2 dark:border-slate-600">
          <p className="font-semibold">Collazione visiva dichiarata dall'autore · {new Date(c.observedAt).toLocaleString("it-IT")}</p>
          <p>Pagina/folio: {c.pageLocator}. Il collegamento istituzionale è
            <a href={c.scanPageUrl} target="_blank" rel="noopener noreferrer" className="underline"> la scheda LoC</a>,
            non una scansione autenticata o un'immagine scaricata.</p>
          <p className="mt-1 whitespace-pre-wrap">Testo letto e digitato dall'autore: {c.observedText}</p>
          {c.comparison==="text_overlap"
            ?<p className="text-green-700 dark:text-green-300">Testi compatibili dopo normalizzazione di spazi e maiuscole.
              Nessuna verifica automatica dei pixel, dell'originale o dei diritti.</p>
            :<p role="alert" className="text-red-700 dark:text-red-300">
              Discordanza tra trascrizione visiva dichiarata dall'autore e testo OCR.
              Esamina l'originale prima di approvare un rilievo storico.</p>}
        </div>)}
        <div className="mt-2">
          <Button size="sm" variant="outline" disabled={locked||!!auditingId}
            onClick={()=>{setCollatingId(collatingId===e.id?null:e.id);
              setPageLocator("");setObservedText("");
              setObservedAttested(false);setRightsConfirmed(false);}}>
            {collatingId===e.id?"Chiudi collazione":"Confronta OCR con scansione"}
          </Button>
          {collatingId===e.id&&<div className="mt-2 space-y-2 rounded border border-slate-200 p-2 dark:border-slate-700">
            <p>Apri la <a href={e.url} target="_blank" rel="noopener noreferrer"
              className="font-semibold underline">scheda LoC originale</a> e visualizza
              personalmente l'immagine della pagina. Se non c'è una scansione leggibile,
              non attestare la consultazione. BookWriter non scarica né analizza le immagini.</p>
            <label className="block font-semibold">Pagina / folio esatto osservato
              <input className="field mt-1" aria-label={"Pagina scansione OCR "+chapter.number}
                maxLength={140} value={pageLocator} disabled={locked}
                onChange={ev=>setPageLocator(ev.target.value)}
                placeholder="Pagina 12, colonna 2"/>
            </label>
            <label className="block font-semibold">Breve frase letta direttamente nell'immagine (36–900 caratteri)
              <textarea className="field mt-1 min-h-24"
                aria-label={"Trascrizione scansione OCR "+chapter.number}
                maxLength={900} value={observedText} disabled={locked}
                onChange={ev=>setObservedText(ev.target.value)}
                placeholder="Trascrivi esattamente una frase visibile nella scansione; non copiarla dall'OCR."/>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={observedAttested} disabled={locked}
                onChange={ev=>setObservedAttested(ev.target.checked)}/>
              <span>Dichiaro di avere visto personalmente la scansione del documento e
                trascritto questa frase dall'immagine, non dal file OCR.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={rightsConfirmed} disabled={locked}
                onChange={ev=>setRightsConfirmed(ev.target.checked)}/>
              <span>Confermo di aver verificato la base per conservare questo breve brano e
                autorizzo il possibile invio nei backup, a GitHub e ai modelli AI.</span>
            </label>
            <Button size="sm" variant="outline"
              disabled={locked||!observedAttested||!rightsConfirmed||
                pageLocator.trim().length<4||observedText.trim().length<36}
              onClick={()=>void collate(e.id)}>
              Salva collazione con scansione
            </Button>
          </div>}
        </div>
        <div className="mt-2 space-y-2">
          <Button size="sm" variant="outline" disabled={locked||!!auditingId}
            onClick={()=>void verifySource(e.id)}>
            {auditingId===e.id?"Controllo OCR in corso…":"Riverifica OCR online"}
          </Button>
          {auditResults[e.id]?.matches===true&&<p role="status" className="text-green-700 dark:text-green-300">
            Confronto OCR remoto riuscito il {new Date(auditResults[e.id]!.checkedAt).toLocaleString("it-IT")}:
            riferimento istituzionale, SHA-256, lunghezza e frase coincidono.
            NON autentica l'originale o la licenza; risultato solo temporaneo.
          </p>}
          {auditResults[e.id]?.matches===false&&<div className="space-y-2">
            <p role="alert" className="text-red-700 dark:text-red-300">
              Discordanza OCR remota ({auditResults[e.id]!.reason}):
              la risorsa o il contenuto non coincide con lo snapshot.
              Non usarla come nuova prova finché non hai ricontrollato la fonte.
              Una modifica del catalogo non prova che l'opera storica sia falsa.
            </p>
            <Button size="sm" variant="outline" disabled={locked||!!auditingId}
              onClick={()=>void quarantine(e.id)}>Escludi OCR discordante</Button>
          </div>}
        </div>
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
