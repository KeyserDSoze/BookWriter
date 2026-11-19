import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  FileBookStore, Vault, createRuntime, Controller, bookEtag, DEFAULT_SETTINGS, currentStamp, withExclusiveLock,
} from "../dist/testing.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(action, authority = async () => {}) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-controller-"));
  const store = new FileBookStore(root), vault = await Vault.open(root), serverId = randomUUID();
  const host = await createRuntime(store, vault, { serverId, assertAuthority: authority });
  let valid = true;
  const controller = new Controller(store, host.runtime, serverId, () => valid);
  const client = { id: randomUUID(), label: "Synthetic", scopes: ["read", "write", "run"],
    hash: "a".repeat(64), revoked: false, createdAt: Date.now() };
  const create = () => controller.create(client, randomUUID(), {
    title: "Libro sintetico", brief: "Una storia sintetica.", writingStyle: "Chiaro", audience: "Adulti",
  });
  const send = async (id, command, commandId = randomUUID()) => {
    const record = await store.read(id);
    return controller.command(id, client, bookEtag(record), {
      commandId, sequence: (record.watermarks?.[client.id] ?? 0) + 1, command,
    });
  };
  try { await action({ root, store, host, controller, client, create, send, revoke: () => { valid = false; } }); }
  finally { await controller.close(); host.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}
async function provider(host, action) {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
    posts++;
    req.resume();
    action(res);
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute = { endpointId: "openai", modelId: "synthetic" };
  settings.endpoints[0] = { ...settings.endpoints[0], baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    authMode: "none", secret: null };
  await host.runtime.saveSettings(settings);
  return { posts: () => posts, close: async () => {
    server.closeAllConnections(); await new Promise(done => server.close(done));
  } };
}

test("pause during ownership checks aborts the admitted run; duplicate start cannot restart it", { timeout: 10_000 }, async () => {
  const entered = deferred(), release = deferred();
  await fixture(async ({ host, store, controller, client, create, send }) => {
    const http = await provider(host, res => { res.writeHead(503); res.end(); });
    try {
      const id = await create(), commandId = randomUUID();
      const before = await store.read(id);
      const envelope = { commandId, sequence: 1, command: { type: "start" } };
      const started = await controller.command(id, client, bookEtag(before), envelope);
      assert.equal(started.state, "completed", "runner is registered before the start receipt completes");
      await entered.promise;
      assert.equal(controller.busy, true);
      const paused = await send(id, { type: "pause" });
      assert.deepEqual(paused.result, { pauseRequested: true });
      const duplicate = await controller.command(id, client, bookEtag(before), envelope);
      assert.deepEqual(duplicate, started);
      release.resolve();
      await controller.waitForIdle();
      assert.equal(http.posts(), 0);
      const after = await store.read(id);
      assert.equal(after.book.status, "paused");
      assert.equal(after.runAuthorization.state, "stopped");
      assert.equal(after.activities.some(a => a.aiRequested), false);
      assert.equal(controller.busy, false);
    } finally { release.resolve(); await http.close(); }
  }, async () => { entered.resolve(); await release.promise; });
});

test("simultaneous starts on three books reserve only two slots, without a stranded authorization", { timeout: 10_000 }, async () => {
  const release = deferred();
  await fixture(async ({ host, store, controller, client, create, send }) => {
    const http = await provider(host, res => { res.writeHead(503); res.end(); });
    try {
      const ids = await Promise.all([create(), create(), create()]);
      const records = await Promise.all(ids.map(id => store.read(id)));
      const results = await Promise.allSettled(ids.map((id, index) => controller.command(id, client, bookEtag(records[index]), {
        commandId: randomUUID(), sequence: 1, command: { type: "start" },
      })));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
      assert.equal(results.filter(r => r.status === "rejected" && r.reason.status === 409).length, 1);
      for (let i = 0; i < ids.length; i++) {
        if (results[i].status === "fulfilled") await send(ids[i], { type: "pause" });
        else {
          const untouched = await store.read(ids[i]);
          assert.equal(untouched.runAuthorization, undefined);
          assert.equal(untouched.watermarks[client.id], undefined);
        }
      }
      release.resolve(); await controller.waitForIdle();
      assert.equal(http.posts(), 0);
      assert.equal(controller.busy, false);
    } finally { release.resolve(); await http.close(); }
  }, () => release.promise);
});

test("revocation between durable acceptance and activation leaves no executable start", { timeout: 10_000 }, async () => {
  await fixture(async ({ store, controller, client, create, revoke }) => {
    const id = await create(), accepted = deferred(), release = deferred();
    const transaction = store.transaction.bind(store);
    store.transaction = async (bookId, change) => {
      const result = await transaction(bookId, change);
      if (bookId === id && (await store.read(id)).runAuthorization?.state === "requested") {
        accepted.resolve(); await release.promise;
      }
      return result;
    };
    const before = await store.read(id);
    const pending = controller.command(id, client, bookEtag(before), {
      commandId: randomUUID(), sequence: 1, command: { type: "start" },
    });
    try {
      await accepted.promise; revoke(); release.resolve();
      const result = await pending;
      assert.equal(result.state, "completed");
      assert.equal(result.result.ok, false);
      const after = await store.read(id);
      assert.equal(after.runAuthorization.state, "stopped");
      assert.equal(after.book.status, "paused");
      assert.equal(after.activities.length, 0);
      assert.equal(controller.busy, false);
    } finally { release.resolve(); }
  });
});

test("shutdown wins over a queued start before admission; no activity or authorization is created", { timeout: 10_000 }, async () => {
  await fixture(async ({ store, controller, client, create }) => {
    const id = await create(), entered = deferred(), release = deferred();
    const serial = store.serial.bind(store);
    store.serial = (key, action) => serial(key, async () => {
      if (key === "$run-admission") { entered.resolve(); await release.promise; }
      return action();
    });
    const before = await store.read(id);
    const pending = controller.command(id, client, bookEtag(before), {
      commandId: randomUUID(), sequence: 1, command: { type: "start" },
    });
    try {
      await entered.promise;
      const closing = controller.close();
      release.resolve();
      await assert.rejects(pending, error => error.status === 503);
      await closing;
      assert.deepEqual(await store.read(id), before);
      assert.equal(controller.busy, false);
    } finally { release.resolve(); }
  });
});

test("configuration excludes new runs and autosync; active runs reject configuration changes", { timeout: 10_000 }, async () => {
  const authorityEntered = deferred(), authorityRelease = deferred();
  await fixture(async ({ host, store, controller, client, create, send }) => {
    const id = await create(), configuring = deferred(), configured = deferred();
    const http = await provider(host, res => { res.writeHead(503); res.end(); });
    try {
      const configuration = controller.configure(async () => { configuring.resolve(); await configured.promise; });
      await configuring.promise;
      let started = false;
      const before = await store.read(id);
      const start = controller.command(id, client, bookEtag(before), {
        commandId: randomUUID(), sequence: 1, command: { type: "start" },
      }).then(value => { started = true; return value; });
      await Promise.resolve();
      assert.equal(started, false);
      await assert.rejects(withExclusiveLock("bookwriter:github-outbox", { busy: "Un'altra operazione sta usando il blocco." }, async () => {}), /blocco/);
      configured.resolve(); await configuration; await start; await authorityEntered.promise;
      await assert.rejects(controller.configure(async () => {}), error => error.status === 409);
      await send(id, { type: "pause" }); authorityRelease.resolve(); await controller.waitForIdle();
      await controller.configure(async () => {});
      assert.equal(http.posts(), 0);
    } finally { configured.resolve(); authorityRelease.resolve(); await http.close(); }
  }, async () => { authorityEntered.resolve(); await authorityRelease.promise; });
});

test("a remote author edit during HTTP inference wins; discarded output preserves usage and stop-after-task", { timeout: 10_000 }, async () => {
  await fixture(async ({ host, store, controller, create, send }) => {
    const request = deferred(), response = deferred();
    const http = await provider(host, res => {
      request.resolve();
      void response.promise.then(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "Idee sintetiche LONG MID SHORT." } }],
          usage: { prompt_tokens: 17, completion_tokens: 9 } }));
      });
    });
    try {
      const id = await create();
      await send(id, { type: "start" });
      await request.promise;
      const before = await store.read(id);
      await send(id, { type: "edit_memory", memoryId: "state", text: "Stato stabilito dall'autore.",
        expectedStamp: currentStamp(before.book, { kind: "memory", id: "state" }) });
      await send(id, { type: "stop_after_task" });
      response.resolve();
      await controller.waitForIdle();
      const after = await store.read(id);
      assert.equal(http.posts(), 1);
      assert.equal(after.book.memory.currentState, "Stato stabilito dall'autore.");
      assert.equal(after.book.phase, "brainstorm", "the stale brainstorm result must not advance the book");
      assert.equal(after.book.status, "paused");
      const attempts = after.activities.filter(a => a.aiRequested);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].status, "cancelled");
      assert.equal(attempts[0].inputTokens, 17);
      assert.equal(attempts[0].outputTokens, 9);
      assert.equal(after.activities.filter(a => a.title === "Modifica dell'autore").length, 1);
    } finally { response.resolve(); await http.close(); }
  });
});

test("shutdown drains an accepted GitHub effect; a duplicate never repeats an uncertain save", { timeout: 10_000 }, async () => {
  await fixture(async ({ store, host, controller, client, create }) => {
    const id = await create();
    await store.transaction(id, record => {
      record.book.remote = { owner: "synthetic", repository: "book", branch: "main", autoSync: false };
    });
    await host.provision({ settings: { defaultRoute: DEFAULT_SETTINGS.defaultRoute, taskRoutes: {},
      endpoints: DEFAULT_SETTINGS.endpoints.map(({ secret, ...endpoint }) => endpoint) },
    endpointKeys: {}, bookId: id, githubToken: "github_pat_synthetic_lifecycle" }, 0, ["https://api.openai.com/v1"]);
    const fetched = deferred(), release = deferred(), originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++; fetched.resolve(); await release.promise;
      return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
    };
    try {
      const before = await store.read(id);
      const command = { commandId: randomUUID(), sequence: 1, command: { type: "save_github", consentPublic: false } };
      const first = await controller.command(id, client, bookEtag(before), command);
      assert.equal(first.state, "accepted"); await fetched.promise;
      assert.equal(controller.busy, true);
      const repeated = await controller.command(id, client, bookEtag(before), command);
      assert.deepEqual(repeated, first);
      let closed = false;
      const closing = controller.close().then(() => { closed = true; });
      await Promise.resolve(); assert.equal(closed, false);
      release.resolve(); await closing;
      const receipt = (await store.read(id)).commands[command.commandId];
      assert.equal(receipt.state, "uncertain");
      assert.equal(receipt.result.ok, false);
      assert.equal(calls, 1);
      assert.equal((await store.read(id)).manualPushIntent.operationId.length, 36);
    } finally { release.resolve(); globalThis.fetch = originalFetch; }
  });
});

test("resolving a missing start tombstones its exact identity; a late original cannot execute", { timeout: 10_000 }, async () => {
  await fixture(async ({ store, controller, client, create, send }) => {
    const id = await create(), before = await store.read(id);
    const command = { commandId: randomUUID(), sequence: 1, command: { type: "start" } };
    const cancelled = await controller.resolveCommand(id, client, bookEtag(before), command);
    assert.deepEqual(cancelled.result, { ok: false, code: "cancelled_before_acceptance" });
    assert.equal((await store.read(id)).watermarks[client.id], 1);
    const repeated = await controller.command(id, client, bookEtag(before), command);
    assert.deepEqual(repeated, cancelled);
    assert.equal(controller.busy, false);
    const after = await store.read(id);
    assert.equal(after.runAuthorization, undefined);
    assert.equal(after.activities.length, 0);
    assert.equal(after.book.updatedAt, before.book.updatedAt, "a tombstone is not a narrative edit");
    await assert.rejects(controller.command(id, client, bookEtag(after), {
      ...command, command: { type: "pause" },
    }), error => error.status === 409);
    const next = await send(id, { type: "cancel_retry" });
    assert.equal(next.sequence, 2);
  });
});

test("reconciliation of an already admitted start only reads its receipt; it neither cancels nor replays it", { timeout: 10_000 }, async () => {
  const entered = deferred(), release = deferred();
  await fixture(async ({ controller, store, client, create, send }) => {
    try {
      const id = await create(), before = await store.read(id);
      const command = { commandId: randomUUID(), sequence: 1, command: { type: "start" } };
      const first = await controller.command(id, client, bookEtag(before), command);
      await entered.promise;
      const resolved = await controller.resolveCommand(id, client, '"stale"', command);
      assert.deepEqual(resolved, first);
      assert.equal((await store.read(id)).runAuthorization.state, "started");
      const stranger = { ...client, id: randomUUID() };
      await assert.rejects(controller.resolveCommand(id, stranger, '"stale"', command), error => error.status === 409);
      await send(id, { type: "pause" }); release.resolve(); await controller.waitForIdle();
    } finally { release.resolve(); }
  }, async () => { entered.resolve(); await release.promise; });
});

test("an evicted receipt is not evidence of a missing command; replay watermarks remain binding", { timeout: 10_000 }, async () => {
  await fixture(async ({ store, controller, client, create }) => {
    const id = await create(), before = await store.read(id);
    const command = { commandId: randomUUID(), sequence: 1, command: { type: "cancel_retry" } };
    await controller.command(id, client, bookEtag(before), command);
    await store.transaction(id, record => { delete record.commands[command.commandId]; });
    const pruned = await store.read(id);
    await assert.rejects(controller.resolveCommand(id, client, bookEtag(pruned), command), error => error.status === 409);
    await assert.rejects(controller.command(id, client, bookEtag(pruned), command), error => error.status === 409);
    assert.deepEqual(await store.read(id), pruned);
  });
});
