import type { BookProject, GitHubRemote } from "../domain/types";
import { BookRevisionConflict, getBook, saveBook } from "../infrastructure/db";
import { validateRemote } from "../infrastructure/github-sync";

/**
 * Manual GitHub settings must not replace a book currently being written by AI,
 * nor re-enable publishing from a stale copy held in another tab.
 *
 * Local locks are intentionally acquired writer -> outbox, the same order as
 * editorial scene confirmation. A remote lease is NOT acquired here because
 * these operations change only browser metadata, not GitHub content.
 */
async function editGitHubSettings(
  bookId: string, expectedUpdatedAt: string,
  edit: (book: BookProject) => { queueSync: boolean },
): Promise<void> {
  if (!expectedUpdatedAt) throw new BookRevisionConflict();
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: impostazioni GitHub non modificabili in sicurezza.");

  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Un'altra scheda sta scrivendo questo libro: riprova dopo la pausa.");
    await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Una sincronizzazione GitHub è ancora in corso: riprova al termine.");
      const current = await getBook(bookId);
      if (!current) throw new Error("Libro non più presente nel browser.");
      if (current.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
      if (current.status === "running")
        throw new Error("Metti prima in pausa l'autopilot e ricarica il libro.");
      const next = structuredClone(current);
      const { queueSync } = edit(next);
      // A second revision check happens in the same IndexedDB transaction as
      // the book + outbox change. A non-cooperating writer cannot slip past it.
      await saveBook(next, queueSync, expectedUpdatedAt);
    });
  });
}

export async function connectBookRemote(
  bookId: string, expectedUpdatedAt: string,
  destination: Pick<GitHubRemote, "owner" | "repository" | "branch">,
): Promise<void> {
  const target = validateRemote(destination);
  await editGitHubSettings(bookId, expectedUpdatedAt, book => {
    const previous = book.remote;
    if (previous?.lastSyncedCommit &&
        (previous.owner !== target.owner || previous.repository !== target.repository ||
         previous.branch !== target.branch))
      throw new Error("Il libro è già sincronizzato altrove. Effettua un backup e una migrazione esplicita.");
    book.remote = { ...previous, ...target };
    return { queueSync: true };
  });
}

export async function setBookAutoSync(
  bookId: string, expectedUpdatedAt: string,
  enabled: boolean, allowPublicSync: boolean,
): Promise<void> {
  await editGitHubSettings(bookId, expectedUpdatedAt, book => {
    if (!book.remote) throw new Error("Collega prima il libro a GitHub.");
    if (enabled) {
      if (book.editorialReviewSceneIds?.length)
        throw new Error("Conferma prima tutte le scene fuse nel Lettore, poi riattiva autosync.");
      if (book.editorialCycle || book.chapters.some(ch =>
          !ch.frozenAt && ch.scenes.some(s => s.status !== "planned")))
        throw new Error("Completa e congela tutti i capitoli in review prima di riattivare autosync.");
      if (!book.remote.lastSyncedCommit)
        throw new Error("Esegui prima una sincronizzazione manuale del libro.");
    }
    book.remote = {
      ...book.remote, autoSync: enabled,
      allowPublicSync: enabled && allowPublicSync,
    };
    // Disabling preserves existing outbox requests; enabling queues a fresh
    // checkpoint only when it is editorially safe, as in the existing flow.
    return { queueSync: enabled };
  });
}
