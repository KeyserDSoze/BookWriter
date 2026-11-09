import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { getDb, saveBook } from "../infrastructure/db";
import { getManualPushIntent } from "../infrastructure/manual-push-intent";

vi.mock("../infrastructure/github-sync", () => ({ pushGitHubBook: vi.fn() }));
import { pushGitHubBook } from "../infrastructure/github-sync";
import { pushManualGitHubBook } from "./manual-github-push";

const push = vi.mocked(pushGitHubBook);
const occupied = new Set<string>();
const requested: string[] = [];
const locks = {
  request: vi.fn(async (name: string, opts: { ifAvailable: boolean },
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ) => {
    expect(opts).toEqual({ ifAvailable: true });
    requested.push(name);
    return callback(occupied.has(name) ? null : { name });
  }),
};
function book() {
  const b = newBook("Una storia", "GitHub push", "Sobrio", "Adulti");
  b.remote = { owner: "author", repository: "novel", branch: "main",
    lastSyncedCommit: "a".repeat(40), autoSync: false };
  b.status = "paused";
  return b;
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("meta");
  await db.clear("outbox");
  occupied.clear();
  requested.length = 0;
  push.mockReset().mockImplementation(async (_id, _public, options) => ({
    commit: "b".repeat(40), paths: 5, repository: "author/novel",
    sourceRevision: new Date().toISOString(),
    operationId: options?.operationId ?? "missing",
  }));
  vi.stubGlobal("navigator", { locks });
});
afterEach(() => vi.unstubAllGlobals());

describe("Push manuale con Web Locks e ID persistente", () => {
  it("prende writer poi outbox e riusa lo stesso ID dopo nuovo click", async () => {
    const b = book();
    await saveBook(b, false);
    const first = await pushManualGitHubBook(b.id);
    const persisted = await getManualPushIntent(b.id);
    const second = await pushManualGitHubBook(b.id);
    expect(first.operationId).toBe(persisted?.operationId);
    expect(second.operationId).toBe(first.operationId);
    expect(push).toHaveBeenNthCalledWith(1, b.id, false, {
      operationId: first.operationId,
    });
    expect(push).toHaveBeenNthCalledWith(2, b.id, false, {
      operationId: first.operationId,
    });
    expect(requested).toEqual([
      "bookwriter:writer:" + b.id, "bookwriter:github-outbox",
      "bookwriter:writer:" + b.id, "bookwriter:github-outbox",
    ]);
  });

  it("se il push fallisce, conserva l'ID da ritentare dopo reload", async () => {
    const b = book();
    await saveBook(b, false);
    push.mockRejectedValueOnce(new Error("GitHub non raggiungibile."));
    await expect(pushManualGitHubBook(b.id, true)).rejects.toThrow(/non raggiungibile/);
    const previous = (await getManualPushIntent(b.id))!;
    await pushManualGitHubBook(b.id, true);
    expect(push).toHaveBeenLastCalledWith(b.id, true, {
      operationId: previous.operationId,
    });
  });

  it("lock writer o outbox occupato e API assente bloccano prima di salvare ID", async () => {
    const b = book();
    await saveBook(b, false);
    for (const name of ["bookwriter:writer:" + b.id, "bookwriter:github-outbox"]) {
      occupied.add(name);
      await expect(pushManualGitHubBook(b.id)).rejects.toThrow(
        name.includes("github-outbox") ? /sincronizzazione GitHub/ : /Un'altra scheda/,
      );
      occupied.delete(name);
      expect(await getManualPushIntent(b.id)).toBeUndefined();
      expect(push).not.toHaveBeenCalled();
    }
    vi.stubGlobal("navigator", {});
    await expect(pushManualGitHubBook(b.id)).rejects.toThrow(/Web Locks non disponibile/);
    expect(await getManualPushIntent(b.id)).toBeUndefined();
  });
});
