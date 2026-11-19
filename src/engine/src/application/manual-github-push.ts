import { prepareManualPushIntent } from "../infrastructure/manual-push-intent";
import { pushGitHubBook, type PushResult } from "../infrastructure/github-sync";
import { host } from "../core/host";
import { withExclusiveLock } from "../core/store";

/**
 * The manual button, unlike the autosync worker, must persist its operation ID
 * before HTTP so a page reload can recover the exact remote marker. Hold both
 * existing local locks through the ACK; do not interfere with a live writer or
 * an outbox upload from another tab.
 */
export async function pushManualGitHubBook(
  bookId: string, consentPublic = false,
): Promise<PushResult> {
  return host().withBookScope(bookId, () =>
    withExclusiveLock("bookwriter:writer:" + bookId, {
      busy: "Un'altra scheda sta scrivendo questo libro: attendi la pausa.",
      unsupported: "Web Locks non disponibile: push manuale bloccato per evitare conflitti.",
    }, () => withExclusiveLock("bookwriter:github-outbox", { busy: "Un'altra sincronizzazione GitHub è in corso." }, async () => {
      const intent = await prepareManualPushIntent(bookId);
      return pushGitHubBook(bookId, consentPublic, { operationId: intent.operationId });
    })));
}
