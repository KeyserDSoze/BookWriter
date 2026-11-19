import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { host } from "@engine/core/host";
import { hostContract, type ContractAsserts } from "@engine/testing/host-contract";
import { getDb } from "../infrastructure/db";

// The same cases the server runs against its file host (src/server/test/host-contract.test.mjs):
// here they run against IndexedDB, WebCrypto and a Web Locks manager that behaves like the real one
// for `ifAvailable` requests.
const held = new Set<string>();
const locks = {
  request: async (name: string, options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => Promise<unknown>) => {
    expect(options).toEqual({ ifAvailable: true });
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  },
};
beforeAll(() => { vi.stubGlobal("navigator", { onLine: true, locks }); });
afterAll(() => vi.unstubAllGlobals());

const asserts: ContractAsserts = {
  ok: (value, message) => expect(value, message).toBeTruthy(),
  equal: (actual, expected, message) => expect(actual, message).toBe(expected),
  deepEqual: (actual, expected, message) => expect(actual, message).toEqual(expected),
  rejects: async (promise, accept, message) => {
    const error = await promise.then(() => undefined, caught => ({ caught }));
    expect(error, message ?? "the promise should have been rejected").toBeDefined();
    expect(accept(error!.caught), message ?? "the rejection is not the expected one").toBe(true);
  },
};

describe("Contratto dell'host: browser (IndexedDB, WebCrypto, Web Locks)", () => {
  for (const contract of hostContract) {
    it(contract.name, async () => {
      await contract.run({
        host: host(),
        seed: async book => { await (await getDb()).put("books", book, book.id); },
      }, asserts);
    });
  }
});
