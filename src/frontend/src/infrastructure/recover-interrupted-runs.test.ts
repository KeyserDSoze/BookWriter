import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, type Activity, type BookProject } from "@engine/domain/types";
import { makeRetrySchedule, retryStamp } from "@engine/core/retry-policy";
import { narrativeStateJson } from "@engine/core/narrative-state";
import { getRetrySchedule, retryScheduleKey } from "@engine/infrastructure/retry-schedule";
import {
  getBook, getDb, recoverInterruptedRuns, saveActivity, saveBook,
} from "./db";

const lockedBooks = new Set<string>();
const request = vi.fn(async (
  name: string, options: { ifAvailable?: boolean },
  fn: (lock: { name: string } | null) => Promise<void>,
) => {
  expect(options.ifAvailable).toBe(true);
  return fn(lockedBooks.has(name) ? null : { name });
});

function runningBook(title: string): BookProject {
  const book = newBook("Una storia", title, "", "");
  book.status = "running";
  return book;
}
function activity(bookId: string, status: Activity["status"] = "running"): Activity {
  return {
    id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(),
    phase: "prose", status, title: "Scena in corso",
    reason: "Test recupero", nextStep: "Continuare", createdAt: new Date().toISOString(),
  };
}
async function storedActivity(id: string): Promise<Activity> {
  const db = await getDb();
  return await db.get("activities", id) as Activity;
}

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("activities");
  await db.clear("meta");
  lockedBooks.clear();
  request.mockClear();
  vi.stubGlobal("navigator", { locks: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Ripresa di esecuzioni interrotte, protetta da Web Locks", () => {
  it("non mette in pausa il writer che sta lavorando in un'altra tab", async () => {
    const active = runningBook("Writer attivo");
    const interrupted = runningBook("Writer interrotto");
    const activeTask = activity(active.id);
    const oldTask = activity(interrupted.id);
    const finishedTask = activity(interrupted.id, "succeeded");
    await saveBook(active, false);
    await saveBook(interrupted, false);
    await saveActivity(activeTask);
    await saveActivity(oldTask);
    await saveActivity(finishedTask);

    lockedBooks.add("bookwriter:writer:" + active.id);
    await recoverInterruptedRuns();

    expect((await getBook(active.id))?.status).toBe("running");
    expect((await storedActivity(activeTask.id)).status).toBe("running");
    expect((await getBook(interrupted.id))?.status).toBe("paused");
    expect((await getBook(interrupted.id))?.previousError).toMatch(/interrotta/);
    expect(await storedActivity(oldTask.id)).toMatchObject({
      status: "cancelled",
      error: expect.stringMatching(/attività non confermata/),
      endedAt: expect.any(String),
    });
    expect((await storedActivity(finishedTask.id)).status).toBe("succeeded");
    expect(request).toHaveBeenCalledWith(
      "bookwriter:writer:" + active.id, { ifAvailable: true }, expect.any(Function),
    );
    expect(request).toHaveBeenCalledWith(
      "bookwriter:writer:" + interrupted.id, { ifAvailable: true }, expect.any(Function),
    );

    const endedAt = (await storedActivity(oldTask.id)).endedAt;
    lockedBooks.clear();
    await recoverInterruptedRuns();
    expect((await getBook(active.id))?.status).toBe("paused");
    expect((await storedActivity(activeTask.id)).status).toBe("cancelled");
    expect((await storedActivity(oldTask.id)).endedAt).toBe(endedAt);
    const after = await getBook(active.id);
    await recoverInterruptedRuns();
    expect(await getBook(active.id)).toEqual(after); // Recovery is idempotent.
  });

  it("restituisce solo i libri che erano davvero in esecuzione, con l'ultimo segno di vita", async () => {
    const running = runningBook("In esecuzione");
    const paused = newBook("Una storia", "Già in pausa", "", "");
    paused.status = "paused";
    const locked = runningBook("Altra scheda al lavoro");
    const lostCall = activity(running.id);
    // Later than the moment the book is saved, whatever time the test runs at.
    const lastSign = new Date(Date.now() + 60_000).toISOString();
    lostCall.createdAt = lastSign;
    const pausedCall = activity(paused.id); // a stale «running» activity of a book that was paused
    await saveBook(running, false); await saveBook(paused, false); await saveBook(locked, false);
    await saveActivity(lostCall); await saveActivity(pausedCall);
    lockedBooks.add("bookwriter:writer:" + locked.id);
    const recovered = await recoverInterruptedRuns();
    expect(recovered).toEqual([{ bookId: running.id, title: "In esecuzione", lastActivityAt: lastSign }]);
    expect((await getBook(locked.id))?.status).toBe("running");
    expect((await getBook(paused.id))?.status).toBe("paused");
    expect((await storedActivity(pausedCall.id)).status).toBe("cancelled");
    expect(await recoverInterruptedRuns()).toEqual([]); // idempotent: nothing left to resume
  });

  it("non cancella attività in esecuzione in assenza di Web Locks", async () => {
    const book = runningBook("Browser non supportato");
    const task = activity(book.id);
    await saveBook(book, false);
    await saveActivity(task);
    vi.stubGlobal("navigator", {});
    await recoverInterruptedRuns();
    expect(await getBook(book.id)).toEqual(book);
    expect(await storedActivity(task.id)).toEqual(task);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([false, true])("un claim interrotto (richiesta iniziata: %s) non entra nella ripresa automatica", async attempted => {
    const book = runningBook("Ripartenza interrotta"), task = activity(book.id);
    if (!attempted) book.status = "paused";
    await saveBook(book, false);
    const policy = { enabled: true, intervalMinutes: 1, maxCycles: 3 };
    const plan = makeRetrySchedule({ bookId: book.id, runId: task.runId, endpointId: "openai", modelId: "m",
      taskKey: retryStamp("task"), bookStamp: retryStamp(narrativeStateJson(book)), cyclesUsed: 0,
      policy, authorizedPolicies: { openai: policy }, now: Date.now() })!;
    await (await getDb()).put("meta", { ...plan, state: "claimed" }, retryScheduleKey(book.id));
    if (attempted) await saveActivity({ ...task, aiRequested: true });
    lockedBooks.add("bookwriter:writer:" + book.id);
    expect(await recoverInterruptedRuns()).toEqual([]);
    expect((await getRetrySchedule(book.id))?.state).toBe("claimed");
    lockedBooks.clear();
    expect(await recoverInterruptedRuns()).toEqual([]);
    expect(await getRetrySchedule(book.id)).toBeUndefined();
    expect(await getBook(book.id)).toMatchObject({ status: "paused", previousError: expect.stringContaining("Nessuna nuova richiesta automatica") });
    if (attempted) expect(await storedActivity(task.id)).toMatchObject({ status: "cancelled", aiRequested: true, runId: plan.runId });
  });

  it("ricontrolla i dati dopo aver ottenuto il lock anziché applicare uno snapshot obsoleto", async () => {
    const book = runningBook("Già recuperato");
    const task = activity(book.id);
    await saveBook(book, false);
    await saveActivity(task);
    request.mockImplementationOnce(async (
      name: string, _options: { ifAvailable?: boolean },
      fn: (lock: { name: string } | null) => Promise<void>,
    ) => {
      const db = await getDb();
      const updated = await getBook(book.id);
      if (!updated) throw new Error("missing book");
      updated.status = "completed";
      await db.put("books", updated, book.id);
      const done = { ...task, status: "succeeded" as const };
      await db.put("activities", done, task.id);
      return fn({ name });
    });
    await recoverInterruptedRuns();
    expect((await getBook(book.id))?.status).toBe("completed");
    expect((await storedActivity(task.id)).status).toBe("succeeded");
  });
});
