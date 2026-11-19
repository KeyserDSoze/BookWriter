import type { Activity, BookProject, Chapter, Scene } from "./types";
import { isCoreNarrativePath, isNarrativePath, readStoredMarkdown, readMarkdownDocument, writeMarkdownDocument, validMarkdownSource, type MarkdownValue } from "./markdown-document";
import { readNarrarium } from "./narrarium-reader";
import { projectEditorialDocuments } from "./editorial-markdown";
import { findEntity, MEMORY_FOLDER, type EntityType } from "./knowledge";
import { changeReportDocuments, eventMetadata, schemaDocuments, sheetMetadata } from "./knowledge-markdown";
import { editHistoryDocuments } from "./edit-markdown";

export interface NarrariumProjection {
  files: Record<string, string>;
  manifest: { schemaVersion: number; bookId: string; paths: string[]; markdownFormat?: number };
}

function quote(value: string): string { return JSON.stringify(value); }

export function slugify(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "untitled";
}

function num(n: number): string { return String(n).padStart(3, "0"); }
function chapterFolder(chapter: Chapter): string {
  return "chapters/" + num(chapter.number) + "-" + slugify(chapter.title);
}
function scenePath(chapter: Chapter, scene: Scene): string {
  return chapterFolder(chapter) + "/" + num(scene.number) + "-" + slugify(scene.title) + ".md";
}
function entityPath(folder: string, name: string, used: Set<string>): string {
  let path = folder + "/" + slugify(name) + ".md";
  let suffix = 2;
  while (used.has(path)) path = folder + "/" + slugify(name) + "-" + suffix++ + ".md";
  used.add(path);
  return path;
}
function yaml(props: Record<string, string | number | boolean | string[]>): string {
  return "---\n" + Object.entries(props).map(([key, value]) =>
    key + ": " + (Array.isArray(value) ? JSON.stringify(value) :
      typeof value === "string" ? quote(value) : String(value)),
  ).join("\n") + "\n---\n\n";
}
function namedEntries(value: Record<string, string>): Array<[string, string]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * GitHub is a portable, readable narrative repository.
 * A JSON application snapshot is included for lossless browser restoration,
 * while Markdown/frontmatter files remain interoperable with Narrarium.
 * No PAT, OAuth token, provider API key, local device key or remote SHA is exported.
 */
export function projectLegacyBook(book: BookProject, activities: Activity[]): NarrariumProjection {
  const files: Record<string, string> = {};
  const { remote: _localOnly, mergeSession: _operational, ...portable } = book;
  const canonical: BookProject = {
    ...portable,
    status: book.status === "running" ? "paused" : book.status,
    authorConstraints: book.authorConstraints ?? [],
  };

  files[".bookwriter/project.json"] = JSON.stringify(canonical, null, 2) + "\n";
  files[".bookwriter/activities.json"] = JSON.stringify(
    activities.map(a => a.status === "running" ? { ...a, status: "cancelled" } : a), null, 2,
  ) + "\n";

  files["book.md"] = yaml({
    type: "book", id: "book:" + book.id,
    title: book.title, status: canonical.status, ghostwriter: "default",
  }) + "# " + book.title + "\n\n## Premessa\n\n" + book.brief + "\n\n## Pubblico\n\n" + book.audience + "\n";
  files["context.md"] = yaml({ type: "context", id: "context:" + book.id }) +
    "# Contesto e vincoli\n\n" + book.brief + "\n\n## Vincoli prioritari dell'autore\n\n" +
    (book.authorConstraints?.map(x => "- " + x).join("\n") || "Nessuno") + "\n" +
    ((book.authorInterventions?.length ?? 0) > 0 ? "\n## Interventi dell'autore\n\n" +
      book.authorInterventions!.map(x => "- " + x.createdAt + " (" + x.scope + ", durante: " + x.stepLabel + "): " +
        x.instruction.replace(/\n/g, " ")).join("\n") + "\n" : "");
  files["ghostwriters/default.md"] = yaml({ type: "ghostwriter", id: "ghostwriter:default", name: "BookWriter default" }) +
    "# Contratto stilistico\n\n" + book.writingStyle + "\n";
  files["guidelines/writing-style.md"] = "# Indicazioni vincolanti\n\n" + book.writingStyle + "\n";
  files["ideas.md"] = "# Idee e brainstorming\n\n" + (book.ideas ?? "Non ancora generato.") + "\n";
  files["story-design.md"] = "# Progetto del libro\n\n" +
    (book.startMode === "synopsis" && book.authorChapterSynopses?.length ? "## Sinossi vincolante dell'autore\n\n" +
      book.authorChapterSynopses.map((x, i) => (i + 1) + ". " + (x.title ? x.title + " — " : "") + x.synopsis).join("\n") +
      "\n\n## Piano dei capitoli\n\n" : "") +
    (book.chapters.map(c => "## " + c.number + ". " + c.title + "\n\n" + c.purpose).join("\n\n") || "Pianificazione da completare.") + "\n";
  files["plot.md"] = "# Trama e avanzamento\n\n" +
    (book.chapters.map(c => "## Capitolo " + num(c.number) + " — " + c.title + "\n" +
      c.scenes.map(s => "- [" + (s.status === "canon" ? "x" : " ") + "] " + num(s.number) +
        " " + s.title + " — " + s.objective).join("\n")).join("\n\n") || "Nessun capitolo.") + "\n";
  files["evaluations/total.md"] = "# Valutazioni editoriali\n\n## Validazione\n\n" + (book.validation ?? "") +
    "\n\n## Audience panel\n\n" + book.audienceReviews.map((x, i) => "### Profilo " + (i + 1) + "\n\n" + x).join("\n\n") +
    "\n\n## Adversarial review\n\n" + (book.adversarial ?? "") + "\n";
  files["state/current.md"] = yaml({ type: "state", id: "state:current" }) +
    "# Stato della storia\n\n" + book.memory.currentState + "\n" +
    "\n## Entità, possessi e conoscenze\n\n" +
    ["characters", "locations", "factions", "items", "secrets"].map(k => {
      const entries = namedEntries(book.memory[k as keyof typeof book.memory] as Record<string, string>);
      return "### " + k + "\n\n" + entries.map(([name, value]) => "- " + name + ": " + value).join("\n");
    }).join("\n\n") + "\n";
  files["timelines/main.md"] = "# Cronologia narrativa\n\n" +
    book.memory.timeline.map((entry, i) => num(i + 1) + ". " + entry).join("\n") + "\n";

  for (const chapter of book.chapters) {
    const path = chapterFolder(chapter);
    files[path + "/chapter.md"] = yaml({
      type: "chapter", id: chapter.id, number: chapter.number,
      title: chapter.title, canon: chapter.scenes.every(s => s.status === "canon") ? "canon" : "draft",
    }) + "# " + chapter.title + "\n\n" + chapter.purpose + "\n";
    for (const scene of chapter.scenes) {
      files[scenePath(chapter, scene)] = yaml({
        type: "paragraph", id: scene.id, chapter: chapter.id, number: scene.number,
        title: scene.title, canon: scene.status, date: scene.date ?? "",
        viewpoint: scene.viewpoint ?? "", locations: scene.locations ?? [],
        characters: scene.characters ?? [], items: scene.items ?? [],
        factions: scene.factions ?? [], secret_refs: scene.secret_refs ?? [],
      }) + "# " + scene.title + "\n\n" + scene.text + "\n";
    }
  }

  const entityKinds = ["characters", "locations", "factions", "items", "secrets"] as const;
  const used = new Set(Object.keys(files));
  for (const kind of entityKinds) {
    for (const [name, state] of namedEntries(book.memory[kind])) {
      files[entityPath(kind, name, used)] = yaml({
        type: kind.slice(0, -1), id: kind.slice(0, -1) + ":" + slugify(name),
        name, canon: "canon",
      }) + "# " + name + "\n\n" + state + "\n";
    }
  }

  const manifest = {
    schemaVersion: 1,
    bookId: book.id,
    paths: [...Object.keys(files), ".bookwriter/manifest.json"].sort(),
  };
  files[".bookwriter/manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return { files, manifest };
}

/** Portable folders/frontmatter independent of Book.Bot's novel and tools.
 * Format 2 adds editorial documents; format 1 remains comparable for old exports. */
/** Markdown format: 1 = core contract; 2 = + sheets, events, timelines, agent profiles, change
 * reports and JSON Schemas; 3 = + readable edit history and requested reviews (0.22).
 * A repository keeps the format it was pushed with until the next push. */
export type MarkdownFormat = 1 | 2 | 3;
export const MARKDOWN_FORMAT: MarkdownFormat = 3;
export function projectBook(book: BookProject, activities: Activity[], format: MarkdownFormat = MARKDOWN_FORMAT): NarrariumProjection {
  if (book.markdownSource !== undefined && !validMarkdownSource(book.markdownSource))
    throw new Error("Documenti Markdown originali non validi o oltre il limite.");
  const source = book.markdownSource ?? {};
  const old = projectLegacyBook(book, activities);
  const files: Record<string, string> = { ...source };
  const documents = Object.entries(source).map(([path, text]) => ({ path, ...readStoredMarkdown(path, text) }));
  // Source originals are evidence/preservation, not a second live structure.
  // Removing a scene/entity must not resurrect its old file on the next push.
  for (const doc of documents) {
    const type = String(doc.metadata.type);
    if (doc.path.startsWith("chapters/") && isCoreNarrativePath(doc.path) || doc.path === "reviews/synopsis.md" || type === "chapter_summary" ||
        type === "event" && doc.path.startsWith("events/") || type === "timeline" && doc.path.startsWith("timelines/") ||
        ["character", "location", "faction", "item", "secret"].some(kind => type === kind && doc.path.startsWith(kind + "s/")))
      delete files[doc.path];
  }
  delete files["timelines/main.md"]; // read alias, not a second live timeline
  const original = (type: string, id: string) => documents.find(doc => doc.path.startsWith("chapters/") &&
    doc.metadata.type === type && doc.metadata.id === id);
  const written = new Set<string>();
  const write = (path: string, props: Record<string, MarkdownValue>, body: string,
    previous?: Record<string, MarkdownValue>, omit: string[] = []) => {
    if (!isNarrativePath(path) || written.has(path)) throw new Error("Percorso narrativo non valido o duplicato: nessun file generato.");
    written.add(path);
    const metadata = { ...(previous ?? (source[path] ? readMarkdownDocument(source[path]!, false).metadata : {})) };
    for (const key of omit) delete metadata[key];
    files[path] = writeMarkdownDocument({ ...metadata, ...props }, body);
  };
  const qualified = (kind: string, id: string) => id.startsWith(kind + ":") ? id : kind + ":" + id;
  const bookDoc = documents.find(doc => doc.path === "book.md");
  write("book.md", { type: "book", id: String(bookDoc?.metadata.id ?? "book:" + book.id),
    title: book.title, language: bookDoc?.metadata.language ?? "it-IT",
    canon: book.chapters.length > 0 && book.chapters.every(c => c.scenes.length > 0 && c.scenes.every(s => s.status === "canon")) ? "canon" : "draft",
    audience: book.audience }, book.brief);

  // Application-specific aids remain readable; don't replace a hand-written context.
  for (const path of ["context.md", "ideas.md", "story-design.md", "plot.md", "evaluations/total.md"])
    if (!Object.hasOwn(source, path)) files[path] = old.files[path]!;
  const stylePath = Object.hasOwn(source, "guidelines/style.md") ? "guidelines/style.md" : "guidelines/writing-style.md";
  const styleDoc = documents.find(doc => doc.path === stylePath);
  if (styleDoc && Object.keys(styleDoc.metadata).length) write(stylePath, {}, book.writingStyle);
  else files[stylePath] = book.writingStyle;
  write("state/current.md", { type: "state", id: "state:current" }, book.memory.currentState);
  const timeline = source["timeline/events.md"] ?? source["timelines/main.md"];
  const timelineBody = timeline ? readMarkdownDocument(timeline, false).body : undefined;
  write("timeline/events.md", { type: "timeline", id: "timeline:events" },
    book.memory.timeline.length === 1 && book.memory.timeline[0] === timelineBody ? timelineBody! :
      book.memory.timeline.map(entry => "- " + entry).join("\n"));
  if (!Object.hasOwn(source, "secrets/reveal-plan.md"))
    files["secrets/reveal-plan.md"] = "# Piano delle rivelazioni\n\n" +
      "Le schede dei segreti sono in questa cartella. Nessuna soglia viene dedotta automaticamente.\n";
  if (book.bookSummary !== undefined)
    write("reviews/synopsis.md", { type: "synopsis", book: String(bookDoc?.metadata.id ?? "book:" + book.id) }, book.bookSummary);

  const used = new Set(Object.keys(files));
  const refs = new Map<string, string>();
  const ids = new Set<string>();
  const kinds = ["characters", "locations", "factions", "items", "secrets"] as const;
  // Format 2 carries the structured sheets; IDs already written in the Markdown win (stable),
  // so references in sheets and events are translated through this map.
  const kb = format >= 2 && book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const idMap = new Map<string, string>();
  const sheetKeys = (meta?: Record<string, MarkdownValue>) => Object.keys(meta ?? {}).filter(k => k.startsWith("attr_") ||
    ["importance", "summary", "status", "version", "aliases", "relations", "knowledge_only"].includes(k));
  const pendingSheets: Array<() => void> = [];
  for (const folder of kinds) for (const [name, state] of namedEntries(book.memory[folder])) {
    const kind = folder.slice(0, -1);
    const doc = documents.find(d => d.path.startsWith(folder + "/") && d.metadata.type === kind &&
      (d.metadata.name ?? d.metadata.title ?? String(d.metadata.id).slice(kind.length + 1)) === name);
    const sheet = kb && kind !== "secret" ? findEntity(kb, kind as EntityType, name) : undefined;
    const path = doc?.path ?? entityPath(folder, name, used);
    used.add(path);
    const id = String(doc?.metadata.id ?? (sheet && !ids.has(sheet.id) ? sheet.id : kind + ":" + path.split("/").at(-1)!.slice(0, -3)));
    refs.set(folder + ":" + name, id); ids.add(id);
    if (sheet) { idMap.set(sheet.id, id); for (const alias of sheet.aliases) refs.set(folder + ":" + alias, id); }
    pendingSheets.push(() => write(path, { type: kind, id, name, canon: doc?.metadata.canon ?? "canon",
      ...(sheet ? sheetMetadata(sheet, mapId) : {}) }, state, doc?.metadata, kb ? sheetKeys(doc?.metadata ?? (source[path] ? readStoredMarkdown(path, source[path]!).metadata : undefined)) : []));
  }
  // Planned sheets without a memory entry yet: readable, but no memory is invented on import.
  for (const entity of kb?.entities ?? []) {
    if (idMap.has(entity.id)) continue;
    const folder = MEMORY_FOLDER[entity.type];
    const doc = documents.find(d => d.path.startsWith(folder + "/") && d.metadata.id === entity.id);
    const path = doc?.path ?? entityPath(folder, entity.name, used);
    used.add(path);
    const id = ids.has(entity.id) ? entity.type + ":" + path.split("/").at(-1)!.slice(0, -3) : entity.id;
    refs.set(folder + ":" + entity.name, id); ids.add(id); idMap.set(entity.id, id);
    for (const alias of entity.aliases) refs.set(folder + ":" + alias, id);
    pendingSheets.push(() => write(path, { type: entity.type, id, name: entity.name, canon: "draft", knowledge_only: true,
      ...sheetMetadata(entity, mapId) }, "", doc?.metadata, sheetKeys(doc?.metadata)));
  }
  function mapId(id: string): string { return idMap.get(id) ?? id; }
  for (const writeSheet of pendingSheets) writeSheet();
  function reference(folder: typeof kinds[number], value: string): string {
    const kind = folder.slice(0, -1);
    const known = refs.get(folder + ":" + value);
    if (known) return known;
    if (value.startsWith(kind + ":") && ids.has(value)) return value;
    // A declared mention needs a resolvable sheet, not invented biographical facts.
    const path = entityPath(folder, value.startsWith(kind + ":") ? value.slice(kind.length + 1) : value, used);
    const id = value.startsWith(kind + ":") ? value : kind + ":" + path.split("/").at(-1)!.slice(0, -3);
    write(path, { type: kind, id, name: value, canon: "draft" }, "");
    ids.add(id);
    refs.set(folder + ":" + value, id);
    return id;
  }
  for (const chapter of book.chapters) {
    const chapterDoc = original("chapter", chapter.id);
    const folder = chapterDoc && Number(chapterDoc.path.split("/")[1]!.slice(0, 3)) === chapter.number
      ? chapterDoc.path.slice(0, -"/chapter.md".length) : chapterFolder(chapter);
    const id = qualified("chapter", chapter.id);
    write(folder + "/chapter.md", { type: "chapter", id, number: chapter.number,
      title: chapter.title, canon: chapter.scenes.length > 0 && chapter.scenes.every(s => s.status === "canon") ? "canon" : "draft",
      ...(chapter.summary !== undefined ? { summary: chapter.summary } : {}) }, chapter.purpose, chapterDoc?.metadata, ["summary"]);
    if (chapter.summary !== undefined) {
      const summaryDoc = documents.find(d => d.metadata.type === "chapter_summary" && d.metadata.chapter === chapter.id);
      const path = summaryDoc?.path ?? entityPath("reviews", "summary-" + num(chapter.number), used);
      write(path, { type: "chapter_summary", chapter: id }, chapter.summary, summaryDoc?.metadata);
    }
    for (const scene of chapter.scenes) {
      const sceneDoc = original("scene", scene.id) ?? original("paragraph", scene.id);
      const path = sceneDoc && sceneDoc.path.startsWith(folder + "/") && Number(sceneDoc.path.split("/").at(-1)!.slice(0, 3)) === scene.number
        ? sceneDoc.path : folder + "/" + num(scene.number) + "-" + slugify(scene.title) + ".md";
      write(path, { type: "scene", id: qualified("scene", scene.id), chapter: id, number: scene.number,
        title: scene.title, canon: scene.status, pov: scene.viewpoint ? reference("characters", scene.viewpoint) : "",
        date: scene.date ?? "", objective: scene.objective,
        characters: [...new Set((scene.characters ?? []).map(v => reference("characters", v)))],
        locations: [...new Set((scene.locations ?? []).map(v => reference("locations", v)))],
        factions: [...new Set((scene.factions ?? []).map(v => reference("factions", v)))],
        items: [...new Set((scene.items ?? []).map(v => reference("items", v)))],
        secret_refs: [...new Set((scene.secret_refs ?? []).map(v => reference("secrets", v)))],
        ...(scene.summary !== undefined ? { summary: scene.summary } : {}) }, scene.text, sceneDoc?.metadata, ["summary", "viewpoint"]);
    }
  }
  if (kb) {
    const sceneRef = (id: string) => qualified("scene", id);
    for (const timeline of kb.timelines) {
      const doc = documents.find(d => d.metadata.type === "timeline" && d.metadata.id === timeline.id && d.path.startsWith("timelines/"));
      const path = doc?.path ?? entityPath("timelines", "timeline-" + timeline.id.slice("timeline:".length), used);
      write(path, { type: "timeline", id: timeline.id, title: timeline.title, kind: timeline.kind,
        ...(timeline.subjectIds?.length ? { subjects: timeline.subjectIds.map(mapId) } : {}) }, timeline.summary, doc?.metadata, ["subjects"]);
    }
    for (const event of kb.events) {
      const doc = documents.find(d => d.metadata.type === "event" && d.metadata.id === event.id && d.path.startsWith("events/"));
      const path = doc?.path ?? entityPath("events", event.id.slice("event:".length), used);
      // Optional fields removed in the app must not come back from the original file.
      write(path, eventMetadata(event, mapId, sceneRef), event.summary, doc?.metadata, ["chapter", "when"]);
    }
  }
  if (format >= 2) Object.assign(files, projectEditorialDocuments(book), changeReportDocuments(book));
  if (format >= 3) Object.assign(files, editHistoryDocuments(book));
  // A generated repository must satisfy the same contract as a hand-written
  // one, including ID/number uniqueness and resolvable references.
  readNarrarium(files, book.id, book.updatedAt);
  if (format >= 2) Object.assign(files, schemaDocuments(format === 2 ? 2 : 3));
  files[".bookwriter/project.json"] = old.files[".bookwriter/project.json"]!;
  files[".bookwriter/activities.json"] = old.files[".bookwriter/activities.json"]!;
  const manifest = { schemaVersion: 1, markdownFormat: format, bookId: book.id,
    paths: [...Object.keys(files), ".bookwriter/manifest.json"].sort() };
  files[".bookwriter/manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return { files, manifest };
}
