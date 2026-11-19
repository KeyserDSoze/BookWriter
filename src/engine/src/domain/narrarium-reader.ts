import { EMPTY_MEMORY, type BookProject, type Chapter, type Scene } from "./types";
import { isSceneDocumentPath, readStoredMarkdown, validMarkdownSource, type MarkdownValue } from "./markdown-document";
import { readKnowledgeDocuments } from "./knowledge-markdown";

const entityKinds = ["characters", "locations", "factions", "items", "secrets"] as const;
function invalid(): never { throw new Error("Libro Markdown non valido: controlla metadati, numeri, ID univoci e riferimenti alle schede."); }
function text(meta: Record<string, MarkdownValue>, key: string, max = 300, fallback?: string): string {
  const value = meta[key] ?? fallback;
  if (typeof value !== "string" || value.length > max || (!value.trim() && fallback === undefined)) return invalid();
  return value;
}
function identifier(meta: Record<string, MarkdownValue>, kind: string): string {
  const id = text(meta, "id");
  if (!id.startsWith(kind + ":") || !/^[a-z]+:[a-zA-Z0-9][a-zA-Z0-9_.-]*(?::[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/.test(id)) return invalid();
  return id;
}
function number(meta: Record<string, MarkdownValue>): number {
  const n = meta.number;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > 200) return invalid();
  return n;
}
function list(meta: Record<string, MarkdownValue>, key: string): string[] {
  const values = meta[key] ?? [];
  if (!Array.isArray(values) || values.length > 200 || new Set(values).size !== values.length ||
      values.some(v => typeof v !== "string" || v.length > 300)) return invalid();
  return values;
}

/** Input is an explicit bounded selection of narrative Markdown only. No
 * provider, audit, consent, freeze or running state can be imported from it. */
export function readNarrarium(files: Record<string, string>, bookId: string, now: string): BookProject {
  if (!files["book.md"] || !validMarkdownSource(files)) return invalid();
  const docs = Object.entries(files).map(([path, raw]) => ({ path, ...readStoredMarkdown(path, raw) }));
  const root = docs.find(d => d.path === "book.md")!;
  if (root.metadata.type !== "book") return invalid();
  identifier(root.metadata, "book");
  if (root.metadata.language !== undefined && (typeof root.metadata.language !== "string" || root.metadata.language.length > 40)) return invalid();
  if (root.metadata.genre !== undefined) text(root.metadata, "genre", 300);
  const assertCanon = (meta: Record<string, MarkdownValue>) => {
    if (meta.canon !== undefined && !["canon", "draft", "planned"].includes(String(meta.canon))) return invalid();
  };
  assertCanon(root.metadata);
  const book: BookProject = {
    id: bookId, title: text(root.metadata, "title"), brief: root.body,
    audience: text(root.metadata, "audience", 20_000, ""), writingStyle: "", authorConstraints: [], audienceReviews: [],
    createdAt: now, updatedAt: now, status: "paused", phase: "outline", chapters: [], memory: structuredClone(EMPTY_MEMORY),
    markdownSource: { ...files },
    previousError: "Importato da Markdown: controlla stile, memoria e modelli prima di riprendere. Le dichiarazioni canon non sono approvazioni editoriali; nessun capitolo è congelato.",
  };
  const allIds = new Set<string>([String(root.metadata.id)]);
  const remember = (id: string) => { if (allIds.has(id)) return invalid(); allIds.add(id); };
  const chapters = new Map<string, Chapter>();
  const folders = new Map<string, string>();
  const chapterNumbers = new Set<number>();
  const chapterPovs: string[] = [];
  for (const doc of docs.filter(d => /^chapters\/[^/]+\/chapter\.md$/.test(d.path))) {
    const meta = doc.metadata;
    if (meta.type !== "chapter") return invalid();
    assertCanon(meta);
    if (meta.pov !== undefined && meta.pov !== null && meta.pov !== "") chapterPovs.push(text(meta, "pov"));
    const id = identifier(meta, "chapter"); remember(id);
    const n = number(meta);
    if (chapterNumbers.has(n) || Number(doc.path.split("/")[1]!.slice(0, 3)) !== n) return invalid();
    chapterNumbers.add(n);
    if (doc.body.length > 20_000) return invalid();
    const chapter: Chapter = { id, number: n, title: text(meta, "title"), purpose: doc.body, scenes: [],
      ...(meta.summary !== undefined ? { summary: text(meta, "summary", 6000, "") } : {}) };
    chapters.set(id, chapter); folders.set(doc.path.slice(0, -"chapter.md".length), id);
  }
  if (chapters.size > 200) return invalid();
  for (const doc of docs.filter(d => isSceneDocumentPath(d.path))) {
    const meta = doc.metadata;
    if (meta.type !== "scene" && meta.type !== "paragraph") return invalid();
    const id = identifier(meta, "scene"); remember(id);
    const chapter = chapters.get(text(meta, "chapter"));
    const folder = doc.path.slice(0, doc.path.lastIndexOf("/") + 1);
    if (!chapter || folders.get(folder) !== chapter.id) return invalid();
    const n = number(meta);
    if (chapter.scenes.some(s => s.number === n) || Number(doc.path.split("/").at(-1)!.slice(0, 3)) !== n) return invalid();
    const status = meta.canon;
    if (status !== "planned" && status !== "draft" && status !== "canon") return invalid();
    const title = text(meta, "title");
    let body = doc.body;
    // Read the precisely defined legacy BookWriter paragraph wrapper too.
    if (meta.type === "paragraph" && body.startsWith("# " + title + "\n\n")) body = body.slice(title.length + 4).replace(/\n$/, "");
    if (body.length > 2_000_000) return invalid();
    const scene: Scene = { id, number: n, title, objective: text(meta, "objective", 20_000, ""), text: body, status,
      characters: list(meta, "characters"), locations: list(meta, "locations"), factions: list(meta, "factions"),
      items: list(meta, "items"), secret_refs: list(meta, "secret_refs") };
    const pov = meta.pov ?? meta.viewpoint;
    if (pov !== undefined) {
      if (typeof pov !== "string" || pov.length > 300) return invalid();
      if (pov) scene.viewpoint = pov;
    }
    if (meta.date) scene.date = text(meta, "date", 100);
    if (meta.summary !== undefined) scene.summary = text(meta, "summary", 6000, "");
    chapter.scenes.push(scene);
  }
  const entityIds = new Set<string>();
  for (const folder of entityKinds) for (const doc of docs.filter(d => d.path.startsWith(folder + "/") && d.metadata.type === folder.slice(0, -1))) {
    const kind = folder.slice(0, -1);
    const id = identifier(doc.metadata, kind); remember(id); entityIds.add(id);
    const name = text(doc.metadata, "name", 300, text(doc.metadata, "title", 300, id.slice(kind.length + 1)));
    if (["__proto__", "prototype", "constructor"].includes(name) || Object.hasOwn(book.memory[folder], name)) return invalid();
    // A planned sheet without narrative state yet: no empty memory entry is invented.
    if (doc.metadata.knowledge_only === true && !doc.body.trim()) continue;
    book.memory[folder][name] = doc.body;
  }
  for (const chapter of chapters.values()) {
    chapter.scenes.sort((a, b) => a.number - b.number);
    for (const scene of chapter.scenes) {
      for (const folder of entityKinds) {
        const values = folder === "secrets" ? scene.secret_refs! : scene[folder]!;
        if (values.some(id => !id.startsWith(folder.slice(0, -1) + ":") || !entityIds.has(id))) return invalid();
      }
      if (scene.viewpoint && (!scene.viewpoint.startsWith("character:") || !entityIds.has(scene.viewpoint))) return invalid();
    }
  }
  if (chapterPovs.some(id => !id.startsWith("character:") || !entityIds.has(id))) return invalid();
  book.chapters = [...chapters.values()].sort((a, b) => a.number - b.number);
  if (book.chapters.some(c => c.scenes.some(s => s.text))) book.phase = "prose";
  const bodyAt = (path: string) => docs.find(d => d.path === path)?.body;
  book.writingStyle = bodyAt("guidelines/style.md") ?? bodyAt("guidelines/writing-style.md") ?? "";
  book.memory.currentState = bodyAt("state/current.md") ?? "";
  const timeline = bodyAt("timeline/events.md") ?? bodyAt("timelines/main.md");
  if (timeline !== undefined) book.memory.timeline = [timeline];
  book.bookSummary = bodyAt("reviews/synopsis.md");
  for (const doc of docs.filter(d => d.metadata.type === "chapter_summary")) {
    const chapter = chapters.get(text(doc.metadata, "chapter"));
    if (!chapter || doc.body.length > 6000 || (chapter.summary !== undefined && chapter.summary !== doc.body)) return invalid();
    chapter.summary = doc.body;
  }
  // Structured sheets, events and timelines (format 2). Broken references fail closed.
  const knowledge = readKnowledgeDocuments(docs, new Set(book.chapters.flatMap(c => c.scenes.map(s => s.id))), book.memory, now);
  if (knowledge) book.knowledge = knowledge;
  return book;
}
