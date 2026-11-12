import type { BookProject } from "../domain/types";

export const MAX_SEMANTIC_SCENES = 80;
export const MAX_SCENE_EMBED_CHARS = 1400;

export interface SemanticScene {
  id: string;
  chapter: number;
  chapterTitle: string;
  number: number;
  title: string;
  /** A bounded excerpt for indexing; never includes unpublished drafts or private memory. */
  excerpt: string;
}
export interface SemanticMatch {
  scene: SemanticScene;
  similarity: number;
}

/** An explicit author's snapshot of the current book, NOT canonical state.
 * Never read drafts, editorial records, prompts, secrets or unpublished memory. */
export function semanticScenes(book: BookProject): { scenes: SemanticScene[]; omitted: number } {
  const eligible: SemanticScene[] = [];
  for (const chapter of book.chapters) {
    for (const scene of chapter.scenes) {
      if (scene.status !== "canon" || !scene.text.trim()) continue;
      eligible.push({
        id: scene.id, chapter: chapter.number, chapterTitle: chapter.title,
        number: scene.number, title: scene.title,
        excerpt: scene.text.trim().slice(0, MAX_SCENE_EMBED_CHARS),
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
