import type { BookProject } from "../domain/types";

export const MAX_SEMANTIC_SCENES = 80;
export const MAX_SCENE_EMBED_CHARS = 1400;
export const MAX_SCENE_EMBED_PASSAGES = 3;
export const MAX_SEMANTIC_PASSAGES = MAX_SEMANTIC_SCENES * MAX_SCENE_EMBED_PASSAGES;

/** Sampled regions of a scene, not a claim that every word is indexed. */
export interface ScenePassageSample {
  passages: string[];
  uncoveredCharacters: number;
}
function lowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }
function highSurrogate(code: number): boolean { return code >= 0xd800 && code <= 0xdbff; }

/** At most three segments: for a long scene cover beginning, middle AND end.
 * Use UTF-16 units to keep the request within the API's 1600-char cap;
 * never split a surrogate pair. A short scene is covered entirely. */
export function sampleSemanticPassages(text: string): ScenePassageSample {
  const source = text.trim();
  if (!source) return { passages: [], uncoveredCharacters: 0 };
  const size = MAX_SCENE_EMBED_CHARS;
  const spans: Array<[number,number]> = [];
  if (source.length <= size * MAX_SCENE_EMBED_PASSAGES) {
    for(let start=0;start<source.length;) {
      let end=Math.min(start+size,source.length);
      if(end<source.length && highSurrogate(source.charCodeAt(end-1)))end--;
      if(end<=start)throw new Error("Impossibile suddividere una scena per la ricerca.");
      spans.push([start,end]);start=end;
    }
  }
  // UTF-16 surrogate boundaries can make a 4200-unit scene require four
  // contiguous 1400-unit pieces. In that edge case sample three regions and
  // declare the uncovered units rather than exceeding the request budget.
  if(spans.length===0 || spans.length>MAX_SCENE_EMBED_PASSAGES) {
    spans.length=0;
    const starts=[0,Math.floor((source.length-size)/2),source.length-size];
    for(const originalStart of starts) {
      // Never overlap the preceding sampled range even at UTF-16 boundaries.
      let start=Math.max(originalStart,spans.at(-1)?.[1]??0);
      if(start>0 && lowSurrogate(source.charCodeAt(start)))start++;
      let end=Math.min(start+size,source.length);
      if(end<source.length && highSurrogate(source.charCodeAt(end-1)))end--;
      if(end<=start)throw new Error("Impossibile campionare una scena per la ricerca.");
      spans.push([start,end]);
    }
  }
  const passages=spans.map(([start,end])=>source.slice(start,end));
  const covered=spans.reduce((sum,[start,end])=>sum+end-start,0);
  return { passages, uncoveredCharacters: Math.max(0,source.length-covered) };
}

export interface SemanticScene {
  id: string;
  chapter: number;
  chapterTitle: string;
  number: number;
  title: string;
  /** A bounded excerpt for indexing; never includes unpublished drafts or private memory. */
  excerpt: string;
  /** Sampled portions, explicitly bounded; legacy records can omit these. */
  passages?: string[];
  uncoveredCharacters?: number;
}
export interface SemanticMatch {
  scene: SemanticScene;
  similarity: number;
  /** Best matching passage, which can occur later in a long scene. */
  matchedExcerpt?: string;
  passageNumber?: number;
}

/** An explicit author's snapshot of the current book, NOT canonical state.
 * Never read drafts, editorial records, prompts, secrets or unpublished memory. */
export function semanticScenes(book: BookProject): { scenes: SemanticScene[]; omitted: number } {
  const eligible: SemanticScene[] = [];
  for (const chapter of book.chapters) {
    for (const scene of chapter.scenes) {
      if (scene.status !== "canon" || !scene.text.trim()) continue;
      const sample=sampleSemanticPassages(scene.text);
      eligible.push({
        id: scene.id, chapter: chapter.number, chapterTitle: chapter.title,
        number: scene.number, title: scene.title,
        excerpt: sample.passages[0]!,
        passages: sample.passages,
        uncoveredCharacters: sample.uncoveredCharacters,
      });
    }
  }
  return { scenes: eligible.slice(0, MAX_SEMANTIC_SCENES),
    omitted: Math.max(0, eligible.length - MAX_SEMANTIC_SCENES) };
}

/** Nomic Embed Text v1.5 requires asymmetrical task prefixes for retrieval. 
 * These prefixes are formatting instructions, never inferred model capabilities. */
export function semanticEmbeddingInput(text: string, modelId: string, query: boolean): string {
  return /nomic[-/]embed[-/]text/i.test(modelId)
    ? `${query ? "search_query" : "search_document"}: ${text}`
    : text;
}

/** Reuse vectors already approved for local indexing: no new requests or
 * model-generated statements. The reference scene must not recommend itself. */
export function relatedSemanticScenes(
  scenes: SemanticScene[], vectors: number[][], referenceId: string, limit = 5,
): SemanticMatch[] {
  if (scenes.length !== vectors.length)
    throw new Error("Indice semantico incoerente: reindicizza il libro.");
  const referenceIndex = scenes.findIndex(scene => scene.id === referenceId);
  if (referenceIndex < 0)
    throw new Error("Scena di riferimento non presente nell'indice: reindicizza il libro.");
  const others: SemanticScene[] = [];
  const otherVectors: number[][] = [];
  for (let i = 0; i < scenes.length; i++) {
    if (i !== referenceIndex) {
      others.push(scenes[i]!);
      otherVectors.push(vectors[i]!);
    }
  }
  return rankSemanticScenes(others, otherVectors, vectors[referenceIndex]!, limit);
}

/** Cosine similarity is a ranking signal, not proof of semantic truth. */
export function rankSemanticScenes(
  scenes: SemanticScene[], vectors: number[][], query: number[], limit = 5,
): SemanticMatch[] {
  if (scenes.length !== vectors.length || query.length < 1 ||
      query.some(x => !Number.isFinite(x)))
    throw new Error("Indice semantico incoerente: reindicizza il libro.");
  const norm = (v: number[]) => Math.hypot(...v);
  const qn = norm(query);
  if (!Number.isFinite(qn) || qn <= 0)
    throw new Error("Ricerca semantica non valida: vettore della domanda vuoto.");
  const results = scenes.map((scene, index) => {
    const v = vectors[index]!;
    if (v.length !== query.length || v.some(x => !Number.isFinite(x)))
      throw new Error("Dimensione degli embedding non coerente: reindicizza il libro.");
    const vn = norm(v);
    if (!Number.isFinite(vn) || vn <= 0)
      throw new Error("Embedding di una scena non valido.");
    const similarity = v.reduce((sum, x, n) => sum + x * query[n]!, 0) / (vn * qn);
    if (!Number.isFinite(similarity)) throw new Error("Similarità non valida.");
    return { scene, similarity };
  });
  return results.sort((a,b) => b.similarity - a.similarity)
    .slice(0, Math.max(1, Math.min(limit,10)));
}

/** Strictly validate an all-or-nothing embedding snapshot before ranking.
 * Every sampled passage must have exactly one valid vector of equal dimensions. */
function validatedPassageVectors(scenes: SemanticScene[], vectors: number[][][]): number {
  if(scenes.length!==vectors.length)throw new Error("Indice semantico incoerente: reindicizza il libro.");
  let dims=0;
  const ids=new Set<string>();
  for(let i=0;i<scenes.length;i++){
    const scene=scenes[i]!;
    const samples=scene.passages??[scene.excerpt];
    const rows=vectors[i];
    if(ids.has(scene.id)||!samples.length||samples.length>MAX_SCENE_EMBED_PASSAGES ||
       !rows||samples.length!==rows.length)
      throw new Error("Indice dei passaggi incoerente: reindicizza il libro.");
    ids.add(scene.id);
    for(const row of rows){
      if(!Array.isArray(row)||row.length<2||row.some(x=>!Number.isFinite(x)))
        throw new Error("Embedding di un passaggio non valido.");
      const norm=Math.hypot(...row);
      if(!Number.isFinite(norm)||norm<=0)
        throw new Error("Embedding di un passaggio non valido.");
      if(dims!==0 && row.length!==dims)
        throw new Error("Dimensione degli embedding non coerente: reindicizza il libro.");
      dims=row.length;
    }
  }
  return dims;
}
function cosinePassage(a:number[],b:number[]):number {
  if(a.length!==b.length||a.some(x=>!Number.isFinite(x))||b.some(x=>!Number.isFinite(x)))
    throw new Error("Dimensione degli embedding non coerente: reindicizza il libro.");
  const divisor=Math.hypot(...a)*Math.hypot(...b);
  if(!Number.isFinite(divisor)||divisor<=0)
    throw new Error("Embedding di un passaggio non valido.");
  const result=a.reduce((sum,value,i)=>sum+value*b[i]!,0)/divisor;
  if(!Number.isFinite(result))throw new Error("Similarità non valida.");
  return result;
}
function orderedMatches(matches:SemanticMatch[],limit:number):SemanticMatch[] {
  return matches.sort((a,b)=>b.similarity-a.similarity)
    .slice(0,Math.max(1,Math.min(limit,10)));
}

/** Best passage per scene: one result per scene even if it has 3 embeddings. */
export function rankSemanticPassages(
  scenes:SemanticScene[], vectors:number[][][], query:number[],limit=5,
):SemanticMatch[] {
  const dims=validatedPassageVectors(scenes,vectors);
  if(!Array.isArray(query)||query.length!==dims||query.some(x=>!Number.isFinite(x))||
      !Number.isFinite(Math.hypot(...query))||Math.hypot(...query)<=0)
    throw new Error("Vettore della ricerca non valido o con dimensione incoerente.");
  return orderedMatches(scenes.map((scene,i)=>{
    let best:SemanticMatch|null=null;
    const samples=scene.passages??[scene.excerpt];
    for(let j=0;j<samples.length;j++){
      const score=cosinePassage(vectors[i]![j]!,query);
      if(!best||score>best.similarity)
        best={scene,similarity:score,matchedExcerpt:samples[j]!,passageNumber:j+1};
    }
    return best!;
  }),limit);
}

/** Compare all source passages to all other scenes from RAM: no API calls. */
export function relatedSemanticPassages(
  scenes:SemanticScene[],vectors:number[][][],referenceId:string,limit=5,
):SemanticMatch[] {
  validatedPassageVectors(scenes,vectors);
  const source=scenes.findIndex(s=>s.id===referenceId);
  if(source<0)throw new Error("Scena di riferimento non presente nell'indice.");
  const referenceVectors=vectors[source]!;
  return orderedMatches(scenes.flatMap((scene,i)=>{
    if(i===source)return [];
    const samples=scene.passages??[scene.excerpt];
    let best:SemanticMatch|null=null;
    for(let j=0;j<samples.length;j++){
      for(const referenceVector of referenceVectors){
        const score=cosinePassage(vectors[i]![j]!,referenceVector);
        if(!best||score>best.similarity)
          best={scene,similarity:score,matchedExcerpt:samples[j]!,passageNumber:j+1};
      }
    }
    return best?[best]:[];
  }),limit);
}
