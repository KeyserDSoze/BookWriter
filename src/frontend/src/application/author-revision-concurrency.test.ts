import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, type BookProject } from "../domain/types";
import { BookRevisionConflict, getBook, getDb, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { requestRevision } from "./autopilot";

const blocked = new Set<string>();
const request = vi.fn(async (
  name: string, opts: { ifAvailable?: boolean },
  callback: (lock: { name: string } | null) => Promise<unknown>,
) => {
  expect(opts).toEqual({ ifAvailable: true });
  return callback(blocked.has(name) ? null : { name });
});
function book() {
  const b = newBook("Una storia lunga", "Libro condiviso", "Prosa sobria", "Adulti");
  b.authorConstraints.push("Non rivelare il colpevole nel primo capitolo.");
  return b;
}
async function stored(id: string) {
  return (await getBook(id))!;
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("outbox");
  await db.clear("activities");
  blocked.clear();
  request.mockClear();
  vi.stubGlobal("navigator", { locks: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Richiesta revisione dell'autore con Web Lock e CAS IndexedDB", () => {
  it("salva un solo vincolo normalizzato con la revisione valida, senza inventare canon o attività", async () => {
    const source = book();
    await saveBook(source, false);
    const stamp = source.updatedAt;
    await requestRevision(source.id, "  Mantieni il dialogo più credibile.  ", stamp);
    const result = await stored(source.id);
    expect(result.updatedAt).not.toBe(stamp);
    expect(result.authorConstraints).toEqual([
      "Non rivelare il colpevole nel primo capitolo.",
      "Mantieni il dialogo più credibile.",
    ]);
    expect(result.revision).toMatchObject({
      instruction: "Mantieni il dialogo più credibile.",
      beforePhase: "brainstorm", affectedSceneIds: [], cursor: 0,
    });
    expect(result.status).toBe("paused");
    expect(result.phase).toBe("revision");
    expect(result.brief).toBe(source.brief);
    expect(await (await getDb()).getAll("activities")).toEqual([]);
    expect(await getOutbox(source.id)).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "bookwriter:writer:" + source.id, { ifAvailable: true }, expect.any(Function),
    );
  });

  it("rifiuta il submit da tab obsoleta senza toccare libro e outbox", async () => {
    const source = book();
    source.remote = {
      owner: "writer", repository: "novel", branch: "main",
      lastSyncedCommit: "a".repeat(40), autoSync: true,
    };
    await saveBook(source, false);
    const obsolete = source.updatedAt;
    const changed = await stored(source.id);
    changed.brief = "Il secondo dispositivo ha aggiornato la trama.";
    await saveBook(changed);
    const beforeBook = await stored(source.id);
    const beforeOutbox = await getOutbox(source.id);

    await expect(requestRevision(source.id, "Scarta l'ultima trama.", obsolete))
      .rejects.toBeInstanceOf(BookRevisionConflict);
    expect(await stored(source.id)).toEqual(beforeBook);
    expect(await getOutbox(source.id)).toEqual(beforeOutbox);
  });

  it("fallisce chiuso quando il Web Lock è occupato anche se lo stato dice paused", async () => {
    const source = book();
    source.status = "paused";
    await saveBook(source, false);
    blocked.add("bookwriter:writer:" + source.id);
    const before = await stored(source.id);

    await expect(requestRevision(source.id, "Cambia il finale.", source.updatedAt))
      .rejects.toThrow(/Un'altra scheda sta scrivendo/);
    expect(await stored(source.id)).toEqual(before);
    expect(await getOutbox(source.id)).toBeUndefined();
  });

  it("fallisce chiuso senza Web Locks o senza un token di revisione", async () => {
    const source = book();
    await saveBook(source, false);
    vi.stubGlobal("navigator", {});
    await expect(requestRevision(source.id, "Cambia il ritmo.", source.updatedAt))
      .rejects.toThrow(/Web Locks non disponibile/);
    expect(request).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { locks: { request } });
    await expect(requestRevision(source.id, "Cambia il ritmo.", ""))
      .rejects.toBeInstanceOf(BookRevisionConflict);
    expect(request).not.toHaveBeenCalled();
    expect(await stored(source.id)).toEqual(source);
  });

  it("rifiuta libro running, ciclo editoriale o scene fuse senza conferma", async () => {
    const source = book();
    source.status = "running";
    await saveBook(source, false);
    await expect(requestRevision(source.id, "Cambia le scene.", source.updatedAt))
      .rejects.toThrow(/Metti prima in pausa/);

    const blockedCycle = await stored(source.id);
    blockedCycle.status = "paused";
    blockedCycle.editorialCycle = {} as BookProject["editorialCycle"];
    await saveBook(blockedCycle, false);
    await expect(requestRevision(source.id, "Cambia le scene.", blockedCycle.updatedAt))
      .rejects.toThrow(/redazione del capitolo/);
    const blockedMerge = await stored(source.id);
    delete blockedMerge.editorialCycle;
    blockedMerge.editorialReviewSceneIds = ["scene-in-review"];
    await saveBook(blockedMerge, false);
    await expect(requestRevision(source.id, "Cambia le scene.", blockedMerge.updatedAt))
      .rejects.toThrow(/Conferma le scene fuse/);
    expect((await stored(source.id)).authorConstraints).toHaveLength(1);
    expect((await stored(source.id)).revision).toBeUndefined();
  });

  it("solo una richiesta contemporanea con lo stesso token può vincere", async () => {
    const source = book();
    await saveBook(source, false);
    // The mock deliberately allows both callbacks: CAS within IndexedDB
    // must still prevent lost writes from a non-cooperating editor.
    const results = await Promise.allSettled([
      requestRevision(source.id, "Prima richiesta.", source.updatedAt),
      requestRevision(source.id, "Seconda richiesta.", source.updatedAt),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await stored(source.id)).authorConstraints).toHaveLength(2);
  });

  it("non entra nel lock quando il testo è vuoto o è solo whitespace", async () => {
    const source = book();
    await saveBook(source, false);
    await expect(requestRevision(source.id, " \n ", source.updatedAt))
      .rejects.toThrow(/Scrivi la modifica/);
    expect(request).not.toHaveBeenCalled();
    expect(await stored(source.id)).toEqual(source);
  });
});
