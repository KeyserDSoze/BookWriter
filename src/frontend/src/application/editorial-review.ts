import type { Activity, BookProject } from "../domain/types";
import { getBook, saveBookAndActivity } from "../infrastructure/db";

/**
 * Author-only promotion after visually reviewing a previously accepted
 * non-canon merge. Never invokes AI or publishes to GitHub.
 */
export async function confirmEditorialScene(
  bookId: string, sceneId: string, expectedUpdatedAt: string,
): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks non supportato: impossibile confermare la scena in sicurezza.");
  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Un'altra scheda sta scrivendo questo libro.");
    return locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Una sincronizzazione GitHub è ancora in corso.");
      const book = await getBook(bookId);
      if (!book || book.updatedAt !== expectedUpdatedAt || book.status === "running")
        throw new Error("Il libro è cambiato: ricarica e rileggi la scena prima di confermare.");
      if (book.remote?.autoSync)
        throw new Error("Disattiva autosync e conferma la scena prima di sincronizzare.");
      if (!book.editorialReviewSceneIds?.includes(sceneId))
        throw new Error("Questa scena non richiede una conferma editoriale.");
      const scene = book.chapters.flatMap(ch => ch.scenes).find(s => s.id === sceneId);
      if (!scene || scene.status !== "draft" || !scene.text.trim())
        throw new Error("Non puoi canonizzare una scena vuota, assente o già modificata.");
      scene.status = "canon";
      book.editorialReviewSceneIds = book.editorialReviewSceneIds.filter(id => id !== sceneId);
      book.status = "paused";
      if (book.editorialReviewSceneIds.length === 0) {
        book.previousError = "Fusione riletta e confermata. Verifica la continuità prima di un push manuale.";
      }
      const now = new Date().toISOString();
      const activity: Activity = {
        id: crypto.randomUUID(), bookId: book.id, runId: crypto.randomUUID(),
        phase: "review", status: "succeeded",
        title: "Conferma editoriale della scena",
        reason: "L'autore ha riletto ed esplicitamente canonizzato una scena di fusione.",
        nextStep: "Controlla continuità e memoria narrativa, poi sincronizza manualmente GitHub.",
        summary: "Scena " + scene.id + " confermata come canonica dopo la fusione delle versioni.",
        createdAt: now, endedAt: now,
      };
      await saveBookAndActivity(book as BookProject, activity, expectedUpdatedAt);
    });
  });
}
