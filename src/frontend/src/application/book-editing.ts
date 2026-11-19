import type { BookProject } from "@engine/domain/types";
import { contentStamp, currentStamp, findScene, setReviewState, type BookEdit, type EditTarget, CHANGE_KIND_LABELS } from "@engine/domain/book-edits";
import { addEntity, addEvent, deleteEntity, deleteEvent, deleteTimeline, editChapter, editEntity, editEvent, editMemory, editScene, editSceneMetadata, editStructure,
  editTimeline, moveEvent, restoreBefore, sceneMetaContent, type ChapterPatch, type EditContext, type EntityPatch, type EventPatch, type SceneMetaPatch, type ScenePatch,
  type StructureOperation, type TimelinePatch } from "@engine/domain/book-editing";
import type { EntityType, KnowledgeEntity } from "@engine/domain/knowledge";
import { mutateCurrentAsAuthor, type AuthorActivity } from "@engine/application/author-mutation";

/** The element changed (autopilot, another tab, a restore) after the editor opened it. */
export class ElementChangedError extends Error {
  constructor(label: string) {
    super(`«${label}» è cambiato mentre lo modificavi (dall'autopilot o da un'altra scheda). Le tue modifiche non sono state salvate: controlla la versione nuova, poi salva di nuovo se vuoi sostituirla.`);
    this.name = "ElementChangedError";
  }
}
/** What the editor saw when it opened: the save is refused if the element changed since. */
export interface EditBase { target: EditTarget; stamp: string; label: string }
export function editBase(book: BookProject, target: EditTarget, label: string): EditBase {
  return { target, stamp: currentStamp(book, target), label };
}
const NO_REVIEW = "Nessuna review avviata: decidi tu se e quando controllare la modifica, dalla pagina Revisioni.";
function audit(edit: BookEdit): AuthorActivity {
  const ai = edit.origin === "ai";
  return {
    title: (ai ? "Modifica AI applicata: " : "Modifica manuale: ") + edit.label,
    reason: `Campi: ${edit.field.replace(/\+/g, ", ")}. Tipo di cambiamento: ${CHANGE_KIND_LABELS[edit.changeKind].toLowerCase()}.` + (ai && edit.prompt ? ` Richiesta: «${edit.prompt.slice(0, 200)}».` : ""),
    nextStep: NO_REVIEW,
    summary: edit.label,
  };
}
/** One author edit: guarded by the element's own content, recorded with its audit entry. */
async function applyEdit(bookId: string, base: EditBase | undefined, change: (book: BookProject, ctx: EditContext) => BookEdit,
  origin: EditContext["origin"] = "manual", extra: Partial<EditContext> = {}): Promise<{ book: BookProject; edit: BookEdit }> {
  const { book, result } = await mutateCurrentAsAuthor<BookEdit>(bookId, edit => audit(edit), (book, now) => {
    if (base && currentStamp(book, base.target) !== base.stamp) throw new ElementChangedError(base.label);
    return change(book, { now, origin, ...extra });
  });
  return { book, edit: result };
}

export const saveSceneEdit = (bookId: string, sceneId: string, base: EditBase, patch: ScenePatch) =>
  applyEdit(bookId, base, (book, ctx) => editScene(book, sceneId, patch, ctx));
/** Scene details (point of view, date, who and what is there): guarded by their own content. */
export function sceneMetaBase(book: BookProject, sceneId: string, label: string): EditBase {
  const found = findScene(book, sceneId);
  return { target: { kind: "scene", id: sceneId }, stamp: found ? contentStamp(sceneMetaContent(found.scene)) : "deleted", label };
}
export const saveSceneMetadata = (bookId: string, sceneId: string, base: EditBase, patch: SceneMetaPatch) =>
  applyEdit(bookId, undefined, (book, ctx) => {
    if (sceneMetaBase(book, sceneId, base.label).stamp !== base.stamp) throw new ElementChangedError(base.label);
    return editSceneMetadata(book, sceneId, patch, ctx);
  });
export const saveChapterEdit = (bookId: string, chapterId: string, base: EditBase, patch: ChapterPatch) =>
  applyEdit(bookId, base, (book, ctx) => editChapter(book, chapterId, patch, ctx));
export const saveStructureEdit = (bookId: string, base: EditBase, operation: StructureOperation) =>
  applyEdit(bookId, base, (book, ctx) => editStructure(book, operation, ctx));
export const saveEntityEdit = (bookId: string, entityId: string, base: EditBase, patch: EntityPatch) =>
  applyEdit(bookId, base, (book, ctx) => editEntity(book, entityId, patch, ctx));
export const createEntity = (bookId: string, input: { type: EntityType; name: string; importance: KnowledgeEntity["importance"]; summary: string }) =>
  applyEdit(bookId, undefined, (book, ctx) => addEntity(book, input, ctx));
export const removeEntity = (bookId: string, entityId: string, base: EditBase) =>
  applyEdit(bookId, base, (book, ctx) => deleteEntity(book, entityId, ctx));
export const saveEventEdit = (bookId: string, eventId: string, base: EditBase, patch: EventPatch) =>
  applyEdit(bookId, base, (book, ctx) => editEvent(book, eventId, patch, ctx));
export const createEvent = (bookId: string, input: { title: string; summary: string; timelineId?: string }) =>
  applyEdit(bookId, undefined, (book, ctx) => addEvent(book, input, ctx));
export const removeEvent = (bookId: string, eventId: string, base: EditBase) =>
  applyEdit(bookId, base, (book, ctx) => deleteEvent(book, eventId, ctx));
export const shiftEvent = (bookId: string, eventId: string, direction: -1 | 1, timelineId?: string) =>
  applyEdit(bookId, undefined, (book, ctx) => moveEvent(book, eventId, direction, ctx, timelineId));
export const saveTimelineEdit = (bookId: string, timelineId: string | undefined, base: EditBase | undefined, patch: TimelinePatch) =>
  applyEdit(bookId, base, (book, ctx) => editTimeline(book, timelineId, patch, ctx));
export const removeTimeline = (bookId: string, timelineId: string, base: EditBase) =>
  applyEdit(bookId, base, (book, ctx) => deleteTimeline(book, timelineId, ctx));
/** One part of the narrative memory (`state`, `timeline`, `<folder>:<name>`); `value` null removes an entry. */
export const saveMemoryEdit = (bookId: string, id: string, base: EditBase | undefined, value: string | null) =>
  applyEdit(bookId, base, (book, ctx) => editMemory(book, id, value, ctx));
/** Bring back the version before one edit; recorded as a new manual edit. */
export const restoreEdit = (bookId: string, editId: string, base?: EditBase) =>
  applyEdit(bookId, base, (book, ctx) => restoreBefore(book, editId, ctx));
/** Apply a change the AI proposed and the author accepted after the diff. */
export function applyAiEdit(bookId: string, base: EditBase, prompt: string, aiActivityId: string | undefined,
  change: (book: BookProject, ctx: EditContext) => BookEdit) {
  return applyEdit(bookId, base, change, "ai", { prompt, ...(aiActivityId ? { aiActivityId } : {}) });
}

/** The author decides these changes need no review. Explicit, recorded, reversible. */
export async function skipElementReview(bookId: string, targets: readonly EditTarget[]): Promise<BookProject> {
  if (!targets.length) throw new Error("Scegli almeno una modifica.");
  const { book } = await mutateCurrentAsAuthor(bookId, {
    title: targets.length === 1 ? "Review saltata per una modifica" : `Review saltata per ${targets.length} modifiche`,
    reason: "Scelta dell'autore: queste modifiche non vengono controllate.",
    nextStep: "Se modifichi di nuovo questi elementi torneranno «da rivedere».",
  }, book => {
    if (book.manualReviews?.some(r => (r.status === "pending" || r.status === "in_progress") && r.targets.some(t => targets.some(x => x.kind === t.kind && x.id === t.id))))
      throw new Error("Una review in corso include questi elementi: annullala prima.");
    setReviewState(book, targets, "review_skipped");
  });
  return book;
}
