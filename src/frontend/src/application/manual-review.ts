import type { BookProject } from "@engine/domain/types";
import type { BookEdit } from "@engine/domain/book-edits";
import { REVIEW_MODE_LABELS, REVIEW_SCOPE_LABELS, type ManualReview } from "@engine/domain/manual-review";
import { cancelManualReview as cancelReview, createManualReview, decideReviewProposal as decide, type ManualReviewRequest } from "@engine/domain/manual-review-flow";
import { mutateCurrentAsAuthor } from "@engine/application/author-mutation";

/** The author asks for a review of the edits they chose. The runner executes it
 * before anything else (start the autopilot if it is not running); no AI here. */
export async function requestManualReview(bookId: string, request: ManualReviewRequest): Promise<{ book: BookProject; review: ManualReview }> {
  const { book, result } = await mutateCurrentAsAuthor<ManualReview>(bookId, review => ({
    title: "Review richiesta: " + REVIEW_SCOPE_LABELS[review.scope].label.toLowerCase(),
    reason: `${REVIEW_MODE_LABELS[review.mode].label}. ` + (review.scope === "impact" ? "Una chiamata AI per l'analisi." :
      `${review.units.length} ${review.units.length === 1 ? "elemento" : "elementi"} da controllare.`),
    nextStep: review.pauseAfter ? "L'autopilot esegue solo la review, poi il libro torna com'era." : "L'autopilot esegue la review prima del prossimo passo.",
  }), (book, now) => createManualReview(book, request, now));
  return { book, review: result };
}

export async function cancelManualReview(bookId: string, reviewId: string): Promise<void> {
  await mutateCurrentAsAuthor(bookId, {
    title: "Review annullata", reason: "Scelta dell'autore: le modifiche incluse tornano «da rivedere».",
    nextStep: "Un'eventuale risposta AI in arrivo per questa review viene scartata.",
  }, (book, now) => cancelReview(book, reviewId, now));
}

export async function decideReviewProposal(bookId: string, reviewId: string, proposalId: string, accept: boolean): Promise<void> {
  await mutateCurrentAsAuthor<BookEdit | undefined>(bookId, edit => edit ? {
    title: "Correzione della review applicata: " + edit.label, reason: "Approvata dall'autore dopo il confronto prima/dopo.",
    nextStep: "La scena corretta è una nuova modifica, da rivedere se vuoi.", summary: edit.label,
  } : { title: "Correzione della review scartata", reason: "Scelta dell'autore: il testo resta com'era.", nextStep: "Nessun effetto sul libro." },
  (book, now) => decide(book, reviewId, proposalId, accept, now));
}
