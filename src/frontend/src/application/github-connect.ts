import type { GitHubRemote } from "../domain/types";
import { BookRevisionConflict, getBook, listBooks, saveBook } from "../infrastructure/db";
import { initializeEmptyGitHubRepository, inspectGitHubSetup } from "../infrastructure/github-setup";
import { validateRemote } from "../infrastructure/github-sync";

/** Guided connection: writer -> outbox, live revision, conservative destination
 * probe, optional neutral initialization, then CAS. Never publishes a manuscript. */
export async function connectGitHubBook(bookId: string, expectedUpdatedAt: string,
  destination: GitHubRemote, consentPublic = false, isCurrent: () => boolean = () => true): Promise<void> {
  const target = validateRemote(destination);
  if (!navigator.locks?.request) throw new Error("Web Locks non disponibile: collegamento GitHub bloccato.");
  await navigator.locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Un'altra scheda sta scrivendo questo libro: mettilo prima in pausa.");
    await navigator.locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Sincronizzazione GitHub in corso: riprova al termine.");
      const assertCurrent = async () => {
        if (!isCurrent()) throw new Error("Configurazione GitHub cambiata: ripeti la scelta.");
        const book = await getBook(bookId);
        if (!book || !expectedUpdatedAt || book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
        if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
        if (book.remote?.lastSyncedCommit && (book.remote.owner !== target.owner ||
          book.remote.repository !== target.repository || book.remote.branch !== target.branch))
          throw new Error("Il libro è già sincronizzato altrove. Serve una migrazione esplicita.");
        return book;
      };
      await assertCurrent();
      const others = await listBooks();
      if (others.some(book => book.id !== bookId && book.remote &&
        book.remote.owner.toLowerCase() === target.owner.toLowerCase() &&
        book.remote.repository.toLowerCase() === target.repository.toLowerCase() && book.remote.branch === target.branch))
        throw new Error("Questa repository è già collegata a un altro libro locale. Apri quel libro o scegli un'altra repository.");
      let info = await inspectGitHubSetup(target);
      if (!info.canPush) throw new Error("Il PAT necessita di Contents: read/write su questa repository.");
      if (!info.private && !consentPublic) throw new Error("Repository pubblica: conferma prima la pubblicazione di libro e segreti.");
      if (info.kind === "empty") {
        await initializeEmptyGitHubRepository(target, consentPublic, async () => { await assertCurrent(); });
        info = await inspectGitHubSetup(target);
      }
      if (info.kind === "book" || info.kind === "markdown" || info.kind === "divergent")
        throw new Error("La repository contiene già un libro: usa Importa, senza sostituire il libro locale.");
      if (info.kind !== "available") throw new Error("La repository contiene dati BookWriter o Narrarium non importabili: nessun contenuto modificato.");
      if (!info.canPush || (!info.private && !consentPublic)) throw new Error("Permessi o visibilità GitHub cambiati: ripeti la scelta.");
      const book = await assertCurrent();
      const next = structuredClone(book);
      next.remote = { ...next.remote, ...target };
      await saveBook(next, true, expectedUpdatedAt);
    });
  });
}
