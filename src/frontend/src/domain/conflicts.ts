import type { BookProject, Chapter, Scene } from "./types";

type Field = "title" | "brief" | "writingStyle" | "audience" |
  "authorConstraints" | "ideas" | "validation" | "audienceReviews" | "adversarial";
type EntityKind = "characters" | "locations" | "factions" | "items" | "secrets";
export type ResolutionChoice = "local" | "remote" | "proposal";
export type ConflictOrigin = "only-local" | "only-remote" | "both-changed" | "unknown";

export type ConflictUnit =
  | { id: string; kind: "field"; field: Field; label: string; group: string; origin: ConflictOrigin; local: unknown; remote: unknown }
  | { id: string; kind: "chapter"; chapterId: string; label: string; group: string; origin: ConflictOrigin; local: unknown; remote: unknown }
  | { id: string; kind: "chapterMeta"; chapterId: string; label: string; group: string; origin: ConflictOrigin; local: unknown; remote: unknown }
  | { id: string; kind: "scene"; chapterId: string; sceneId: string; label: string; group: string; origin: ConflictOrigin; local: unknown; remote: unknown }
  | { id: string; kind: "entity"; entityKind: EntityKind; entityName: string; label: string; group: string; origin: ConflictOrigin; local: unknown; remote: unknown }
  | { id: string; kind: "currentState" | "timeline"; label: string; group: string; origin: ConflictOrigin; local: unknown; remote: unknown };

const fields: Array<{ field: Field; label: string }> = [
  { field: "title", label: "Titolo" },
  { field: "brief", label: "Brief e premessa" },
  { field: "writingStyle", label: "Stile di scrittura" },
  { field: "audience", label: "Pubblico" },
  { field: "authorConstraints", label: "Vincoli prioritari dell'autore" },
  { field: "ideas", label: "Idee long/mid/short" },
  { field: "validation", label: "Validazione delle idee" },
  { field: "audienceReviews", label: "Review dei cinque lettori" },
  { field: "adversarial", label: "Revisione avversariale" },
];
const entityLabels: Record<EntityKind, string> = {
  characters: "Personaggi", locations: "Luoghi", factions: "Fazioni",
  items: "Oggetti", secrets: "Segreti",
};

function stable(value: unknown): string {
  if (value === undefined) return "[undefined]";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const dictionary = value as Record<string, unknown>;
  return "{" + Object.keys(dictionary).sort().map(k => JSON.stringify(k) + ":" + stable(dictionary[k])).join(",") + "}";
}
export function sameContent(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
function classification(local: unknown, remote: unknown, base: unknown, hasBase: boolean): ConflictOrigin {
  if (!hasBase) return "unknown";
  const leftChanged = !sameContent(local, base);
  const rightChanged = !sameContent(remote, base);
  if (!leftChanged && rightChanged) return "only-remote";
  if (leftChanged && !rightChanged) return "only-local";
  return "both-changed";
}
function entriesById<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map(item => [item.id, item]));
}
function meta(chapter?: Chapter) {
  return chapter && { title: chapter.title, number: chapter.number, purpose: chapter.purpose };
}
type UnitInput<T> = T extends ConflictUnit ? Omit<T, "origin"> : never;
type ConflictUnitInput = UnitInput<ConflictUnit>;
function pushUnit(
  output: ConflictUnit[], item: ConflictUnitInput, base: unknown, hasBase: boolean,
): void {
  if (sameContent(item.local, item.remote)) return;
  output.push({ ...item, origin: classification(item.local, item.remote, base, hasBase) } as ConflictUnit);
}

/**
 * No text is automatically merged: every affected unit starts with the LOCAL
 * choice, even when the remote was the only change from the common ancestor.
 * Each scene and each canon entity is individually selectable.
 */
export function compareBookVersions(
  local: BookProject, remote: BookProject, base?: BookProject,
): ConflictUnit[] {
  if (local.id !== remote.id || base && base.id !== local.id)
    throw new Error("Le versioni selezionate appartengono a libri differenti.");
  const output: ConflictUnit[] = [];
  const hasBase = !!base;
  for (const { field, label } of fields) {
    pushUnit(output, {
      id: "field:" + field, kind: "field", field, label,
      group: "Progetto e pianificazione", local: local[field], remote: remote[field],
    }, base?.[field], hasBase);
  }

  const localChapters = entriesById(local.chapters);
  const remoteChapters = entriesById(remote.chapters);
  const baseChapters = entriesById(base?.chapters);
  const chapterIds = new Set([...localChapters.keys(), ...remoteChapters.keys()]);
  for (const chapterId of chapterIds) {
    const l = localChapters.get(chapterId);
    const r = remoteChapters.get(chapterId);
    const b = baseChapters.get(chapterId);
    if (!l || !r) {
      pushUnit(output, {
        id: "chapter:" + chapterId, kind: "chapter", chapterId,
        group: "Capitoli e scene", label: "Capitolo: " + (l?.title ?? r?.title ?? chapterId),
        local: l, remote: r,
      }, b, hasBase);
      continue;
    }
    pushUnit(output, {
      id: "chapterMeta:" + chapterId, kind: "chapterMeta", chapterId,
      group: "Capitoli e scene", label: "Capitolo " + l.number + ": titolo, ordine e obiettivo",
      local: meta(l), remote: meta(r),
    }, meta(b), hasBase);

    const localScenes = entriesById(l.scenes);
    const remoteScenes = entriesById(r.scenes);
    const baseScenes = entriesById(b?.scenes);
    for (const sceneId of new Set([...localScenes.keys(), ...remoteScenes.keys()])) {
      const ls = localScenes.get(sceneId);
      const rs = remoteScenes.get(sceneId);
      pushUnit(output, {
        id: "scene:" + JSON.stringify([chapterId, sceneId]),
        kind: "scene", chapterId, sceneId,
        group: "Capitoli e scene",
        label: "Scena: " + (ls?.title ?? rs?.title ?? sceneId),
        local: ls, remote: rs,
      }, baseScenes.get(sceneId), hasBase);
    }
  }

  for (const kind of Object.keys(entityLabels) as EntityKind[]) {
    const left = local.memory[kind], right = remote.memory[kind];
    const ancestor = base?.memory[kind];
    for (const name of new Set([...Object.keys(left), ...Object.keys(right)])) {
      pushUnit(output, {
        id: "entity:" + kind + ":" + JSON.stringify(name),
        kind: "entity", entityKind: kind, entityName: name,
        group: entityLabels[kind], label: name,
        local: left[name], remote: right[name],
      }, ancestor?.[name], hasBase);
    }
  }
  pushUnit(output, {
    id: "currentState", kind: "currentState", label: "Stato narrativo corrente",
    group: "Timeline e continuità", local: local.memory.currentState,
    remote: remote.memory.currentState,
  }, base?.memory.currentState, hasBase);
  pushUnit(output, {
    id: "timeline", kind: "timeline", label: "Cronologia degli eventi",
    group: "Timeline e continuità", local: local.memory.timeline,
    remote: remote.memory.timeline,
  }, base?.memory.timeline, hasBase);
  return output;
}
function clone<T>(data: T): T { return structuredClone(data); }
function updateScene(chapter: Chapter, sceneId: string, value: Scene | undefined) {
  chapter.scenes = chapter.scenes.filter(s => s.id !== sceneId);
  if (value) chapter.scenes.push(clone(value));
  chapter.scenes.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

/**
 * Apply only explicitly selected REMOTE units. This returns an in-memory
 * proposal: persistence, backups, stale checks and remote synchronization are
 * intentionally owned by the infrastructure.
 */
export function assembleBookResolution(
  local: BookProject, remote: BookProject,
  entries: ConflictUnit[], selections: Record<string, ResolutionChoice>,
  acceptedSceneTexts: Record<string, string> = {},
): BookProject {
  if (local.id !== remote.id) throw new Error("Le versioni non appartengono allo stesso libro.");
  const result = clone(local);
  for (const unit of entries) {
    const choice = selections[unit.id] ?? "local";
    if (choice === "local") continue;
    if (choice === "proposal") {
      if (unit.kind !== "scene") throw new Error("Le proposte AI sono ammesse solo sulle scene.");
      const scene = result.chapters.find(ch => ch.id === unit.chapterId)
        ?.scenes.find(s => s.id === unit.sceneId);
      if (!scene || !remote.chapters.find(ch => ch.id === unit.chapterId)
        ?.scenes.some(s => s.id === unit.sceneId)) {
        throw new Error("La proposta richiede due versioni presenti della scena.");
      }
      const text = acceptedSceneTexts[unit.id];
      if (!text?.trim() || text.length > 180_000)
        throw new Error("La proposta di scena non è valida o non è stata approvata.");
      scene.text = text;
      scene.summary = undefined; // Old summary no longer represents this draft.
      scene.status = "draft"; // Explicit review needed before it becomes canon.
      continue;
    }
    if (choice !== "remote") throw new Error("Scelta di recupero non riconosciuta.");
    switch (unit.kind) {
      case "field": {
        const value = remote[unit.field];
        if (value === undefined) delete (result as unknown as Record<string, unknown>)[unit.field];
        else (result as unknown as Record<string, unknown>)[unit.field] = clone(value);
        break;
      }
      case "chapter": {
        result.chapters = result.chapters.filter(ch => ch.id !== unit.chapterId);
        const value = remote.chapters.find(ch => ch.id === unit.chapterId);
        if (value) result.chapters.push(clone(value));
        break;
      }
      case "chapterMeta": {
        const found = result.chapters.find(ch => ch.id === unit.chapterId);
        const value = remote.chapters.find(ch => ch.id === unit.chapterId);
        if (!found || !value) throw new Error("Capitolo modificato durante la composizione.");
        found.title = value.title; found.purpose = value.purpose; found.number = value.number;
        break;
      }
      case "scene": {
        const found = result.chapters.find(ch => ch.id === unit.chapterId);
        const source = remote.chapters.find(ch => ch.id === unit.chapterId);
        if (!found || !source) throw new Error("Capitolo della scena non trovato.");
        updateScene(found, unit.sceneId, source.scenes.find(s => s.id === unit.sceneId));
        break;
      }
      case "entity": {
        const dictionary = result.memory[unit.entityKind];
        const source = remote.memory[unit.entityKind];
        if (!Object.prototype.hasOwnProperty.call(source, unit.entityName)) {
          delete dictionary[unit.entityName];
        } else {
          // Avoid "__proto__" setter side effects from user-controlled canon keys.
          Object.defineProperty(dictionary, unit.entityName, {
            value: source[unit.entityName], enumerable: true, writable: true, configurable: true,
          });
        }
        break;
      }
      case "currentState":
        result.memory.currentState = remote.memory.currentState;
        break;
      case "timeline":
        result.memory.timeline = clone(remote.memory.timeline);
        break;
    }
  }
  result.chapters.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  result.authorConstraints = result.authorConstraints ?? [];
  result.audienceReviews = result.audienceReviews ?? [];
  // Runtime state cannot be safely merged structurally with two AI pipelines.
  result.status = "paused";
  result.currentSceneId = undefined;
  result.revision = undefined;
  result.phase = result.chapters.length ? "prose" : "brainstorm";
  result.previousError = "Risoluzione manuale da GitHub. Controlla scene, segreti e cronologia prima di riprendere l'autopilot.";
  return result;
}

/** Preview prose without inserting untrusted GitHub content as HTML. */
export function shortConflictPreview(value: unknown, limit = 900): string {
  if (value === undefined) return "(assente: scegliere questa versione elimina il contenuto)";
  if (typeof value === "string") return value.length > limit ? value.slice(0, limit) + "…" : value || "(vuoto)";
  const json = JSON.stringify(value, null, 2) ?? "(vuoto)";
  return json.length > limit ? json.slice(0, limit) + "…" : json;
}
