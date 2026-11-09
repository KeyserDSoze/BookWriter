import { prepareManualPushIntent } from "../infrastructure/manual-push-intent";
import { pushGitHubBook, type PushResult } from "../infrastructure/github-sync";

/**
 * The manual button, unlike the autosync worker, must persist its operation ID
 * before HTTP so a page reload can recover the exact remote marker. Hold both
 * existing local locks through the ACK; do not interfere with a live writer or
 * an outbox upload from another tab.
 */
export async function pushManualGitHubBook(
  bookId: string, consentPublic = false,
): Promise<PushResult> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: push manuale bloccato per evitare conflitti.");
  return await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Un'altra scheda sta scrivendo questo libro: attendi la pausa.");
    return await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Un'altra sincronizzazione GitHub è in corso.");
      const intent = await prepareManualPushIntent(bookId);
      return await pushGitHubBook(bookId, consentPublic, { operationId: intent.operationId });
    });
  });
}
