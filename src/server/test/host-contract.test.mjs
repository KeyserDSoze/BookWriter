import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileBookStore, Vault, createRuntime, hostContract } from "../dist/testing.mjs";

// The same cases the browser runs against IndexedDB (src/frontend/src/host/browser-host.contract.test.ts):
// here they run against the server's file host, so both hosts are held to one behaviour.
const asserts = {
  ok: (value, message) => assert.ok(value, message),
  equal: (actual, expected, message) => assert.equal(actual, expected, message),
  deepEqual: (actual, expected, message) => assert.deepEqual(actual, expected, message),
  rejects: async (promise, accept, message) => {
    await assert.rejects(promise, error => accept(error), message);
  },
};
const recordOf = book => ({ version: 1, revision: 1, book, activities: [], commands: {}, watermarks: {} });

async function withFileHost(action) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-contract-"));
  const store = new FileBookStore(root), vault = await Vault.open(root);
  const runtime = await createRuntime(store, vault);
  try { await action({ host: runtime.runtime, seed: book => store.create(recordOf(book)) }); }
  finally { runtime.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}

for (const contract of hostContract) {
  test(`host contract (file host): ${contract.name}`, async () => withFileHost(env => contract.run(env, asserts)));
}
