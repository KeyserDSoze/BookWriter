import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, type Activity, type BookProject } from "../domain/types";
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
