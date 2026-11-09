import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { newBook, type Activity, type BookProject } from "../domain/types";
import { BookRevisionConflict, getBook, getDb, saveBook, saveBookAndActivity } from "./db";
import { getOutbox } from "./outbox";

function fixture(): BookProject {
  const book = newBook("Idea", "Romanzo fuso", "", "");
  book.status = "paused";
  book.chapters = [{
    id: "ch1", number: 1, title: "Capitolo", purpose: "Introduzione",
    scenes: [{ id: "s1", number: 1, title: "Scena fusa", objective: "Prova",
      status: "draft", text: "Testo fuso in attesa dell'autore." }],
  }];
  book.editorialReviewSceneIds = ["s1"];
  book.remote = {
    owner: "test", repository: "book", branch: "main",
    lastSyncedCommit: "a".repeat(40), autoSync: true,
  };
  return book;
}
function audit(bookId: string, id: string): Activity {
  return {
    id, bookId, runId: crypto.randomUUID(), phase: "review",
    title: "Conferma editoriale della scena", reason: "Rilettura manuale",
    nextStep: "Continuare", status: "succeeded",
    createdAt: new Date().toISOString(),
  };
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("activities");
  await db.clear("outbox");
});

describe("Commit atomico della conferma editoriale e del suo audit", () => {
  it("accetta la revisione attuale e salva insieme il canon e un unico audit", async () => {
    const book = fixture();
    book.remote!.autoSync = false;
    await saveBook(book, false);
    const token = book.updatedAt;
    const update = (await getBook(book.id))!;
    update.chapters[0]!.scenes[0]!.status = "canon";
    update.editorialReviewSceneIds = [];
    const activity = audit(book.id, "approved");
    await saveBookAndActivity(update, activity, token);
    const stored = await getBook(book.id);
    expect(stored?.chapters[0]?.scenes[0]?.status).toBe("canon");
    expect(stored?.editorialReviewSceneIds).toEqual([]);
    expect(stored?.updatedAt).not.toBe(token);
    expect(await (await getDb()).get("activities", activity.id)).toEqual(activity);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("rifiuta la conferma stale senza scrivere libro, audit o outbox", async () => {
    const book = fixture();
    await saveBook(book, false);
    const oldToken = book.updatedAt;
    const stale = (await getBook(book.id))!;
    stale.chapters[0]!.scenes[0]!.status = "canon";
    stale.editorialReviewSceneIds = [];
    const activity = audit(book.id, "must-not-exist");
    // A different writer advanced the manuscript after the manual read.
    const current = (await getBook(book.id))!;
    current.chapters[0]!.scenes[0]!.text = "Versione cambiata da un'altra scheda.";
    await saveBook(current, true);
    // Also seed an existing blocked outbox request: failed CAS must neither
    // clear nor requeue it, even though books+outbox share the transaction.
    const queued = {
      bookId: book.id, operationId: "existing-conflict", revision: 3,
      requestedAt: new Date().toISOString(), state: "blocked", attempts: 1,
    };
    await (await getDb()).put("outbox", queued, book.id);
    const before = await getBook(book.id);
    const beforeOutbox = await getOutbox(book.id);
    const beforeActivities = await (await getDb()).getAll("activities");

    await expect(saveBookAndActivity(stale, activity, oldToken))
      .rejects.toBeInstanceOf(BookRevisionConflict);

    expect(stale.updatedAt).toBe(oldToken);
    expect(await getBook(book.id)).toEqual(before);
    expect((await getBook(book.id))?.chapters[0]?.scenes[0]?.status).toBe("draft");
    expect(await (await getDb()).getAll("activities")).toEqual(beforeActivities);
    expect(await getOutbox(book.id)).toEqual(beforeOutbox);
  });

  it("due conferme sullo stesso token non possono creare due audit", async () => {
    const book = fixture();
    book.remote!.autoSync = false;
    await saveBook(book, false);
    const expected = book.updatedAt;
    const one = structuredClone(book);
    const two = structuredClone(book);
    one.chapters[0]!.scenes[0]!.status = "canon";
    two.chapters[0]!.scenes[0]!.status = "canon";
    one.editorialReviewSceneIds = [];
    two.editorialReviewSceneIds = [];
    const first = audit(book.id, "first-approval");
    const second = audit(book.id, "second-approval");
    const results = await Promise.allSettled([
      saveBookAndActivity(one, first, expected),
      saveBookAndActivity(two, second, expected),
    ]);

    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const activities = await (await getDb()).getAll("activities") as Activity[];
    expect(activities).toHaveLength(1);
    expect(["first-approval", "second-approval"]).toContain(activities[0]?.id);
    expect((await getBook(book.id))?.chapters[0]?.scenes[0]?.status).toBe("canon");
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("conserva la compatibilità con i checkpoint AI senza precondizione obbligatoria", async () => {
    const book = fixture();
    book.remote!.autoSync = false;
    await saveBook(book, false);
    const activity = audit(book.id, "legacy-success");
    await saveBookAndActivity(book, activity);
    expect((await getBook(book.id))?.status).toBe("paused");
    expect(await (await getDb()).get("activities", activity.id)).toEqual(activity);
  });
});
