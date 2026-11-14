import type { BookProject } from "./types";

/** Presentation of the existing editorial publication gates. Connecting a
 * repository is NOT publication and must not imply that these gates passed. */
export function githubPublicationBlocker(book: BookProject): string | undefined {
  if (book.editorialReviewSceneIds?.length)
    return "Conferma nel Lettore tutte le scene fuse prima di pubblicare su GitHub. Il testo locale è conservato.";
  if (book.phase === "revision")
    return "Completa la revisione in corso prima di pubblicare su GitHub. Il testo locale è conservato.";
  if (book.editorialCycle || book.chapters.some(chapter =>
    !chapter.frozenAt && chapter.scenes.some(scene => scene.status !== "planned")))
    return "Completa la redazione del capitolo in corso prima di pubblicare su GitHub: il capitolo non è ancora congelato. Il collegamento è pronto e il lavoro locale è conservato.";
  return undefined;
}
