import type { Activity } from "../domain/types";
import type { NarrativeEventCandidate } from "../domain/narrative-event-candidates";
import { createNarrativeEventDecision, type NarrativeEventDecision }
  from "../domain/narrative-event-decisions";
import { getBook, getDb } from "../infrastructure/db";

/** Explicit local author action. No AI calls, automatic canon updates or GitHub push. */
export async function recordNarrativeEventDecision(
  bookId: string, expectedUpdatedAt: string, candidate: NarrativeEventCandidate,
  verdict: NarrativeEventDecision["verdict"], rationale: string,
): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per annotare eventi.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const book = await getBook(bookId);
      if (!book || book.updatedAt !== expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna la pagina prima di decidere.");
      if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      if (book.editorialCycle && book.editorialCycle.stage !== "blocked")
        throw new Error("Concludi o blocca la redazione in corso prima di annotare eventi.");
      const now = new Date().toISOString();
      const decision = createNarrativeEventDecision(book, candidate, verdict, rationale,
        crypto.randomUUID(), now);
      const db = await getDb();
      const tx = db.transaction(["books", "activities", "outbox"], "readwrite");
      const latest = await tx.objectStore("books").get(bookId) as typeof book | undefined;
      if (!latest || latest.updatedAt !== expectedUpdatedAt) {
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: decisione non salvata.");
      }
      book.narrativeEventDecisions = [...(book.narrativeEventDecisions ?? []), decision];
      if (book.remote) book.remote.autoSync = false;
      book.updatedAt = new Date(Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1)).toISOString();
      await tx.objectStore("books").put(book, bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity: Activity = {
        id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(),
        phase: "chapterReview", title: "Decisione autore su menzione narrativa",
        reason: "Conferma esplicita e motivata dell'autore su una citazione congelata.",
        nextStep: "Consultare l'annotazione; eventuali modifiche al canone richiedono una revisione separata.",
        status: "succeeded", createdAt: now, endedAt: now,
        summary: decision.verdict + " · capitolo " + candidate.chapterNumber +
          " · scena " + candidate.sceneNumber + " · offset " + candidate.offset +
          " (nessuna modifica al canone).",
      };
      await tx.objectStore("activities").put(activity, activity.id);
      await tx.done;
    });
  });
}
