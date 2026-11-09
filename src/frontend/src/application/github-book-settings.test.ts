import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { BookRevisionConflict, getBook, getDb, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { connectBookRemote, setBookAutoSync } from "./github-book-settings";

const denied = new Set<string>();
const request = vi.fn(async (
  name: string, opts: { ifAvailable: boolean },
  callback: (lock: { name: string } | null) => Promise<unknown>,
) => {
  expect(opts).toEqual({ ifAvailable: true });
  return callback(denied.has(name) ? null : { name });
});
function fixture() {
  const b = newBook("Una trama con un segreto", "Romanzo", "Preciso", "Adulti");
  b.authorConstraints = ["Il segreto resta nascosto."];
  b.chapters = [{
    id: "c1", number: 1, title: "Inizio", purpose: "Introduzione",
    scenes: [{ id: "s1", number: 1, title: "La porta", objective: "Incontro",
      status: "planned", text: "" }],
  }];
  return b;
}
function connected() {
  const b = fixture();
  b.remote = {
    owner: "owner", repository: "novel", branch: "main",
    lastSyncedCommit: "a".repeat(40), autoSync: false,
  };
  return b;
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("outbox");
  denied.clear();
  request.mockClear();
  vi.stubGlobal("navigator", { locks: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Impostazioni GitHub manuali: writer lock + outbox lock + CAS", () => {
  it("collega il libro senza modificare altri campi e acquisisce entrambi i Web Lock", async () => {
    const source = fixture();
    await saveBook(source, false);
    const token = source.updatedAt;
    await connectBookRemote(source.id, token, {
      owner: "owner", repository: "novel", branch: "main",
    });
    const result = (await getBook(source.id))!;
    expect(result.updatedAt).not.toBe(token);
    expect(result.remote).toEqual({ owner: "owner", repository: "novel", branch: "main" });
    expect(result.authorConstraints).toEqual(source.authorConstraints);
    expect(result.chapters).toEqual(source.chapters);
    expect(await getOutbox(source.id)).toBeUndefined();
    expect(request.mock.calls.map(call => call[0])).toEqual([
      "bookwriter:writer:" + source.id, "bookwriter:github-outbox",
    ]);
  });

  it("un collegamento stale non sovrascrive canone né outbox", async () => {
    const source = connected();
    source.remote!.autoSync = true;
    await saveBook(source, false);
    const old = source.updatedAt;
    const updated = (await getBook(source.id))!;
    updated.brief = "La versione approvata da un'altra scheda.";
    await saveBook(updated);
    const before = await getBook(source.id);
    const beforeOutbox = await getOutbox(source.id);

    await expect(connectBookRemote(source.id, old, {
      owner: "other", repository: "different", branch: "main",
    })).rejects.toBeInstanceOf(BookRevisionConflict);
    expect(await getBook(source.id)).toEqual(before);
    expect(await getOutbox(source.id)).toEqual(beforeOutbox);
  });

  it("non permette di cambiare destinazione a un libro già sincronizzato", async () => {
    const source = connected();
    await saveBook(source, false);
    await expect(connectBookRemote(source.id, source.updatedAt, {
      owner: "wrong", repository: "novel", branch: "main",
    })).rejects.toThrow(/già sincronizzato altrove/);
    expect((await getBook(source.id))?.remote?.owner).toBe("owner");
  });

  it("attiva la policy solo su un checkpoint congelato e conserva la coda alla disattivazione", async () => {
    const source = connected();
    await saveBook(source, false);
    await setBookAutoSync(source.id, source.updatedAt, true, false);
    const active = (await getBook(source.id))!;
    expect(active.remote?.autoSync).toBe(true);
    const queued = await getOutbox(source.id);
    expect(queued?.state).toBe("pending");
    expect(queued?.revision).toBe(1);

    await setBookAutoSync(source.id, active.updatedAt, false, false);
    expect((await getBook(source.id))?.remote?.autoSync).toBe(false);
    expect(await getOutbox(source.id)).toEqual(queued);
  });

  it("non abilita autosync dopo un nuovo ciclo di review o con una scena fusa", async () => {
    const source = connected();
    source.editorialReviewSceneIds = ["s1"];
    await saveBook(source, false);
    await expect(setBookAutoSync(source.id, source.updatedAt, true, false))
      .rejects.toThrow(/Conferma prima tutte le scene fuse/);
    const updated = (await getBook(source.id))!;
    updated.editorialReviewSceneIds = [];
    updated.chapters[0]!.scenes[0]!.status = "draft";
    await saveBook(updated, false);
    await expect(setBookAutoSync(source.id, updated.updatedAt, true, false))
      .rejects.toThrow(/Completa e congela/);
    expect(await getOutbox(source.id)).toBeUndefined();
    expect((await getBook(source.id))?.remote?.autoSync).toBe(false);
  });

  it("rifiuta libro running, API assente e lock writer o outbox occupati senza mutazioni", async () => {
    const source = connected();
    await saveBook(source, false);
    const writer = "bookwriter:writer:" + source.id;
    const before = await getBook(source.id);
    for (const name of [writer, "bookwriter:github-outbox"]) {
      denied.add(name);
      await expect(setBookAutoSync(source.id, source.updatedAt, true, false))
        .rejects.toThrow(name === writer ? /Un'altra scheda sta scrivendo/ : /sincronizzazione GitHub è ancora in corso/);
      denied.delete(name);
      expect(await getBook(source.id)).toEqual(before);
      expect(await getOutbox(source.id)).toBeUndefined();
    }

    vi.stubGlobal("navigator", {});
    await expect(connectBookRemote(source.id, source.updatedAt, {
      owner: "owner", repository: "novel", branch: "main",
    })).rejects.toThrow(/Web Locks non disponibile/);
    expect(await getBook(source.id)).toEqual(before);

    vi.stubGlobal("navigator", { locks: { request } });
    const running = (await getBook(source.id))!;
    running.status = "running";
    await saveBook(running, false);
    await expect(setBookAutoSync(source.id, running.updatedAt, true, false))
      .rejects.toThrow(/Metti prima in pausa/);
    expect((await getBook(source.id))?.remote?.autoSync).toBe(false);
  });

  it("la stessa versione non può abilitare e disabilitare autosync contemporaneamente", async () => {
    const source = connected();
    await saveBook(source, false);
    // The test lock deliberately lets both operations enter: the IndexedDB
    // CAS is still necessary to stop a non-cooperating concurrent writer.
    const results = await Promise.allSettled([
      setBookAutoSync(source.id, source.updatedAt, true, false),
      setBookAutoSync(source.id, source.updatedAt, false, false),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const result = await getBook(source.id);
    expect(result?.updatedAt).not.toBe(source.updatedAt);
  });

  it("rifiuta token di revisione mancante senza toccare alcun lock", async () => {
    const source = connected();
    await saveBook(source, false);
    await expect(setBookAutoSync(source.id, "", true, false))
      .rejects.toBeInstanceOf(BookRevisionConflict);
    expect(request).not.toHaveBeenCalled();
  });
});
