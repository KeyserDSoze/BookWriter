import { ALL_EDITORIAL_ROLES, ROLE_LABELS, type EditorialRole } from "./editorial-board";
import { entryOf, finalText, openLeaf, parsePartialJson, type PartialNode, type PathStep } from "./partial-json";

/** What a model reply says it has DONE so far, read while it is still being written.
 *
 * A review reply is a list of findings, a judgment is a list of decisions, a plan is a list of
 * chapters: each item that is complete becomes an «action» the author can read at a glance,
 * and the one being written right now is shown next to them. Everything here is derived from
 * the text received; nothing is stored, approved or sent anywhere. An action appears only when
 * its source is complete and never changes afterwards, so a card cannot flicker or be rewritten. */
export type LiveTone = "critical" | "major" | "minor" | "ok" | "accept" | "reject" | "info";
export interface LiveAction { id: string; tone: LiveTone; title: string; badge?: string; detail?: string; meta?: string[] }
export interface LiveForming { label: string; badge?: string; tone?: LiveTone; excerpt?: string }
export interface LiveCounter { label: string; value: number }
export type LiveShape = "report" | "judgment" | "plan" | "scenes" | "memory" | "summary" | "impact" | "research" | "search" | "text" | "structured" | "none";
export interface LiveProgress {
  shape: LiveShape;
  /** What the model is doing, in plain words. */
  headline: string;
  /** Everything finished so far, in the order it was written. */
  actions: LiveAction[];
  /** The item being written right now, if any. */
  forming?: LiveForming;
  counters: LiveCounter[];
}
export interface LiveProgressInput { title: string; text: string }
export type SceneResolver = (sceneId: string) => string | undefined;

const SEVERITY: Record<string, { tone: LiveTone; label: string }> = {
  critical: { tone: "critical", label: "Critico" }, major: { tone: "major", label: "Maggiore" }, minor: { tone: "minor", label: "Minore" },
};
/** The board names its calls: until the first keys say it, the title already tells what to expect. */
function hintShape(title: string): LiveShape | undefined {
  if (/^Redazione: \w+ \d+\/\d+$/.test(title)) return "report";
  if (/^Direttore editoriale:/.test(title)) return "judgment";
  // A search model that answers {"summary":...} instead of {"research_summary":...}: the title tells.
  if (/^Ricerca web: /.test(title)) return "search";
  return undefined;
}

const MEMORY_KINDS: ReadonlyArray<[string, string]> = [
  ["characters", "Personaggio"], ["locations", "Luogo"], ["factions", "Fazione"], ["items", "Oggetto"], ["secrets", "Segreto"],
];
/** Names of the fields a reply writes. Only known names are ever shown: a key that is still
 * half typed («sev») is not. */
const FIELD_NOUN: Record<string, string> = {
  category: "categoria", severity: "gravità", sceneId: "scena", evidence: "citazione", reason: "motivo",
  remediation: "correzione", rationale: "motivazione", action: "decisione", findingId: "rilievo",
  title: "titolo", purpose: "scopo", objective: "obiettivo",
};

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + "…";
}
const tail = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : "…" + flat.slice(-(max - 1)).trimStart();
};

/** «capitolo 2 · scena 3» from the id the planner gives scenes, plus the title when known. */
export function describeSceneRef(id: string, resolve?: SceneResolver): string {
  const match = /^scene:(\d+):(\d+)$/.exec(id);
  const base = match ? `capitolo ${Number(match[1])} · scena ${Number(match[2])}` : clip(id, 40);
  const title = resolve?.(id);
  return title ? `${base} «${clip(title, 40)}»` : base;
}

/** «Redazione: continuity 3/36» is how the board names its calls: say it in words. */
export function describeHeadline(title: string): string {
  const match = /^Redazione: (\w+) (\d+)\/(\d+)$/.exec(title);
  const role = match?.[1] as EditorialRole | undefined;
  if (match && role && (ALL_EDITORIAL_ROLES as readonly string[]).includes(role))
    return `Revisione «${ROLE_LABELS[role]}» · rapporto ${match[2]} di ${match[3]}`;
  return title;
}

const str = (node: PartialNode | undefined, max = 170) => {
  const text = finalText(node);
  return text === undefined ? undefined : clip(text, max);
};
function nodeAt(root: PartialNode | null, path: PathStep[]): PartialNode | undefined {
  let node: PartialNode | undefined = root ?? undefined;
  for (const step of path) {
    if (!node) return undefined;
    node = typeof step === "number" ? (node.type === "array" ? node.items[step] : undefined) : entryOf(node, step);
  }
  return node;
}

/** The shape is read from the keys written so far. Every shape's FIRST key must be listed here:
 * a reply must never be shown as one thing and then turn into another. */
function sniff(root: PartialNode): LiveShape {
  if (root.type !== "object") return "structured";
  const keys = new Set(root.entries.map(entry => entry.key));
  if (root.pendingKey) keys.add(root.pendingKey);
  const has = (...names: string[]) => names.some(name => keys.has(name));
  if (has("web_search")) return "research";
  if (has("research_summary")) return "search";
  if (has("findings", "verdict", "memoryNote")) return "report";
  if (has("decisions", "reasoning")) return "judgment";
  if (has("chapters")) return "plan";
  if (has("scenes")) return "scenes";
  if (has("chapterSummary", "bookSummary", "sceneSummaries")) return "summary";
  if (has("affectedSceneIds", "rationale")) return "impact";
  if (has("mode", "characters", "locations", "factions", "items", "secrets", "timeline", "timelineAdd", "currentState", "sceneSummary", "remove"))
    return "memory";
  return "structured";
}

interface Collector { actions: LiveAction[]; counters: LiveCounter[] }

function describeReport(root: PartialNode & { type: "object" }, resolve?: SceneResolver): Collector {
  const out: Collector = { actions: [], counters: [] };
  let found = 0, critical = 0, major = 0;
  for (const { key, value } of root.entries) {
    if (key === "verdict") {
      const verdict = finalText(value);
      if (verdict === "pass") out.actions.push({ id: "verdict", tone: "ok", title: "Esito: nessun problema trovato" });
      else if (verdict === "issues") out.actions.push({ id: "verdict", tone: "minor", title: "Esito: ha trovato dei problemi" });
    } else if (key === "summary") {
      const text = str(value, 190);
      if (text) out.actions.push({ id: "summary", tone: "info", title: "Sintesi del revisore", detail: text });
    } else if (key === "findings" && value.type === "array") {
      value.items.forEach((item, index) => {
        if (item.type !== "object" || !item.done) return;
        const severity = SEVERITY[finalText(entryOf(item, "severity")) ?? ""];
        const sceneId = finalText(entryOf(item, "sceneId"));
        const category = str(entryOf(item, "category"), 60) ?? "Rilievo";
        found++;
        if (severity?.tone === "critical") critical++;
        if (severity?.tone === "major") major++;
        out.actions.push({
          id: `finding-${index}`, tone: severity?.tone ?? "info", badge: severity?.label, title: category,
          detail: str(entryOf(item, "reason"), 170),
          meta: sceneId ? [describeSceneRef(sceneId, resolve)] : undefined,
        });
      });
    } else if (key === "memoryNote") {
      const text = str(value, 170);
      if (text) out.actions.push({ id: "memory-note", tone: "info", title: "Nota per i prossimi segmenti", detail: text });
    }
  }
  if (found) out.counters.push({ label: found === 1 ? "Rilievo" : "Rilievi", value: found });
  if (critical) out.counters.push({ label: "critici", value: critical });
  if (major) out.counters.push({ label: "maggiori", value: major });
  return out;
}

function describeJudgment(root: PartialNode & { type: "object" }): Collector {
  const out: Collector = { actions: [], counters: [] };
  let accepted = 0, rejected = 0;
  for (const { key, value } of root.entries) {
    if (key === "reasoning") {
      const text = str(value, 200);
      if (text) out.actions.push({ id: "reasoning", tone: "info", title: "Ragionamento complessivo", detail: text });
    } else if (key === "decisions" && value.type === "array") {
      value.items.forEach((item, index) => {
        if (item.type !== "object" || !item.done) return;
        const action = finalText(entryOf(item, "action"));
        const target = clip(finalText(entryOf(item, "findingId")) ?? "?", 28);
        const fix = str(entryOf(item, "remediation"), 110);
        if (action === "accept") accepted++; else if (action === "reject") rejected++;
        out.actions.push({
          id: `decision-${index}`, tone: action === "accept" ? "accept" : action === "reject" ? "reject" : "info",
          badge: action === "accept" ? "Accettato" : action === "reject" ? "Respinto" : undefined,
          title: `${action === "accept" ? "Accetta" : action === "reject" ? "Respinge" : "Valuta"} il rilievo ${target}`,
          detail: str(entryOf(item, "rationale"), 170), meta: action === "accept" && fix ? [`Correzione: ${fix}`] : undefined,
        });
      });
    }
  }
  if (accepted) out.counters.push({ label: accepted === 1 ? "accettato" : "accettati", value: accepted });
  if (rejected) out.counters.push({ label: rejected === 1 ? "respinto" : "respinti", value: rejected });
  return out;
}

function describePlan(root: PartialNode & { type: "object" }): Collector {
  const out: Collector = { actions: [], counters: [] };
  let chapters = 0, scenes = 0;
  for (const { key, value } of root.entries) {
    if (key === "chapters" && value.type === "array") {
      value.items.forEach((chapter, index) => {
        const planned = entryOf(chapter, "scenes");
        if (planned?.type === "array") scenes += planned.items.filter(scene => scene.done).length;
        if (chapter.type !== "object" || !chapter.done) return;
        chapters++;
        out.actions.push({
          id: `chapter-${index}`, tone: "info", title: `Capitolo ${index + 1}: ${str(entryOf(chapter, "title"), 70) ?? "senza titolo"}`,
          detail: str(entryOf(chapter, "purpose"), 170),
          meta: planned?.type === "array" ? [`${planned.items.length} ${planned.items.length === 1 ? "scena" : "scene"}`] : undefined,
        });
      });
    } else if (key === "scenes" && value.type === "array") {
      value.items.forEach((scene, index) => {
        if (scene.type !== "object" || !scene.done) return;
        scenes++;
        out.actions.push({
          id: `scene-${index}`, tone: "info", title: `Scena ${index + 1}: ${str(entryOf(scene, "title"), 70) ?? "senza titolo"}`,
          detail: str(entryOf(scene, "objective"), 170),
        });
      });
    }
  }
  if (chapters) out.counters.push({ label: chapters === 1 ? "capitolo" : "capitoli", value: chapters });
  if (scenes) out.counters.push({ label: scenes === 1 ? "scena" : "scene", value: scenes });
  return out;
}

function describeMemory(root: PartialNode & { type: "object" }): Collector {
  const out: Collector = { actions: [], counters: [] };
  let updated = 0, events = 0;
  for (const { key, value } of root.entries) {
    const kind = MEMORY_KINDS.find(([name]) => name === key);
    if (kind && value.type === "object") {
      for (const entry of value.entries) {
        if (!entry.value.done) continue;
        updated++;
        out.actions.push({ id: `${key}:${entry.key}`, tone: "info", title: `${kind[1]} aggiornato: ${clip(entry.key, 50)}`, detail: str(entry.value, 170) });
      }
    } else if ((key === "timelineAdd" || key === "timeline") && value.type === "array") {
      value.items.forEach((item, index) => {
        const text = str(item, 170);
        if (!text) return;
        events++;
        out.actions.push({ id: `${key}-${index}`, tone: "info", title: "Evento in cronologia", detail: text });
      });
    } else if (key === "sceneSummary" || key === "currentState") {
      const text = str(value, 190);
      if (text) out.actions.push({ id: key, tone: "info", title: key === "sceneSummary" ? "Riassunto della scena" : "Stato attuale della storia", detail: text });
    } else if (key === "remove" && value.type === "object" && value.done) {
      const names = value.entries.flatMap(entry => entry.value.type === "array"
        ? entry.value.items.map(item => finalText(item)).filter((name): name is string => !!name) : []);
      if (names.length) out.actions.push({ id: "remove", tone: "minor", title: `Voci rimosse dalla memoria: ${names.length}`, detail: clip(names.join(", "), 170) });
    }
  }
  if (updated) out.counters.push({ label: updated === 1 ? "voce aggiornata" : "voci aggiornate", value: updated });
  if (events) out.counters.push({ label: events === 1 ? "evento" : "eventi", value: events });
  return out;
}

function describeSummary(root: PartialNode & { type: "object" }, resolve?: SceneResolver): Collector {
  const out: Collector = { actions: [], counters: [] };
  let scenes = 0;
  for (const { key, value } of root.entries) {
    if (key === "sceneSummaries") {
      if (value.type !== "object") continue;
      value.entries.forEach((entry, index) => {
        const text = entry.value.done ? str(entry.value, 190) : undefined;
        if (!text) return;
        scenes++;
        out.actions.push({ id: `scene-summary-${index}`, tone: "info", title: `Riassunto: ${describeSceneRef(entry.key, resolve)}`, detail: text });
      });
      continue;
    }
    const text = str(value, 200);
    if (!text) continue;
    if (key === "chapterSummary") out.actions.push({ id: key, tone: "info", title: "Sinossi del capitolo", detail: text });
    if (key === "bookSummary") out.actions.push({ id: key, tone: "info", title: "Sinossi del libro", detail: text });
  }
  if (scenes) out.counters.push({ label: scenes === 1 ? "riassunto" : "riassunti", value: scenes });
  return out;
}

function describeImpact(root: PartialNode & { type: "object" }, resolve?: SceneResolver): Collector {
  const out: Collector = { actions: [], counters: [] };
  let scenes = 0;
  for (const { key, value } of root.entries) {
    if (key === "rationale") {
      const text = str(value, 200);
      if (text) out.actions.push({ id: "rationale", tone: "info", title: "Motivazione", detail: text });
    } else if (key === "affectedSceneIds" && value.type === "array") {
      value.items.forEach((item, index) => {
        const id = finalText(item);
        if (!id) return;
        scenes++;
        out.actions.push({ id: `scene-${index}`, tone: "major", title: `Scena da rivedere: ${describeSceneRef(id, resolve)}` });
      });
    }
  }
  if (scenes) out.counters.push({ label: scenes === 1 ? "scena coinvolta" : "scene coinvolte", value: scenes });
  return out;
}

/** A task asking for web research instead of answering. */
function describeResearch(root: PartialNode & { type: "object" }): Collector {
  const out: Collector = { actions: [], counters: [] };
  const request = entryOf(root, "web_search");
  if (request?.type !== "object") return out;
  let queries = 0;
  for (const { key, value } of request.entries) {
    if (key === "queries" && value.type === "array") {
      value.items.forEach((item, index) => {
        const query = item.done ? finalText(item) : undefined;
        if (!query) return;
        queries++;
        out.actions.push({ id: `query-${index}`, tone: "info", title: `Vuole cercare: «${clip(query, 70)}»` });
      });
    } else if (key === "reason") {
      const text = str(value, 190);
      if (text) out.actions.push({ id: "reason", tone: "info", title: "Perché le serve", detail: text });
    }
  }
  if (queries) out.counters.push({ label: queries === 1 ? "ricerca" : "ricerche", value: queries });
  return out;
}
/** The search model's answer: a summary and the sources it consulted. */
function describeSearch(root: PartialNode & { type: "object" }): Collector {
  const out: Collector = { actions: [], counters: [] };
  let sources = 0;
  for (const { key, value } of root.entries) {
    if (key === "summary" || key === "research_summary") {
      const text = str(value, 200);
      if (text) out.actions.push({ id: "summary", tone: "info", title: "Sintesi trovata", detail: text });
    } else if (key === "sources" && value.type === "array") {
      value.items.forEach((item, index) => {
        if (item.type !== "object" || !item.done) return;
        sources++;
        out.actions.push({ id: `source-${index}`, tone: "ok", title: `Fonte: ${str(entryOf(item, "title"), 70) ?? "senza titolo"}`,
          detail: str(entryOf(item, "excerpt"), 160), meta: str(entryOf(item, "url"), 80) ? [str(entryOf(item, "url"), 80)!] : undefined });
      });
    }
  }
  if (sources) out.counters.push({ label: sources === 1 ? "fonte" : "fonti", value: sources });
  return out;
}

/** The item being written: where the open value is, and the last words received. */
function describeForming(shape: LiveShape, root: PartialNode): LiveForming | undefined {
  const leaf = openLeaf(root);
  if (!leaf) return undefined;
  const { path } = leaf;
  const top = path[0];
  const field = typeof path[path.length - 1] === "string" ? String(path[path.length - 1]) : undefined;
  const text = leaf.node.type === "string" ? leaf.node.value : undefined;
  const excerpt = text ? tail(text, 150) : undefined;
  const typed = (label: string, badge?: string, tone?: LiveTone): LiveForming => ({ label, badge, tone, excerpt });
  const suffix = field && Object.hasOwn(FIELD_NOUN, field) ? ` · ${FIELD_NOUN[field]}` : "";
  const index = typeof path[1] === "number" ? path[1] + 1 : undefined;

  if (shape === "report") {
    if (top === "findings") {
      const finding = nodeAt(root, path.slice(0, 2));
      const severity = SEVERITY[finalText(entryOf(finding, "severity")) ?? ""];
      if (index === undefined) {
        const done = nodeAt(root, ["findings"]);
        return typed(done?.type === "array" && done.items.length ? "Sta cercando altri problemi…" : "Sta cercando i problemi del testo…");
      }
      return typed(`Sta scrivendo il rilievo ${index}${suffix}`, severity?.label, severity?.tone);
    }
    if (top === "summary") return typed("Sta scrivendo la sintesi del rapporto");
    if (top === "memoryNote") return typed("Sta scrivendo la nota per i prossimi segmenti");
    if (top === "verdict") return typed("Sta decidendo l'esito");
    return typed("Sta preparando il rapporto…");
  }
  if (shape === "judgment") {
    if (top === "decisions") {
      if (index === undefined) return typed("Sta valutando i rilievi…");
      return typed(`Sta decidendo sul rilievo ${index}${suffix}`);
    }
    if (top === "reasoning") return typed("Sta scrivendo il ragionamento complessivo");
    return typed("Sta preparando il giudizio…");
  }
  if (shape === "plan" || shape === "scenes") {
    const inScenes = shape === "plan" ? path[2] === "scenes" : top === "scenes";
    if (shape === "plan" && top === "chapters") {
      if (index === undefined) return typed("Sta pianificando i capitoli…");
      return inScenes && typeof path[3] === "number"
        ? typed(`Sta pianificando il capitolo ${index} · scena ${path[3] + 1}`)
        : typed(`Sta pianificando il capitolo ${index}${suffix}`);
    }
    if (shape === "scenes" && top === "scenes")
      return index === undefined ? typed("Sta pianificando le scene…") : typed(`Sta pianificando la scena ${index}${suffix}`);
    return typed("Sta preparando il piano…");
  }
  if (shape === "memory") {
    const kind = MEMORY_KINDS.find(([name]) => name === top);
    if (kind && typeof path[1] === "string") return typed(`Sta aggiornando ${kind[1].toLowerCase()}: ${clip(path[1], 40)}`);
    if (top === "sceneSummary") return typed("Sta scrivendo il riassunto della scena");
    if (top === "currentState") return typed("Sta scrivendo lo stato attuale della storia");
    if (top === "timelineAdd" || top === "timeline") return typed("Sta aggiungendo un evento alla cronologia");
    return typed("Sta aggiornando la memoria…");
  }
  if (shape === "summary") {
    if (top === "sceneSummaries") return typeof path[1] === "string" ? typed(`Sta scrivendo il riassunto: ${describeSceneRef(path[1])}`) : typed("Sta scrivendo i riassunti delle scene…");
    return typed(top === "bookSummary" ? "Sta scrivendo la sinossi del libro" : "Sta scrivendo la sinossi del capitolo");
  }
  if (shape === "impact") return typed(top === "affectedSceneIds" ? "Sta cercando le scene coinvolte…" : "Sta scrivendo la motivazione");
  if (shape === "research") return typed(path[1] === "reason" ? "Sta spiegando perché le serve una ricerca" : "Sta preparando una ricerca web…");
  if (shape === "search") return typed(top === "sources" ? "Sta elencando le fonti consultate…" : "Sta scrivendo la sintesi della ricerca");
  return typed("Sta scrivendo la risposta…");
}

const HEADING = [
  /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/,
  /^\*\*(.{2,70}?)\*\*:?\s*$/,
  /^([A-ZÀ-Ý][A-ZÀ-Ý0-9 \-–/()]{3,60}):?\s*$/,
];
/** Free text (brainstorming, a scene…): words and paragraphs, and the headed sections. */
function describeText(text: string): Collector {
  const out: Collector = { actions: [], counters: [] };
  const words = (text.match(/\S+/g) ?? []).length;
  if (!words) return out;
  const paragraphs = text.split(/\n\s*\n/).filter(block => block.trim()).length;
  out.counters.push({ label: "parole", value: words }, { label: paragraphs === 1 ? "paragrafo" : "paragrafi", value: paragraphs });
  // a heading counts only once its line is finished: the last line may still be growing
  const lines = text.split("\n");
  lines.pop();
  let section = 0;
  for (const line of lines) {
    for (const pattern of HEADING) {
      const match = pattern.exec(line);
      if (!match) continue;
      out.actions.push({ id: `section-${section++}`, tone: "info", title: `Sezione: ${clip(match[1]!.replace(/[*:#]+$/g, ""), 70)}` });
      break;
    }
  }
  return out;
}

export function describeLiveProgress(input: LiveProgressInput, resolve?: SceneResolver): LiveProgress {
  const headline = describeHeadline(input.title);
  if (!input.text.trim()) return { shape: "none", headline, actions: [], counters: [] };
  const root = parsePartialJson(input.text);
  if (!root || root.type !== "object") {
    const found = describeText(input.text);
    return { shape: "text", headline, ...found };
  }
  const sniffed = sniff(root);
  const shape = sniffed === "structured" ? hintShape(input.title) ?? sniffed : sniffed;
  const found = shape === "report" ? describeReport(root, resolve)
    : shape === "judgment" ? describeJudgment(root)
    : shape === "plan" || shape === "scenes" ? describePlan(root)
    : shape === "memory" ? describeMemory(root)
    : shape === "summary" ? describeSummary(root, resolve)
    : shape === "impact" ? describeImpact(root, resolve)
    : shape === "research" ? describeResearch(root)
    : shape === "search" ? describeSearch(root)
    : { actions: [], counters: [] }; // unknown structure: no card could be trusted not to change later
  return { shape, headline, ...found, forming: root.done ? undefined : describeForming(shape, root) };
}
