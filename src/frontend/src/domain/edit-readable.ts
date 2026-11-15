import type { BookEdit } from "./book-edits";
import { SCENE_META_FIELD, SCENE_META_LABELS, SCENE_META_LISTS, type SceneMetaList } from "./book-editing";
import { describeProfiles, type EditorialProfiles } from "./editorial-profiles";

/** Human-readable version of a stored edit snapshot, for the comparison and for the review prompts. */
export function readableSnapshot(edit: BookEdit, side: "before" | "after"): string {
  const raw = edit[side];
  if (raw === null) return edit.target.kind === "profiles" ? describeProfiles(null) : "";
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (edit.target.kind === "memory") return typeof value.value === "string" ? value.value : "";
    if (edit.target.kind === "scene" && edit.field.startsWith(SCENE_META_FIELD)) {
      const meta = value as { viewpoint?: string; date?: string } & Partial<Record<SceneMetaList, string[]>>;
      return [`Punto di vista: ${meta.viewpoint || "—"}`, `Data: ${meta.date || "—"}`,
        ...SCENE_META_LISTS.map(key => `${SCENE_META_LABELS[key][0]!.toUpperCase() + SCENE_META_LABELS[key].slice(1)}: ${(meta[key] ?? []).join(", ") || "—"}`)].join("\n");
    }
    if (edit.target.kind === "scene" && typeof value.text === "string") return `${String(value.title ?? "")}\n\n${value.text}` + (value.summary ? `\n\nRiassunto: ${String(value.summary)}` : "");
    if (edit.target.kind === "structure") return Array.isArray(value) ? value.map((row, i) => `Capitolo ${i + 1}: ${(row as string[]).length - 1} scene`).join("\n") : "";
    if (edit.target.kind === "profiles") return describeProfiles(value as unknown as EditorialProfiles);
    const inner = (value.entity ?? value.event ?? value.chapter ?? value.scene ?? value) as Record<string, unknown>;
    return Object.entries(inner).filter(([key]) => !["history", "version", "updatedAt", "origin"].includes(key))
      .map(([key, field]) => `${key}: ${typeof field === "string" ? field : JSON.stringify(field)}`).join("\n");
  } catch { return raw; }
}
