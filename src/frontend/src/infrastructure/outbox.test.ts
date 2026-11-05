import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { newBook, type Activity } from "../domain/types";
import { getBook, saveBook, saveBookAndActivity } from "./db";
import {
  acknowledgeOutbox, getOutbox, recordSyncFailure, retryBlockedSync,
} from "./outbox";

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
  it("accoda solo milestone canoniche completate, non errori o attività intermedie", async () => {
    const b = book();
    await saveBook(b, false);
    await saveBookAndActivity(b, activity(b.id, "brainstorm", "succeeded"));
    expect(await getOutbox(b.id)).toBeUndefined();
    await saveBookAndActivity(b, activity(b.id, "review", "succeeded"));
    const queued = await getOutbox(b.id);
    expect(queued?.state).toBe("pending");
    expect(queued?.revision).toBe(1);
    await saveBookAndActivity(b, activity(b.id, "consolidate", "succeeded"));
    expect((await getOutbox(b.id))?.operationId).toBe(queued?.operationId);
    expect((await getOutbox(b.id))?.revision).toBe(2);
    await saveBookAndActivity(b, activity(b.id, "review", "failed"));
    expect((await getOutbox(b.id))?.revision).toBe(2);
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
