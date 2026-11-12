import { useEffect, useRef, useState } from "react";
import type { AppSettings, BookProject } from "../domain/types";
import {
  MAX_SEMANTIC_SCENES, rankSemanticScenes, relatedSemanticScenes, semanticEmbeddingInput, semanticScenes,
  type SemanticMatch, type SemanticScene,
} from "../application/semantic-search";
import { embedTextBatch, localEmbeddingSelection, MAX_EMBED_BATCH } from "../infrastructure/embeddings";

interface SearchIndex {
  bookId: string;
  updatedAt: string;
  modelKey: string;
  scenes: SemanticScene[];
  vectors: number[][];
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
    const controller = new AbortController();
    abortRef.current = controller;
    setIndex(null);setMatches([]);setResultKind(null);setBusy("index");setProgress(0);
    setStatus("Indicizzazione richiesta dall'autore: soltanto testo di scene canoniche al server localhost.");
    try {
      const vectors: number[][] = [];
      for (let i=0;i<scenes.length;i+=MAX_EMBED_BATCH) {
        const batch=scenes.slice(i,i+MAX_EMBED_BATCH);
        const encoded = batch.map(s => semanticEmbeddingInput(s.excerpt,selection.route!.modelId,false));
        const rows=await embedTextBatch(settings,encoded,controller.signal);
        if (controller.signal.aborted) return;
        vectors.push(...rows);
        setProgress(vectors.length);
      }
      if (controller.signal.aborted) return;
      // A snapshot is held only in component RAM and discarded on navigation/book changes.
      setIndex({bookId:book.id,updatedAt:book.updatedAt,modelKey,scenes,vectors});
      setStatus(`Indicizzate ${scenes.length} scene in memoria volatile.${omitted ? ` ${omitted} scene escluse (limite ${MAX_SEMANTIC_SCENES}).` : ""} Ora puoi cercare.`);
    } catch(e) {
      if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : "Indicizzazione non riuscita.");
    } finally {
      if (abortRef.current === controller) abortRef.current=null;
      setBusy(null);
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
      const results=rankSemanticScenes(currentIndex.scenes,currentIndex.vectors,vector);
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
      const results = relatedSemanticScenes(currentIndex.scenes,currentIndex.vectors,chosenId);
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
      Indicizza soltanto le scene canoniche, dopo un clic esplicito. Gli estratti
      vengono inviati solo al server embedding su localhost: nessun provider remoto.
      Vettori e risultati restano nella RAM di questa pagina, non nei backup.
    </p>
    <p className="muted mt-2 text-xs">
      {sceneSet.scenes.length} scene canoniche disponibili.
      {sceneSet.omitted ? ` ${sceneSet.omitted} escluse dal limite di ${MAX_SEMANTIC_SCENES}.` : ""}
      {selection.route ? ` Modello: ${selection.route.modelId}.` : ` ${selection.reason}`}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
        onClick={() => void build()} disabled={busy!==null || !selection.route || !sceneSet.scenes.length}>
        {busy==="index" ? `Indicizzazione ${progress}/${sceneSet.scenes.length}` :
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
      {matches.map(({scene,similarity})=>
        <li key={scene.id} className="min-w-0 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
          <p className="font-semibold">Capitolo {scene.chapter} — {scene.chapterTitle}, scena {scene.number}: {scene.title}</p>
          <p className="muted mt-1 text-xs">Affinità coseno: {similarity.toFixed(3)} (ordinamento, non percentuale di certezza)</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{scene.excerpt.slice(0,360)}{scene.excerpt.length>360?"…":""}</p>
          <button type="button" className="mt-2 text-sm underline" onClick={() =>
            document.getElementById(`book-scene-${scene.id}`)?.scrollIntoView({behavior:"smooth",block:"center"})}>
            Vai alla scena
          </button>
        </li>)}
    </ol>}
  </section>;
}
