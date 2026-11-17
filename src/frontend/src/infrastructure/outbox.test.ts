import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { newBook, type Activity } from "../domain/types";
import { getBook, getDb, saveBook, saveBookAndActivity } from "./db";
import {
  acknowledgeOutbox, deferAttempt, enqueueIfUnsaved, getOutbox, markAttempt, recordSyncFailure, retryBlockedSync,
} from "./outbox";
import { createEditorialCycle } from "../domain/editorial-board";

function book() {
  const b = newBook("Un mondo pieno di misteri", "Il diario", "Preciso", "Adulti");
  b.remote = {
    owner: "test-owner", repository: "book-repo", branch: "main",
    lastSyncedCommit: "a".repeat(40), autoSync: true,
  };
  return b;
}
function activity(bookId: string, phase: Activity["phase"], status: Activity["status"]): Activity {
  return {
    bookId, id: crypto.randomUUID(), runId: crypto.randomUUID(),
    phase, status, title: "Checkpoint", reason: "Test atomico",
    nextStep: "Proseguire", createdAt: new Date().toISOString(),
  };
}

describe("Outbox IndexedDB atomica", () => {
  it("ogni compito riuscito chiede un salvataggio (una sola voce per libro), un compito fallito no", async () => {
    const b = book();
    await saveBook(b, false);
    await saveBookAndActivity(b, activity(b.id, "brainstorm", "succeeded"));
    const queued = await getOutbox(b.id);
    expect(queued?.state).toBe("pending");
    expect(queued?.revision).toBe(1);
    await saveBookAndActivity(b, activity(b.id, "prose", "succeeded"));
    await saveBookAndActivity(b, activity(b.id, "review", "succeeded"));
    const after = await getOutbox(b.id);
    expect(after?.operationId).toBe(queued?.operationId); // coalesced, not one item per task
    expect(after?.revision).toBe(3);
    await saveBookAndActivity(b, activity(b.id, "chapterReview", "failed"));
    await saveBookAndActivity(b, activity(b.id, "prose", "cancelled"));
    expect((await getOutbox(b.id))?.revision).toBe(3);
  });

  it("un libro a metà lavoro (capitolo non congelato, ciclo editoriale, revisione) si accoda come uno finito", async () => {
    const b = book();
    b.phase = "revision";
    b.editorialCycle = createEditorialCycle("ch-1");
    b.chapters = [{ id: "ch-1", number: 1, title: "Uno", purpose: "Uno scopo narrativo.", scenes: [
      { id: "s-1", number: 1, title: "Scena", objective: "Uno scopo narrativo.", text: "Prosa in revisione.", status: "draft" },
    ] }];
    await saveBook(b, false);
    await saveBookAndActivity(b, activity(b.id, "chapterReview", "succeeded"));
    expect((await getOutbox(b.id))?.revision).toBe(1);
    await saveBook(b); // an author edit asks for a save too
    expect((await getOutbox(b.id))?.revision).toBe(2);
  });

  it("l'unico blocco è una scena fusa che attende la conferma dell'autore", async () => {
    const b = book();
    b.editorialReviewSceneIds = ["s-1"];
    await saveBook(b, false);
    await saveBookAndActivity(b, activity(b.id, "prose", "succeeded"));
    await saveBook(b);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect(await enqueueIfUnsaved(b.id)).toBe("blocked");
  });

  it("enqueueIfUnsaved: dice perché non accoda e accoda solo ciò che GitHub non ha", async () => {
    const plain = newBook("Idea", "Senza repository", "", "");
    await saveBook(plain, false);
    expect(await enqueueIfUnsaved(plain.id)).toBe("not_linked");
    const manual = book(); manual.remote!.autoSync = false;
    await saveBook(manual, false);
    expect(await enqueueIfUnsaved(manual.id)).toBe("autosync_off");
    const first = book(); first.remote!.lastSyncedCommit = undefined;
    await saveBook(first, false);
    expect(await enqueueIfUnsaved(first.id)).toBe("first_push_needed");

    const b = book();
    await saveBook(b, false);
    const stored = (await getBook(b.id))!;
    stored.remote!.lastSyncedLocalUpdatedAt = stored.updatedAt; // GitHub already has this exact revision
    await saveBook(stored, false);
    const synced = (await getBook(b.id))!;
    synced.remote!.lastSyncedLocalUpdatedAt = synced.updatedAt;
    await (await getDb()).put("books", synced, synced.id);
    expect(await enqueueIfUnsaved(b.id)).toBe("already_saved");
    expect(await getOutbox(b.id)).toBeUndefined();
    await saveBook((await getBook(b.id))!, false); // a local change GitHub has not seen
    expect(await enqueueIfUnsaved(b.id)).toBe("queued");
    expect((await getOutbox(b.id))?.state).toBe("pending");
  });

  it("deferAttempt restituisce il tentativo senza contarlo come errore; il «salva ora» ignora l'attesa", async () => {
    const b = book();
    await saveBook(b);
    const item = (await getOutbox(b.id))!;
    expect(await markAttempt(item)).toBe(true);
    expect((await getOutbox(b.id))?.attempts).toBe(1);
    await deferAttempt(b.id, item.operationId, 60_000);
    const deferred = (await getOutbox(b.id))!;
    expect(deferred).toMatchObject({ state: "pending", attempts: 0 });
    expect(Date.parse(deferred.retryAfter!)).toBeGreaterThan(Date.now() + 30_000);
    expect(await markAttempt(deferred)).toBe(false); // waits
    expect(await markAttempt(deferred, true)).toBe(true); // the author asked: now
    await recordSyncFailure(b.id, item.operationId, "HTTP 403", true);
    expect(await markAttempt((await getOutbox(b.id))!, true)).toBe(false); // blocked stays blocked
  });

  it("non perde modifiche scritte durante un commit GitHub in corso", async () => {
    const b = book();
    await saveBook(b);
    const before = await getOutbox(b.id);
    expect(before).toBeDefined();
    await saveBook(b); // Another checkpoint before ACK.
    await acknowledgeOutbox(b.id, before!.operationId, "outdated-book-updatedAt");
    const next = await getOutbox(b.id);
    expect(next?.state).toBe("pending");
    expect(next?.revision).toBe(2);
    expect(next?.operationId).not.toBe(before?.operationId);
    const current = await getBook(b.id);
    await acknowledgeOutbox(b.id, next!.operationId, current!.updatedAt);
    expect(await getOutbox(b.id)).toBeUndefined();
  });

  it("non sblocca errori di conflitto soltanto perché il libro cambia", async () => {
    const b = book();
    await saveBook(b);
    const queued = await getOutbox(b.id);
    await recordSyncFailure(b.id, queued!.operationId, "Branch remoto divergente", true);
    expect((await getOutbox(b.id))?.state).toBe("blocked");
    await saveBook(b);
    expect((await getOutbox(b.id))?.state).toBe("blocked");
    await retryBlockedSync(b.id);
    expect((await getOutbox(b.id))?.state).toBe("pending");
  });

  it("non crea richieste quando la policy autosync è disattiva", async () => {
    const b = book();
    b.remote!.autoSync = false;
    await saveBook(b);
    expect(await getOutbox(b.id)).toBeUndefined();
  });
});
