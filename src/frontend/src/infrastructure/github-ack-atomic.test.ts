import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { newBook, type BookProject, type SyncOutboxItem } from "../domain/types";
import { getBook, getDb, saveBook } from "./db";
import { persistRemoteAcknowledgment, RemoteConflict, validateRemote } from "./github-sync";
import { getOutbox } from "./outbox";

const PREVIOUS = "a".repeat(40);
const CONFIRMED = "b".repeat(40);
const NEWER = "c".repeat(40);
function fixture(autoSync = true): BookProject {
  const book = newBook("Il segreto della chiave", "Mistero", "Sobrio", "Adulti");
  book.remote = {
    owner: "test-owner", repository: "novel", branch: "main",
    lastSyncedCommit: PREVIOUS, autoSync,
  };
  book.authorConstraints = ["Il segreto emerge solo alla fine."];
  return book;
}
async function ack(book: BookProject, sourceRevision: string, operationId: string,
  sha = CONFIRMED, previous = PREVIOUS,
) {
  await persistRemoteAcknowledgment(
    book.id, validateRemote(book.remote!), sha, sourceRevision, operationId, previous,
  );
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("outbox");
});

describe("ACK remoto atomico: metadata e outbox", () => {
  it("registra il commit e elimina la coda in un'unica transazione senza falsare updatedAt", async () => {
    const book = fixture();
    await saveBook(book);
    const pending = (await getOutbox(book.id))!;
    const revision = book.updatedAt;
    const beforeConstraints = structuredClone(book.authorConstraints);

    await ack(book, revision, pending.operationId);

    const result = (await getBook(book.id))!;
    expect(result.remote).toMatchObject({
      lastSyncedCommit: CONFIRMED, lastSyncedLocalUpdatedAt: revision,
    });
    expect(result.updatedAt).toBe(revision);
    expect(result.authorConstraints).toEqual(beforeConstraints);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("un checkpoint successivo alla PATCH non viene perso e conserva una nuova operazione", async () => {
    const book = fixture();
    await saveBook(book);
    const snapshot = book.updatedAt;
    const original = (await getOutbox(book.id))!;
    const later = (await getBook(book.id))!;
    later.brief = "La versione successiva contiene un capitolo imprevisto.";
    later.authorConstraints.push("Un altro indizio si trova sotto la porta.");
    await saveBook(later);
    const pending = (await getOutbox(book.id))!;
    expect(pending.operationId).toBe(original.operationId);
    expect(pending.revision).toBeGreaterThan(original.revision);

    await ack(book, snapshot, original.operationId);

    const current = (await getBook(book.id))!;
    expect(current.updatedAt).toBe(later.updatedAt);
    expect(current.brief).toBe(later.brief);
    expect(current.authorConstraints).toEqual(later.authorConstraints);
    expect(current.remote?.lastSyncedCommit).toBe(CONFIRMED);
    expect(current.remote?.lastSyncedLocalUpdatedAt).toBe(snapshot);
    const remaining = (await getOutbox(book.id))!;
    expect(remaining).toMatchObject({
      state: "pending", attempts: 0, revision: pending.revision,
    });
    expect(remaining.operationId).not.toBe(original.operationId);
    expect(current.remote?.lastSyncedLocalUpdatedAt).not.toBe(current.updatedAt);
  });

  it("un push manuale confermato svuota anche un outbox con operationId diverso solo se la versione coincide", async () => {
    const book = fixture();
    await saveBook(book);
    await ack(book, book.updatedAt, crypto.randomUUID());
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("non modifica libro/outbox se la repository di destinazione è cambiata", async () => {
    const book = fixture();
    await saveBook(book);
    const operationId = (await getOutbox(book.id))!.operationId;
    const current = (await getBook(book.id))!;
    current.remote!.repository = "another-repo";
    current.brief = "Storia preservata.";
    await saveBook(current);
    const expectedBook = await getBook(book.id);
    const expectedQueue = await getOutbox(book.id);

    await expect(ack(book, book.updatedAt, operationId))
      .rejects.toBeInstanceOf(RemoteConflict);

    expect(await getBook(book.id)).toEqual(expectedBook);
    expect(await getOutbox(book.id)).toEqual(expectedQueue);
  });

  it("non riporta la baseline indietro se un ACK più recente è già stato confermato", async () => {
    const book = fixture();
    await saveBook(book);
    const op = (await getOutbox(book.id))!.operationId;
    const current = (await getBook(book.id))!;
    current.remote!.lastSyncedCommit = NEWER;
    await saveBook(current, false);
    const beforeBook = await getBook(book.id);
    const beforeQueue = await getOutbox(book.id);

    await expect(ack(book, book.updatedAt, op))
      .rejects.toBeInstanceOf(RemoteConflict);
    expect(await getBook(book.id)).toEqual(beforeBook);
    expect(await getOutbox(book.id)).toEqual(beforeQueue);
  });

  it("un outbox bloccato con versione nuova non viene sbloccato automaticamente", async () => {
    const book = fixture();
    await saveBook(book);
    const op = (await getOutbox(book.id))!.operationId;
    const changed = (await getBook(book.id))!;
    changed.brief = "Nuova versione";
    await saveBook(changed);
    const blocked = { ...(await getOutbox(book.id))!, state: "blocked",
      lastError: "Conflitto remoto" } satisfies SyncOutboxItem;
    await (await getDb()).put("outbox", blocked, book.id);
    await ack(book, book.updatedAt, op);
    expect(await getOutbox(book.id)).toEqual(blocked);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBe(CONFIRMED);
  });

  it("l'ACK ripetuto dello stesso SHA è idempotente anche dopo la cancellazione della coda", async () => {
    const book = fixture();
    await saveBook(book);
    const op = (await getOutbox(book.id))!.operationId;
    await ack(book, book.updatedAt, op);
    await ack(book, book.updatedAt, op);
    const current = (await getBook(book.id))!;
    expect(current.remote?.lastSyncedCommit).toBe(CONFIRMED);
    expect(current.updatedAt).toBe(book.updatedAt);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("non attesta un libro sparito dopo la conferma GitHub", async () => {
    const book = fixture();
    await saveBook(book);
    const pending = (await getOutbox(book.id))!;
    await (await getDb()).delete("books", book.id);
    await expect(ack(book, book.updatedAt, pending.operationId))
      .rejects.toBeInstanceOf(RemoteConflict);
    expect(await getOutbox(book.id)).toEqual(pending);
  });
});
