import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { newBook } from "../domain/types";
import { getBook, getDb, saveBook } from "./db";
import { getOutbox } from "./outbox";
import { persistRemoteAcknowledgment, RemoteConflict } from "./github-sync";
import { getManualPushIntent, prepareManualPushIntent } from "./manual-push-intent";

const BASE = "a".repeat(40);
const SHA = "b".repeat(40);
function fixture(autoSync = false) {
  const book = newBook("Storia", "Romanzo sincronizzato a mano", "Sobrio", "Adulti");
  book.remote = { owner: "writer", repository: "novel", branch: "main",
    lastSyncedCommit: BASE, autoSync };
  book.status = "paused";
  return book;
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("outbox");
  await db.clear("meta");
});

describe("Intento manuale GitHub durabile in meta (fuori dall'outbox)", () => {
  it("salva l'operationId prima del push e lo riusa dopo un nuovo caricamento", async () => {
    const book = fixture();
    await saveBook(book, false);
    const one = await prepareManualPushIntent(book.id);
    const two = await prepareManualPushIntent(book.id);
    expect(two).toEqual(one);
    expect(one).toMatchObject({
      bookId: book.id, owner: "writer", repository: "novel", branch: "main",
      baseSha: BASE, sourceRevision: book.updatedAt,
    });
    expect(one.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await getManualPushIntent(book.id)).toEqual(one);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("una nuova revisione conserva l'ID del tentativo pendente senza riscrivere il canon", async () => {
    const book = fixture();
    await saveBook(book, false);
    const intent = await prepareManualPushIntent(book.id);
    const next = (await getBook(book.id))!;
    next.brief = "Nuova scena in attesa mentre GitHub risponde.";
    await saveBook(next, false);
    const recovered = await prepareManualPushIntent(book.id);
    expect(recovered).toEqual(intent);
    expect((await getBook(book.id))?.brief).toBe(next.brief);
    expect((await getBook(book.id))?.updatedAt).toBe(next.updatedAt);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("non riusa né sovrascrive un intento se repository o baseline sono cambiate", async () => {
    for (const dimension of ["repository", "lastSyncedCommit"] as const) {
      const book = fixture();
      await saveBook(book, false);
      const first = await prepareManualPushIntent(book.id);
      const changed = (await getBook(book.id))!;
      if (dimension === "repository") changed.remote!.repository = "altro-libro";
      else changed.remote!.lastSyncedCommit = SHA;
      await saveBook(changed, false);
      await expect(prepareManualPushIntent(book.id))
        .rejects.toThrow(/diversa repository o baseline GitHub/);
      expect(await getManualPushIntent(book.id)).toEqual(first);
      expect(await getBook(book.id)).toEqual(changed);
      await (await getDb()).delete("meta", "manual-github-push:" + book.id);
    }
  });

  it("due schede che preparano insieme non possono creare ID diversi", async () => {
    const book = fixture();
    await saveBook(book, false);
    const [a, b] = await Promise.all([
      prepareManualPushIntent(book.id), prepareManualPushIntent(book.id),
    ]);
    expect(a).toEqual(b);
    expect(await getManualPushIntent(book.id)).toEqual(a);
  });

  it("non crea intenti senza remote, con writer running o autosync attivo", async () => {
    const book = fixture();
    delete book.remote;
    await saveBook(book, false);
    await expect(prepareManualPushIntent(book.id))
      .rejects.toThrow(/Collega prima/);
    const withRemote = (await getBook(book.id))!;
    withRemote.remote = fixture().remote;
    withRemote.status = "running";
    await saveBook(withRemote, false);
    await expect(prepareManualPushIntent(book.id))
      .rejects.toThrow(/Metti in pausa/);
    const withAuto = (await getBook(book.id))!;
    withAuto.status = "paused";
    withAuto.remote!.autoSync = true;
    await saveBook(withAuto, false);
    await expect(prepareManualPushIntent(book.id))
      .rejects.toThrow(/disattiva autosync/);
    expect(await getManualPushIntent(book.id)).toBeUndefined();
  });

  it("ACK valido cancella l'intento nella stessa transazione libro/outbox/meta", async () => {
    const book = fixture();
    await saveBook(book, false);
    const intent = await prepareManualPushIntent(book.id);
    await persistRemoteAcknowledgment(
      book.id, book.remote!, SHA, book.updatedAt, intent.operationId, BASE,
    );
    expect(await getManualPushIntent(book.id)).toBeUndefined();
    expect(await getOutbox(book.id)).toBeUndefined();
    const saved = (await getBook(book.id))!;
    expect(saved.remote?.lastSyncedCommit).toBe(SHA);
    expect(saved.updatedAt).toBe(book.updatedAt);
  });

  it("ACK di un ID non correlato NON elimina l'intento manuale pendente", async () => {
    const book = fixture();
    await saveBook(book, false);
    const intent = await prepareManualPushIntent(book.id);
    await persistRemoteAcknowledgment(
      book.id, book.remote!, SHA, book.updatedAt, crypto.randomUUID(), BASE,
    );
    expect(await getManualPushIntent(book.id)).toEqual(intent);
  });

  it("ACK fallito conserva l'intento manuale, il libro e l'outbox", async () => {
    const book = fixture(true);
    book.remote!.autoSync = false;
    await saveBook(book, false);
    const intent = await prepareManualPushIntent(book.id);
    // Store a pre-existing queue, independent from our manual attempt.
    const queued = {
      bookId: book.id, operationId: crypto.randomUUID(), revision: 3,
      requestedAt: new Date().toISOString(), state: "blocked", attempts: 2,
    };
    await (await getDb()).put("outbox", queued, book.id);
    const before = await getBook(book.id);
    await expect(persistRemoteAcknowledgment(
      book.id, book.remote!, SHA, book.updatedAt, intent.operationId, "f".repeat(40),
    )).rejects.toBeInstanceOf(RemoteConflict);
    expect(await getManualPushIntent(book.id)).toEqual(intent);
    expect(await getBook(book.id)).toEqual(before);
    expect(await getOutbox(book.id)).toEqual(queued);
  });

  it("ACK manuale su versione già avanzata conserva nuovi checkpoint/autosync", async () => {
    const book = fixture();
    await saveBook(book, false);
    const intent = await prepareManualPushIntent(book.id);
    const newer = (await getBook(book.id))!;
    newer.brief = "L'autore ha continuato a scrivere.";
    newer.remote!.autoSync = true;
    await saveBook(newer);
    const queued = await getOutbox(book.id);
    expect(queued).toBeDefined();
    await persistRemoteAcknowledgment(
      book.id, book.remote!, SHA, book.updatedAt, intent.operationId, BASE,
    );
    expect((await getBook(book.id))?.brief).toBe(newer.brief);
    expect((await getBook(book.id))?.remote?.lastSyncedLocalUpdatedAt).toBe(book.updatedAt);
    expect(await getManualPushIntent(book.id)).toBeUndefined();
    expect(await getOutbox(book.id)).toEqual(queued);
  });
});
