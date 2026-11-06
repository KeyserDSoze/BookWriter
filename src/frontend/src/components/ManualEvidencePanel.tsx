import { useState } from "react";
import { BookOpenText, ExternalLink, ShieldAlert } from "lucide-react";
import type { BookProject, Chapter } from "../domain/types";
import { activeArchivalItems } from "../domain/archival-catalog";
import { activeManualEvidence, allManualEvidence, type ManualExcerptInput } from "../domain/manual-evidence";
import { attachManualEvidence } from "../application/manual-evidence";
import { Button } from "./ui/button";

export function ManualEvidencePanel({
  book,chapter,onRefresh,
}: {book:BookProject;chapter:Chapter;onRefresh:()=>Promise<void>}) {
  const items=activeArchivalItems(chapter.historicalDossier);
  const excerpts=activeManualEvidence(chapter.historicalDossier);
  const archived=allManualEvidence(chapter.historicalDossier)
    .filter(entry=>!excerpts.some(active=>active.id===entry.id));
  const [catalogItemId,setCatalogItemId]=useState(items[0]?.id ?? "");
  const selectedCatalogId=items.find(item=>item.id===catalogItemId)?.id ?? items[0]?.id ?? "";
  const [locator,setLocator]=useState("");
  const [text,setText]=useState("");
  const [documentDate,setDocumentDate]=useState("");
  const [rightsBasis,setRightsBasis]=useState<ManualExcerptInput["rightsBasis"]>("public_domain");
  const [rightsNote,setRightsNote]=useState("");
  const [attested,setAttested]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const locked=busy||book.status==="running"||!!book.editorialCycle;
  async function save() {
    setError("");setMessage("");
    if(!attested){setError("Conferma prima i diritti e la corrispondenza con il documento.");return;}
    const input:ManualExcerptInput={
      catalogItemId:selectedCatalogId,locator,text,documentDate,rightsBasis,rightsNote,
      rightsAttested:true,
    };
    const selected=items.find(item=>item.id===selectedCatalogId);
    if(!selected){setError("Seleziona una scheda d'archivio ancora attiva.");return;}
    if(!window.confirm([
      "SALVATAGGIO TRASCRIZIONE — CONFERMA AUTORE",
      "Originale consultato personalmente (non verificato dal software):",
      selected.title,selected.url,
      "Collocazione esatta: "+locator,
      "Data/edizione del documento: "+(documentDate||"non indicata"),
      "Base dei diritti: "+rightsBasis,
      "Motivazione diritti: "+rightsNote,
      "",
      "ESTRATTO CHE SARÀ ARCHIVIATO:",
      text,
      "",
      "Nessuna richiesta di rete viene effettuata per salvare: il testo rimane nel libro locale, ma sarà inviato al modello storico/giudice durante la review e potrebbe finire in backup o repository GitHub pubbliche.",
      "Il controllo software prova solo la corrispondenza delle citazioni a QUESTA trascrizione, non l'autenticità della fonte originale.",
      "Aggiornare un capitolo congelato riapre la review e invalida quelli successivi.",
      "Vuoi procedere?",
    ].join("\n")))return;
    setBusy(true);
    try {
      const result=await attachManualEvidence(book.id,chapter.id,book.updatedAt,input);
      setMessage("Estratto archiviato come trascrizione dell'autore. "+
        (result.reopened?"Redazione del capitolo e successivi da ripetere. ":"")+
        "L'originale non è stato autenticato dal software.");
      setText("");setLocator("");setRightsNote("");setAttested(false);setDocumentDate("");
      await onRefresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Impossibile salvare la trascrizione.");
    }finally{setBusy(false);}
  }
  return <details className="mt-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <BookOpenText size={16}/> Estratti da originali consultati dall'autore · {excerpts.length} attivi
    </summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="muted">
        Dopo aver consultato personalmente l'originale, registra un breve estratto da una scheda
        Library of Congress già presente nel catalogo. Devi dichiarare collocazione e diritti.
        Il programma NON legge o autentica il documento; ne controlla solo la trascrizione.
      </p>
      {items.length ? <div className="space-y-3">
        <label className="block font-semibold">Documento del catalogo
          <select className="field mt-1" aria-label={"Documento archivistico capitolo "+chapter.number}
            disabled={locked} value={selectedCatalogId}
            onChange={e=>setCatalogItemId(e.target.value)}>
            {items.map(item=><option key={item.id} value={item.id}>{item.title} · {item.itemId}</option>)}
          </select>
        </label>
        <label className="block font-semibold">Pagina, folio o collocazione precisa
          <input className="field mt-1" aria-label={"Collocazione originale capitolo "+chapter.number}
            disabled={locked} maxLength={140} value={locator}
            placeholder="Pagina 12, colonna 2 / folio 3r"
            onChange={e=>setLocator(e.target.value)}/>
        </label>
        <label className="block font-semibold">Data o edizione del documento (facoltativa)
          <input className="field mt-1" aria-label={"Data documento originale capitolo "+chapter.number}
            disabled={locked} maxLength={100} value={documentDate}
            placeholder="1848, edizione originale"
            onChange={e=>setDocumentDate(e.target.value)}/>
        </label>
        <label className="block font-semibold">Breve trascrizione letterale (24–1200 caratteri)
          <textarea className="field mt-1 min-h-28" aria-label={"Trascrizione originale capitolo "+chapter.number}
            disabled={locked} maxLength={1200} value={text}
            placeholder="Trascrivi solo il passaggio necessario, senza contenuti riservati."
            onChange={e=>setText(e.target.value)}/>
        </label>
        <label className="block font-semibold">Base dichiarata per riutilizzare il testo
          <select className="field mt-1" aria-label={"Base diritti capitolo "+chapter.number}
            disabled={locked} value={rightsBasis}
            onChange={e=>setRightsBasis(e.target.value as ManualExcerptInput["rightsBasis"])}>
            <option value="public_domain">Pubblico dominio (verificato dall'autore)</option>
            <option value="permission">Permesso/licenza ottenuti dall'autore</option>
          </select>
        </label>
        <label className="block font-semibold">Motivazione o riferimento ai diritti (16–280 caratteri)
          <textarea className="field mt-1 min-h-20" aria-label={"Motivazione diritti capitolo "+chapter.number}
            disabled={locked} maxLength={280} value={rightsNote}
            placeholder="Indica la fonte delle condizioni di riutilizzo o l'autorizzazione."
            onChange={e=>setRightsNote(e.target.value)}/>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" disabled={locked}
            checked={attested} onChange={e=>setAttested(e.target.checked)}/>
          <span>Dichiaro di aver consultato il documento originale, verificato la trascrizione e
            di disporre dei diritti necessari alla conservazione e all'invio ai modelli AI.</span>
        </label>
        <Button size="sm" variant="outline" disabled={locked||!attested||!selectedCatalogId||
          locator.trim().length<4||text.trim().length<24||rightsNote.trim().length<16}
          onClick={()=>void save()}>
          {busy?"Salvataggio...":"Archivia estratto attestato"}
        </Button>
      </div> : <p className="muted">Cerca prima una scheda LoC nella sezione «Archivi istituzionali».</p>}
      {chapter.frozenAt && <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
        <ShieldAlert size={15} className="shrink-0"/>
        La nuova trascrizione riapre questo capitolo e invalida i successivi.
      </p>}
      {!!archived.length && <details className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <summary className="cursor-pointer font-semibold">
          Storico trascrizioni non più attive ({archived.length})
        </summary>
        <p className="muted mt-1">
          Queste versioni sono conservate per audit, ma non vengono fornite alle nuove review.
        </p>
        {archived.map(entry=><div key={entry.id} className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
          <a href={entry.url} target="_blank" rel="noopener noreferrer"
            className="text-blue-700 underline dark:text-blue-300">{entry.title}</a>
          <p>Collocazione: {entry.locator} · {new Date(entry.submittedAt).toLocaleString("it-IT")}</p>
          <p className="whitespace-pre-wrap">{entry.text}</p>
          <p className="muted">Diritti dichiarati: {entry.rightsBasis}. {entry.rightsNote}</p>
          <p className="text-amber-700 dark:text-amber-300">Snapshot storico non autenticato, non attivo per nuove citazioni.</p>
        </div>)}
      </details>}
      {excerpts.map(entry=><div key={entry.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <a href={entry.url} rel="noopener noreferrer" target="_blank"
          className="inline-flex items-start gap-1 break-all font-semibold text-blue-700 underline dark:text-blue-300">
          {entry.title}<ExternalLink size={13}/>
        </a>
        <p className="muted">Trascritta dall'autore · {entry.locator} · {entry.documentDate??"data non dichiarata"}</p>
        <p className="mt-1 whitespace-pre-wrap">{entry.text}</p>
        <p className="muted mt-1">Diritti dichiarati: {entry.rightsBasis}. {entry.rightsNote}</p>
        <p className="muted">Registrata il {new Date(entry.submittedAt).toLocaleString("it-IT")}. Non autenticata.</p>
      </div>)}
      {book.editorialCycle&&<p className="muted">Concludi la review attiva prima di aggiungere estratti.</p>}
      {error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {message&&<p role="status">{message}</p>}
    </div>
  </details>;
}
