import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { getBook, getDb, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { getManualPushIntent, prepareManualPushIntent } from "../infrastructure/manual-push-intent";

vi.mock("../infrastructure/github-sync", () => ({ verifyPublishedManualPush: vi.fn() }));
import { verifyPublishedManualPush } from "../infrastructure/github-sync";
import { reconcileSuspendedManualPush } from "./manual-push-reconciliation";

const proof = vi.mocked(verifyPublishedManualPush);
const VERIFIED = "b".repeat(40);
const BASE = "a".repeat(40);
const held = new Set<string>();
const order: string[] = [];
const locks = {
  request: vi.fn(async (name: string, options: { ifAvailable: boolean },
    callback: (value: { name: string } | null) => Promise<unknown>,
  ) => {
    expect(options).toEqual({ ifAvailable: true });
    order.push(name);
    return callback(held.has(name) ? null : { name });
  }),
};
function book() {
  const b = newBook("Il capitolo", "Test della riconciliazione", "Sobrio", "Adulti");
  b.remote = { owner: "legacy", repository: "novel", branch: "main",
    lastSyncedCommit: BASE, autoSync: false };
  b.status = "paused";
  return b;
}
beforeEach(async () => {
  const db = await getDb();
  for (const name of ["books", "meta", "outbox"]) await db.clear(name);
  held.clear();
  order.length = 0;
  proof.mockReset().mockResolvedValue(VERIFIED);
  vi.stubGlobal("navigator", { locks });
});
afterEach(() => vi.unstubAllGlobals());

describe("Riconciliazione esplicita del push GitHub sospeso", () => {
  it.each(["repository", "baseline"] as const)(
    "archivia solo l'intento verificato quando cambia %s, senza mutare libro/outbox", async dimension => {
      const b = book();
      await saveBook(b, false);
      const intent = await prepareManualPushIntent(b.id);
      const changed = (await getBook(b.id))!;
      if (dimension === "repository") changed.remote!.repository = "new-novel";
      else changed.remote!.lastSyncedCommit = "c".repeat(40);
      changed.brief = "La nuova versione resta locale.";
      await saveBook(changed, false);
      const queued = { bookId: b.id, operationId: crypto.randomUUID(),
        revision: 4, requestedAt: new Date().toISOString(),
        state: "blocked" as const, attempts: 3 };
      await (await getDb()).put("outbox", queued, b.id);
      const before = await getBook(b.id);
      const result = await reconcileSuspendedManualPush(b.id);
      expect(result).toEqual({ commit: VERIFIED, repository: "legacy/novel" });
      expect(proof).toHaveBeenCalledWith(intent);
      expect(await getManualPushIntent(b.id)).toBeUndefined();
      expect(await getBook(b.id)).toEqual(before);
      expect(await getOutbox(b.id)).toEqual(queued);
      expect(order).toEqual(["bookwriter:writer:" + b.id, "bookwriter:github-outbox"]);
    },
  );

  it("non elimina un tentativo ancora sulla stessa baseline: usa Sincronizza", async () => {
    const b = book();
    await saveBook(b, false);
    const intent = await prepareManualPushIntent(b.id);
    await expect(reconcileSuspendedManualPush(b.id)).rejects.toThrow(/normale recupero/);
    expect(proof).not.toHaveBeenCalled();
    expect(await getManualPushIntent(b.id)).toEqual(intent);
  });

  it("senza prova remota non cambia alcuna informazione locale", async () => {
    const b = book();
    await saveBook(b, false);
    const intent = await prepareManualPushIntent(b.id);
    const changed = (await getBook(b.id))!;
    changed.remote!.repository = "other";
    await saveBook(changed, false);
    const error = new Error("Marker GitHub non dimostrabile");
    proof.mockRejectedValueOnce(error);
    await expect(reconcileSuspendedManualPush(b.id)).rejects.toBe(error);
    expect(await getManualPushIntent(b.id)).toEqual(intent);
    expect(await getBook(b.id)).toEqual(changed);
  });

  it("rifiuta Web Locks assenti, writer occupato e outbox occupato senza verifiche remote", async () => {
    const b = book();
    await saveBook(b, false);
    const intent = await prepareManualPushIntent(b.id);
    const changed = (await getBook(b.id))!;
    changed.remote!.repository = "other";
    await saveBook(changed, false);
    for (const name of ["bookwriter:writer:" + b.id, "bookwriter:github-outbox"]) {
      held.add(name);
      await expect(reconcileSuspendedManualPush(b.id))
        .rejects.toThrow(name.includes("outbox") ? /sincronizzazione GitHub/ : /Un'altra scheda/);
      held.delete(name);
      expect(proof).not.toHaveBeenCalled();
      expect(await getManualPushIntent(b.id)).toEqual(intent);
    }
    vi.stubGlobal("navigator", {});
    await expect(reconcileSuspendedManualPush(b.id)).rejects.toThrow(/Web Locks/);
    expect(await getManualPushIntent(b.id)).toEqual(intent);
  });

  it("se cambia l'intento durante le GET, il CAS non cancella quello nuovo", async () => {
    const b = book();
    await saveBook(b, false);
    const original = await prepareManualPushIntent(b.id);
    const changed = (await getBook(b.id))!;
    changed.remote!.repository = "different";
    await saveBook(changed, false);
    const replacement = { ...original, operationId: crypto.randomUUID() };
    proof.mockImplementationOnce(async () => {
      await (await getDb()).put("meta", replacement, "manual-github-push:" + b.id);
      return VERIFIED;
    });
    await expect(reconcileSuspendedManualPush(b.id)).rejects.toThrow(/cambiati durante la verifica/);
    expect(await getManualPushIntent(b.id)).toEqual(replacement);
  });

  it("se il manoscritto avanza durante le GET, conserva il tentativo originario", async () => {
    const b = book();
    await saveBook(b, false);
    const intent = await prepareManualPushIntent(b.id);
    const current = (await getBook(b.id))!;
    current.remote!.repository = "different";
    await saveBook(current, false);
    proof.mockImplementationOnce(async () => {
      const later = (await getBook(b.id))!;
      later.brief = "L'autore ha scritto un'altra scena.";
      await saveBook(later, false);
      return VERIFIED;
    });
    await expect(reconcileSuspendedManualPush(b.id)).rejects.toThrow(/cambiati durante la verifica/);
    expect(await getManualPushIntent(b.id)).toEqual(intent);
    expect((await getBook(b.id))?.brief).toContain("un'altra scena");
  });

  it("rifiuta il libro in running anche se un vecchio intento esiste", async () => {
    const b = book();
    await saveBook(b, false);
    const intent = await prepareManualPushIntent(b.id);
    const running = (await getBook(b.id))!;
    running.remote!.repository = "new";
    running.status = "running";
    await saveBook(running, false);
    await expect(reconcileSuspendedManualPush(b.id)).rejects.toThrow(/Metti in pausa/);
    expect(await getManualPushIntent(b.id)).toEqual(intent);
    expect(proof).not.toHaveBeenCalled();
  });
});
