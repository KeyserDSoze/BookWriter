import type { BookProject } from "./types";

/** Why the book cannot be saved to GitHub right now. Connecting a repository is NOT saving.
 *
 * Since 0.30.0 a work in progress is saved like a finished one: every scene and chapter
 * carries its own `canon: planned|draft|canon` label in the repository, and the full
 * state (review cycle, memory, task log) travels in `.bookwriter/`, so a second PC can
 * continue exactly where this one stopped. The only remaining stop is a merged scene that
 * waits for the author's confirmation: until it is confirmed it must not leave the device. */
export function githubPublicationBlocker(book: BookProject): string | undefined {
  if (book.mergeSession)
    return "Una unione di branch è in attesa di decisioni: concludila o annullala prima di salvare su GitHub.";
  if (book.editorialReviewSceneIds?.length)
    return "Conferma nel Lettore tutte le scene fuse prima di salvare su GitHub. Il testo locale è conservato.";
  return undefined;
}
