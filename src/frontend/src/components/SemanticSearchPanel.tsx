import { useEffect, useRef, useState } from "react";
import type { AppSettings, BookProject } from "../domain/types";
import {
  MAX_SEMANTIC_PASSAGES, MAX_SEMANTIC_SCENES, rankSemanticPassages, relatedSemanticPassages, semanticEmbeddingInput, semanticScenes,
  type SemanticMatch, type SemanticScene,
} from "../application/semantic-search";
import { embedTextBatch, localEmbeddingSelection, MAX_EMBED_BATCH } from "../infrastructure/embeddings";

interface SearchIndex {
  bookId: string;
  updatedAt: string;
  modelKey: string;
  scenes: SemanticScene[];
  vectors: number[][][];
}
interface Props {
  book: BookProject;
  settings: AppSettings;
}

export function SemanticSearchPanel({ book, settings }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [matches, setMatches] = useState<SemanticMatch[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [resultKind, setResultKind] = useState<"query" | "related" | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState<"index" | "search" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelKey = JSON.stringify({
    route: settings.capabilityRoutes?.embedding,
    endpoint: settings.endpoints.find(e => e.id === settings.capabilityRoutes?.embedding?.endpointId),
  });
  const currentIndex = index?.bookId === book.id &&
    index.updatedAt === book.updatedAt && index.modelKey === modelKey ? index : null;
  const selection = (() => {
    try { return { route: localEmbeddingSelection(settings), reason: "" }; }
    catch (e) { return { route: null, reason: e instanceof Error ? e.message : "Modello Embedding assente." }; }
  })();
  const sceneSet = semanticScenes(book);
  const passages = sceneSet.scenes.flatMap(scene=>scene.passages??[scene.excerpt]);
  const uncovered = sceneSet.scenes.reduce((sum,scene)=>sum+(scene.uncoveredCharacters??0),0);
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIndex(null);setMatches([]);setReferenceId("");setResultKind(null);
    setStatus("");setProgress(0);setBusy(null);
    return () => { abortRef.current?.abort(); };
  }, [book.id, book.updatedAt, modelKey]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);setStatus("Operazione annullata. L'indice parziale non viene conservato.");
    setProgress(0);
  };

  const build = async () => {
    if (busy || !selection.route) return;
    const { scenes, omitted } = sceneSet;
    if (!scenes.length) {setStatus("Nessuna scena canonica con testo da indicizzare.");return;}
    if (passages.length>MAX_SEMANTIC_PASSAGES)
      {setStatus("Troppi passaggi per l'indice locale: riduci il manoscritto.");return;}
    const controller = new AbortController();
    abortRef.current = controller;
    setIndex(null);setMatches([]);setResultKind(null);setBusy("index");setProgress(0);
    setStatus("Indicizzazione richiesta dall'autore: soltanto testo di scene canoniche al server localhost.");
    try {
      const flatVectors:number[][]=[];
      for(let i=0;i<passages.length;i+=MAX_EMBED_BATCH) {
        const batch=passages.slice(i,i+MAX_EMBED_BATCH);
        const encoded=batch.map(text=>semanticEmbeddingInput(text,selection.route!.modelId,false));
        const rows=await embedTextBatch(settings,encoded,controller.signal);
        if(controller.signal.aborted||abortRef.current!==controller)return;
        flatVectors.push(...rows);
        setProgress(flatVectors.length);
      }
      if(controller.signal.aborted||abortRef.current!==controller)return;
      let offset=0;
      const grouped=scenes.map(scene=>{
        const count=(scene.passages??[scene.excerpt]).length;
        const rows=flatVectors.slice(offset,offset+count);
        offset+=count;return rows;
      });
      if(offset!==flatVectors.length)throw new Error("Indice incompleto: reindicizza il libro.");
      // Only a complete snapshot is kept in RAM. Never persist vectors or partial results.
      setIndex({bookId:book.id,updatedAt:book.updatedAt,modelKey,scenes,vectors:grouped});
      setStatus(`Indicizzate ${scenes.length} scene in memoria volatile (${flatVectors.length} passaggi).`+
        (omitted?` ${omitted} scene escluse (limite ${MAX_SEMANTIC_SCENES}).`:"")+
        (uncovered?` ${uncovered} caratteri non coperti dal campionamento.`:"")+
        " Ora puoi cercare.");
    } catch(e) {
      if(!controller.signal.aborted&&abortRef.current===controller)
        setStatus(e instanceof Error?e.message:"Indicizzazione non riuscita.");
    } finally {
      if(abortRef.current===controller){abortRef.current=null;setBusy(null);}
    }
  };

  const search = async () => {
    if (busy || !currentIndex || !selection.route) return;
    const text = query.trim();
    if (text.length < 3 || text.length > 180) {
      setStatus("Inserisci una ricerca tra 3 e 180 caratteri.");return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("search");setMatches([]);
    try {
      const input = semanticEmbeddingInput(text,selection.route.modelId,true);
      const [vector] = await embedTextBatch(settings,[input],controller.signal);
      if (controller.signal.aborted || !vector) return;
      const results=rankSemanticPassages(currentIndex.scenes,currentIndex.vectors,vector);
      setMatches(results);setResultKind("query");
      setStatus(`Trovati ${results.length} passaggi ordinati per vicinanza semantica (non è un giudizio di verità).`);
    } catch(e) {
      if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : "Ricerca non riuscita.");
    } finally {
      if (abortRef.current === controller) abortRef.current=null;
      setBusy(null);
    }
  };

  const related = () => {
    if (busy || !currentIndex || currentIndex.scenes.length < 2) return;
    try {
      const chosenId = currentIndex.scenes.some(scene => scene.id === referenceId)
        ? referenceId : currentIndex.scenes[0]!.id;
      const results = relatedSemanticPassages(currentIndex.scenes,currentIndex.vectors,chosenId);
      setMatches(results);setResultKind("related");
      setStatus(`Trovate ${results.length} altre scene semanticamente vicine. Controlla personalmente la continuità: la similarità non indica contraddizioni.`);
    } catch (e) {
      setMatches([]);setResultKind(null);
      setStatus(e instanceof Error ? e.message : "Confronto scene non riuscito.");
    }
  };

  return <section aria-label="Ricerca semantica" className="panel min-w-0 p-4 sm:p-5">
    <h2 className="text-lg font-semibold">Ricerca semantica del manoscritto</h2>
    <p className="muted mt-1 text-sm">
      Trova scene collegate a un concetto, anche senza parole identiche.
      Indicizza soltanto le scene canoniche, dopo un clic esplicito. Per scene lunghe
      campiona inizio, centro e finale (fino a tre passaggi da 1.400 caratteri).
      I passaggi vengono inviati solo al server embedding su localhost: nessun provider remoto.
      Vettori e risultati restano nella RAM di questa pagina, non nei backup.
    </p>
    <p className="muted mt-2 text-xs">
      {sceneSet.scenes.length} scene canoniche disponibili, {passages.length} passaggi
      (limite {MAX_SEMANTIC_PASSAGES} vettori per indicizzazione).
      {sceneSet.omitted ? ` ${sceneSet.omitted} scene escluse dal limite di ${MAX_SEMANTIC_SCENES}.` : ""}
      {uncovered>0 ? ` ${uncovered} caratteri non coperti: i risultati non attestano l'assenza di informazioni.` : ""}
      {selection.route ? ` Modello: ${selection.route.modelId}.` : ` ${selection.reason}`}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
        onClick={() => void build()} disabled={busy!==null || !selection.route || !sceneSet.scenes.length}>
        {busy==="index" ? `Indicizzazione ${progress}/${passages.length} passaggi` :
          currentIndex ? "Reindicizza scene" : "Indicizza scene su localhost"}
      </button>
      {busy && <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600" onClick={stop}>Annulla</button>}
    </div>
    <form className="mt-3 space-y-2" onSubmit={event => {event.preventDefault();void search();}}>
      <label htmlFor="semantic-search-question" className="block text-sm font-semibold">
        Cerca nel manoscritto
      </label>
      <input id="semantic-search-question" className="field" value={query} maxLength={180}
        onChange={e => setQuery(e.target.value)}
        placeholder="Es. Dove abbiamo anticipato il tradimento del protagonista?" />
      <button type="submit" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
        disabled={busy!==null || !currentIndex || query.trim().length < 3}>Cerca scene simili</button>
    </form>
    <div role="group" aria-label="Confronto scene per continuità narrativa"
      className="mt-4 space-y-2 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <h3 className="font-semibold">Continuità narrativa: scene collegate</h3>
      <p className="muted text-xs">
        Usa i vettori già calcolati per trovare altre scene collegate alla scena di riferimento.
        Nessuna nuova chiamata AI. I risultati sono indizi da verificare, non segnalazioni automatiche di errori.
      </p>
      <label htmlFor="semantic-related-reference" className="block text-sm font-semibold">Scena di riferimento</label>
      <select id="semantic-related-reference" className="field" disabled={busy!==null || !currentIndex || currentIndex.scenes.length<2}
        value={currentIndex?.scenes.some(scene => scene.id === referenceId) ? referenceId : currentIndex?.scenes[0]?.id ?? ""}
        onChange={e => setReferenceId(e.target.value)}>
        {!currentIndex && <option value="">Indicizza il libro per scegliere una scena</option>}
        {currentIndex?.scenes.map(scene => <option key={scene.id} value={scene.id}>
          Capitolo {scene.chapter}, scena {scene.number}: {scene.title}
        </option>)}
      </select>
      <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
        onClick={related} disabled={busy!==null || !currentIndex || currentIndex.scenes.length<2}>
        Trova scene collegate
      </button>
    </div>
    <p role="status" aria-live="polite" className="muted mt-3 text-sm">{status}</p>
    {matches.length>0 && resultKind && <ol aria-label={resultKind==="related"?"Scene collegate":"Risultati semantici"} className="mt-3 space-y-3">
      {matches.map(({scene,similarity,matchedExcerpt,passageNumber})=>
        <li key={scene.id} className="min-w-0 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
          <p className="font-semibold">Capitolo {scene.chapter} — {scene.chapterTitle}, scena {scene.number}: {scene.title}</p>
          <p className="muted mt-1 text-xs">Affinità coseno: {similarity.toFixed(3)} (ordinamento, non percentuale di certezza)</p>
          {passageNumber && <p className="muted mt-1 text-xs">Passaggio corrispondente {passageNumber} di {(scene.passages??[scene.excerpt]).length}</p>}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{(matchedExcerpt??scene.excerpt).slice(0,360)}{(matchedExcerpt??scene.excerpt).length>360?"…":""}</p>
          <button type="button" className="mt-2 text-sm underline" onClick={() =>
            document.getElementById(`book-scene-${scene.id}`)?.scrollIntoView({behavior:"smooth",block:"center"})}>
            Vai alla scena
          </button>
        </li>)}
    </ol>}
  </section>;
}
