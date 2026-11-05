import type { Activity, BookProject, Chapter, Scene } from "./types";

export interface NarrariumProjection {
  files: Record<string, string>;
  manifest: { schemaVersion: number; bookId: string; paths: string[] };
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
export function projectBook(book: BookProject, activities: Activity[]): NarrariumProjection {
  const files: Record<string, string> = {};
  const { remote: _localOnly, ...portable } = book;
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
    (book.authorConstraints?.map(x => "- " + x).join("\n") || "Nessuno") + "\n";
  files["ghostwriters/default.md"] = yaml({ type: "ghostwriter", id: "ghostwriter:default", name: "BookWriter default" }) +
    "# Contratto stilistico\n\n" + book.writingStyle + "\n";
  files["guidelines/writing-style.md"] = "# Indicazioni vincolanti\n\n" + book.writingStyle + "\n";
  files["ideas.md"] = "# Idee e brainstorming\n\n" + (book.ideas ?? "Non ancora generato.") + "\n";
  files["story-design.md"] = "# Progetto del libro\n\n" +
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
