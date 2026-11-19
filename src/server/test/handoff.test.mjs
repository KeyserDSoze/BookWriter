import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FileBookStore, Vault, createRuntime, Controller, newBook, bookEtag } from "../dist/testing.mjs";

async function fixture(action) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-handoff-"));
  const store = new FileBookStore(root), vault = await Vault.open(root), serverId = randomUUID();
  const host = await createRuntime(store, vault, { serverId });
  let valid = true;
  const open = () => new Controller(store, host.runtime, serverId, () => valid);
  const controller = open();
  const client = { id: randomUUID(), label: "Synthetic", scopes: ["read", "write", "run"], hash: "a".repeat(64), revoked: false, createdAt: Date.now() };
  const local = () => {
    const book = newBook("Una storia sintetica.", "Libro locale", "Chiaro", "Adulti");
    book.status = "paused";
    return book;
  };
  const request = (book, extra = {}) => {
    const epoch = randomUUID();
    const handed = { ...book, executionAuthority: { kind: "server", serverId, epoch }, ...extra };
    return { handoffId: randomUUID(), epoch, book: handed, activities: [] };
  };
  try { await action({ root, store, serverId, controller, open, client, local, request, revoke: () => { valid = false; } }); }
  finally { await controller.close(); host.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}
const status = code => error => error.status === code;

test("adoption is idempotent, strips inherited permissions and records a durable receipt", async () => {
  await fixture(async ({ store, controller, client, local, request }) => {
    const book = local();
    book.webResearch = { enabled: true, consentAt: new Date().toISOString(), provider: "model", wikipediaLanguage: "it",
      agents: ["planning"], maxQueriesPerTask: 3, maxRounds: 1, cacheDays: 30 };
    const body = request(book);
    assert.equal(await controller.adopt(client, body), book.id);
    assert.equal(await controller.adopt(client, body), book.id, "a repeated request returns the same acceptance");
    const record = await store.read(book.id);
    assert.equal(record.book.webResearch.enabled, false, "consent to send queries out is never inherited");
    assert.equal(record.book.executionAuthority.epoch, body.epoch);
    assert.equal(record.revision, 1, "the duplicate wrote nothing");
    const receipt = record.commands[body.handoffId];
    assert.equal(receipt.clientId, client.id); assert.equal(receipt.state, "completed");
    assert.deepEqual(record.watermarks, {}, "adoption does not consume a command sequence");
  });
});

test("a plain upload cannot take over: GitHub books, running books, foreign authority and open attempts are refused", async () => {
  await fixture(async ({ store, controller, client, local, request, serverId }) => {
    const github = local(); github.remote = { owner: "synthetic", repository: "book", branch: "main", autoSync: false };
    await assert.rejects(controller.adopt(client, request(github)), status(409));
    const running = local(); running.status = "running";
    await assert.rejects(controller.adopt(client, request(running)), status(409));
    const wrongServer = request(local());
    wrongServer.book.executionAuthority.serverId = randomUUID();
    await assert.rejects(controller.adopt(client, wrongServer), status(409));
    const wrongEpoch = request(local()); wrongEpoch.epoch = randomUUID();
    await assert.rejects(controller.adopt(client, wrongEpoch), status(409));
    const open = request(local());
    open.activities = [{ id: randomUUID(), bookId: open.book.id, runId: randomUUID(), phase: "brainstorm", title: "In corso",
      reason: "", nextStep: "", status: "running", aiRequested: true, createdAt: new Date().toISOString() }];
    await assert.rejects(controller.adopt(client, open), status(409));
    const foreign = request(local()); foreign.activities = [{ id: randomUUID(), bookId: randomUUID(), runId: randomUUID(),
      phase: "brainstorm", title: "Altro libro", reason: "", nextStep: "", status: "succeeded", aiRequested: false, createdAt: new Date().toISOString() }];
    await assert.rejects(controller.adopt(client, foreign), status(409));
    assert.deepEqual(await store.ids(), []);
    assert.equal(serverId.length, 36);
  });
});

test("an existing book is never replaced, and the same handoff id with other bytes is a conflict", async () => {
  await fixture(async ({ store, controller, client, local, request }) => {
    const book = local(), first = request(book);
    await controller.adopt(client, first);
    const before = JSON.stringify(await store.read(book.id));
    const another = request(book);
    await assert.rejects(controller.adopt(client, another), status(409));
    const edited = { ...first, book: { ...first.book, title: "Titolo diverso" } };
    await assert.rejects(controller.adopt(client, edited), status(409));
    assert.equal(JSON.stringify(await store.read(book.id)), before);
    const stranger = { ...client, id: randomUUID() };
    await assert.rejects(controller.adopt(stranger, first), status(409));
  });
});

test("cancelling an unreceived handoff leaves a durable tombstone: a late delivery is rejected, also after restart", async () => {
  await fixture(async ({ store, controller, open, client, local, request }) => {
    const book = local(), body = request(book);
    assert.deepEqual(await controller.cancelHandoff(client, body.handoffId, book.id), { state: "cancelled", bookId: book.id });
    assert.deepEqual(await controller.cancelHandoff(client, body.handoffId, book.id), { state: "cancelled", bookId: book.id });
    await assert.rejects(controller.adopt(client, body), status(409));
    assert.deepEqual(await store.ids(), []);
    await controller.close();
    const restarted = open();
    try {
      await assert.rejects(restarted.adopt(client, body), status(409));
      assert.deepEqual(await store.ids(), []);
    } finally { await restarted.close(); }
  });
});

test("cancelling after acceptance never undoes it; only the owning client can ask", async () => {
  await fixture(async ({ store, controller, client, local, request }) => {
    const book = local(), body = request(book);
    await controller.adopt(client, body);
    assert.deepEqual(await controller.cancelHandoff(client, body.handoffId, book.id), { state: "adopted", bookId: book.id });
    await assert.rejects(controller.cancelHandoff({ ...client, id: randomUUID() }, body.handoffId, book.id), status(409));
    assert.equal((await store.read(book.id)).book.title, book.title);
    assert.deepEqual(await store.ids(), [book.id]);
  });
});

test("command compaction keeps the adoption receipt; a legacy missing receipt never unlocks the client", async () => {
  await fixture(async ({ store, controller, client, local, request }) => {
    const body = request(local()), id = body.book.id;
    await controller.adopt(client, body);
    await store.transaction(id, record => {
      for (let sequence = 1; sequence < 2000; sequence++) {
        record.commands[randomUUID()] = { digest: "b".repeat(64), clientId: client.id, sequence,
          state: "completed", result: { accepted: true } };
      }
      record.watermarks[client.id] = 1999;
    });
    await controller.command(id, client, bookEtag(await store.read(id)), {
      commandId: randomUUID(), sequence: 2000, command: { type: "cancel_retry" },
    });
    assert.deepEqual(await controller.cancelHandoff(client, body.handoffId, id), { state: "adopted", bookId: id });
    assert.equal(await controller.adopt(client, body), id);
    await store.transaction(id, record => { delete record.commands[body.handoffId]; });
    await assert.rejects(controller.cancelHandoff(client, body.handoffId, id), error => error.code === "handoff_unverified");
    assert.deepEqual(await store.ids(), [id]);
  });
});

test("a revoked token and a missing write scope are refused before anything is written", async () => {
  await fixture(async ({ store, controller, client, local, request, revoke }) => {
    const reader = { ...client, scopes: ["read"] };
    const body = request(local());
    await assert.rejects(controller.adopt(reader, body), status(403));
    await assert.rejects(controller.cancelHandoff(reader, body.handoffId, body.book.id), status(403));
    revoke();
    await assert.rejects(controller.adopt(client, body), status(401));
    await assert.rejects(controller.cancelHandoff(client, body.handoffId, body.book.id), status(401));
    assert.deepEqual(await store.ids(), []);
  });
});

test("shutdown refuses a new adoption", async () => {
  await fixture(async ({ store, controller, client, local, request }) => {
    await controller.close();
    await assert.rejects(controller.adopt(client, request(local())), status(503));
    assert.deepEqual(await store.ids(), []);
  });
});
