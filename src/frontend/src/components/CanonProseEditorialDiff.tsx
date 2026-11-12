import { useEffect, useRef, useState } from "react";
import { AiTraceReadFence } from "../domain/ai-trace-read-fence";
import { loadTaskProseCheckpoint } from "../infrastructure/task-prose-checkpoint";
import {
  diffProseParagraphs, selectCanonSceneText,
  type CanonSceneIdentity,
} from "../domain/canon-prose-paragraph-diff";
import {
  compareCanonProse, type TaskProseCheckpoint,
} from "../domain/task-prose-checkpoint";

interface Props {
  checkpoint: TaskProseCheckpoint;
}

type ChangedScene = CanonSceneIdentity & {
  kind: "modificata" | "aggiunta" | "rimossa";
};
const PAGE_SIZE = 20;

/** Explicit secondary disclosure of private prose, read-only and per-scene. */
export function CanonProseEditorialDiff({ checkpoint }: Props) {
  const [selected, setSelected] = useState<CanonSceneIdentity | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [reveal, setReveal] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");
  const revealFence=useRef(new AiTraceReadFence());
  useEffect(()=>()=>{revealFence.current.invalidate();},[]);
  const requestReveal=async()=>{
    const ticket=revealFence.current.begin();
    setReveal(false);setRevealError("");setRevealing(true);
    try{
      // A second explicit click must re-check the local consent and record.
      // A deletion/revocation in another tab may have happened since the
      // scene counts were loaded. Never disclose stale prose in that case.
      const stored=await loadTaskProseCheckpoint(checkpoint.bookId,checkpoint.activityId);
      if(!revealFence.current.isCurrent(ticket))return;
      if(stored && stored.before.revision===checkpoint.before.revision &&
        stored.after.revision===checkpoint.after.revision){
        setReveal(true);
      }else setRevealError("Copia locale non più disponibile o consenso revocato: ricarica il confronto.");
    }catch{
      if(revealFence.current.isCurrent(ticket))
        setRevealError("Impossibile verificare il consenso locale: testo privato non mostrato.");
    }finally{
      if(revealFence.current.isCurrent(ticket))setRevealing(false);
    }
  };
  const counts = compareCanonProse(checkpoint);
  const changed: ChangedScene[] = [
    ...counts.modified.map(id => ({ ...id, kind: "modificata" as const })),
    ...counts.added.map(id => ({ ...id, kind: "aggiunta" as const })),
    ...counts.removed.map(id => ({ ...id, kind: "rimossa" as const })),
  ];
  const picked = selected ? selectCanonSceneText(checkpoint, selected) : null;
  // No text comparison or private preview data is computed until an
  // explicit SECOND click following the original consented IDB read.
  const paragraphs = reveal && picked?.kind === "ready"
    ? diffProseParagraphs(picked.before, picked.after) : null;
  return <section aria-label="Confronto editoriale per scena"
    className="mt-3 space-y-2 border-t border-amber-500/30 pt-3">
    <h5 className="font-semibold">Confronto editoriale dei paragrafi</h5>
    <p className="muted text-xs">Seleziona una scena cambiata. Le copie di prosa
      restano nascoste finché non scegli esplicitamente di mostrare
      l’anteprima privata. I paragrafi sono confrontati per uguaglianza
      esatta: non è una correzione automatica né un ripristino.</p>
    {changed.length===0?<p className="text-xs">Nessuna scena canonica
      aggiunta, rimossa o modificata in questo task.</p>:<>
      <div className="max-h-56 space-y-1 overflow-y-auto"
        aria-label="Scene canoniche cambiate">
        {changed.slice(0, visible).map((scene) => {
          const key = JSON.stringify([scene.chapterId,scene.sceneId]);
          const active = selected &&
            selected.chapterId===scene.chapterId && selected.sceneId===scene.sceneId;
          return <button key={key} type="button" aria-pressed={!!active}
            className="block w-full rounded-lg border border-slate-400/40 px-3 py-2 text-left text-xs dark:border-slate-700"
            onClick={()=>{
              revealFence.current.invalidate();
              setSelected({ chapterId:scene.chapterId,sceneId:scene.sceneId });
              setReveal(false);setRevealing(false);setRevealError("");
            }}>
            Seleziona scena {scene.chapterId} / {scene.sceneId} · {scene.kind}
          </button>;
        })}
      </div>
      {visible<changed.length&&<button type="button"
        className="rounded-lg border border-slate-400 px-3 py-2 text-xs"
        onClick={()=>setVisible(x=>Math.min(x+PAGE_SIZE,changed.length))}>
        Mostra altre scene cambiate ({changed.length-visible} rimanenti)
      </button>}
      {selected&&<div className="space-y-2 rounded-lg border border-slate-400/40 p-2"
        aria-label="Scena selezionata per il confronto">
        <p className="text-xs">Scena selezionata: capitolo {selected.chapterId},
          scena {selected.sceneId}. Anteprima privata {reveal?"visibile":"nascosta"}.</p>
        {picked?.kind==="ready"&&<button type="button"
          disabled={revealing}
          className="rounded-lg border border-amber-600 px-3 py-2 text-xs disabled:opacity-40"
          onClick={()=>{
            if(reveal){revealFence.current.invalidate();setReveal(false);}
            else void requestReveal();
          }}>
          {reveal?"Nascondi anteprima privata":
            revealing?"Verifica consenso in corso":"Mostra anteprima privata dei paragrafi"}
        </button>}
        {revealError&&<p role="status" className="text-xs">{revealError}</p>}
        {picked?.kind==="unavailable"&&<p className="text-xs" role="status">
          Scena non disponibile o non modificata nel checkpoint locale.</p>}
        {paragraphs&&<div className="space-y-2"
          role="region" aria-label="Anteprima privata confronto paragrafi">
          {paragraphs.kind==="too_large"?<p className="text-xs" role="status">
            Confronto dettagliato non eseguito: {paragraphs.reason==="characters"
              ?"testo troppo lungo":"troppi paragrafi"}.
            Sono presenti {paragraphs.beforeParagraphs} paragrafi prima
            e {paragraphs.afterParagraphs} dopo. Nessuna porzione viene
            presentata come un diff completo: usa un confronto esterno
            esplicitamente autorizzato, se necessario.</p>:<>
            <p className="text-xs">{paragraphs.beforeParagraphs} paragrafi prima,
              {" "}{paragraphs.afterParagraphs} dopo;
              {" "}{paragraphs.changes} blocchi aggiunti/eliminati
              (una riscrittura può contare come due blocchi).</p>
            {paragraphs.previews.map((item,index)=><div key={index}
              className="rounded-lg border border-slate-400/30 p-2">
              <p className="text-xs font-medium">
                {item.kind==="before"?"Prima · rimosso":"Dopo · aggiunto"}
                {" "}· paragrafo {item.position}
                {item.shortened?` · anteprima abbreviata (originale ${item.originalCharacters} caratteri)`:""}
              </p>
              <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">
                {item.text}
              </pre>
            </div>)}
            {paragraphs.hiddenChanges>0&&<p className="text-xs" role="status">
              Altri {paragraphs.hiddenChanges} blocchi modificati non
              visualizzati: limite esplicito di anteprima, non
              esaurimento di tutte le differenze.</p>}
          </>}
          <p className="muted text-xs">Vista locale e privata, non un diff
            parola per parola; non trasmette testi ad alcun provider e
            non modifica il canone. Nessun undo/merge/rewind abilitato.</p>
        </div>}
      </div>}
    </>}
  </section>;
}
