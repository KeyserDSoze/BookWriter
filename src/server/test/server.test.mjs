import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { randomUUID, createPublicKey, verify, createHash } from "node:crypto";
import {
  lockDataRoot, FileBookStore, Vault, createRuntime, newBook, DEFAULT_SETTINGS, startPersonalServer,
  AutopilotRunner, makeRetrySchedule, retryStamp, narrativeStateJson, publicAddress, currentStamp,
  pushManualGitHubBook, claimRetrySchedule, getRetrySchedule, saveFailedRetry,
} from "../dist/testing.mjs";

async function temporary(action) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-test-"));
  try { return await action(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const recordOf = book => ({ version: 1, revision: 1, book, activities: [], commands: {}, watermarks: {} });

test("file transaction: book, audit and outbox share one commit; stale and throw preserve all bytes", async () => temporary(async root => {
  const release = await lockDataRoot(root);
  try {
    const store = new FileBookStore(root);
    const book = newBook("Sintetico", "File", "Chiaro", "Adulti");
    await store.create(recordOf(book));
    const before = await fs.readFile(join(root, book.id + ".bookwriter.json"), "utf8");
    await assert.rejects(store.transaction(book.id, record => { record.book.title = "Non confermato"; throw new Error("ENOSPC"); }));
    assert.equal(await fs.readFile(join(root, book.id + ".bookwriter.json"), "utf8"), before);
    const vault = await Vault.open(root); const host = await createRuntime(store, vault);
    try {
      const copy = await host.runtime.getBook(book.id);
      await assert.rejects(host.runtime.saveBook(copy, true, "stale"));
      assert.equal(await fs.readFile(join(root, book.id + ".bookwriter.json"), "utf8"), before);
      const now = new Date().toISOString();
      await host.runtime.saveBookAndActivity(copy, { id: randomUUID(), bookId: book.id, runId: randomUUID(),
        phase: "brainstorm", title: "Task", reason: "Test", nextStep: "Test", status: "succeeded", aiRequested: false,
        createdAt: now, endedAt: now }, book.updatedAt);
      const saved = await store.read(book.id);
      assert.equal(saved.activities.length, 1); assert.equal(Object.keys(saved.structuralCheckpoints).length, 1);
      assert.equal(saved.revision, 2);
    } finally { host.dispose(); }
  } finally { await release(); }
}));

test("real OS lock rejects a second process guard and releases after shutdown", async () => temporary(async root => {
  const release = await lockDataRoot(root);
  await assert.rejects(lockDataRoot(root), /già usata/);
  await release();
  const again = await lockDataRoot(root); await again();
}));

test("vault keeps credentials outside book files and survives reopen without re-key", async () => temporary(async root => {
  const vault = await Vault.open(root); const encrypted = await vault.encrypt("synthetic-secret-only");
  assert.notEqual(encrypted.data, "synthetic-secret-only");
  assert.equal(await (await Vault.open(root)).decrypt(encrypted), "synthetic-secret-only");
  await assert.rejects(vault.decrypt({ ...encrypted, data: "invalid" }));
  if (process.platform !== "win32") {
    await fs.chmod(join(root, "private", "master.key"), 0o644);
    await assert.rejects(Vault.open(root), /Permessi/);
  }
}));

test("path traversal and symlink book files fail closed", async () => temporary(async root => {
  const store = new FileBookStore(root);
  await assert.rejects(store.read("../private/master.key"), /ID/);
  if (process.platform !== "win32") {
    const id = randomUUID(); await fs.writeFile(join(root, "other.json"), "{}");
    await fs.symlink(join(root, "other.json"), join(root, id + ".bookwriter.json"));
    await assert.rejects(store.read(id), /regolare/);
  }
}));

test("shared runner executes a real simulated HTTP completion on the file adapter", async () => temporary(async root => {
  const store = new FileBookStore(root); const vault = await Vault.open(root);
  const book = newBook("Una storia sintetica", "Parità", "Chiaro", "Adulti"); await store.create(recordOf(book));
  const host = await createRuntime(store, vault);
  let posts = 0;
  const runner = new AutopilotRunner();
  const provider = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
    posts++; runner.stopAfterCurrent();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "Idee LONG MID SHORT sintetiche." } }], usage: { prompt_tokens: 17, completion_tokens: 9 } }));
  });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultRoute = { endpointId: "openai", modelId: "mock" };
    settings.endpoints[0] = { ...settings.endpoints[0], baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, authMode: "none", secret: null };
    await host.runtime.saveSettings(settings);
    await runner.run(book.id, async () => {});
    const saved = await store.read(book.id);
    assert.equal(posts, 1); assert.equal(saved.book.phase, "validate"); assert.equal(saved.book.status, "paused");
    const attempt = saved.activities.find(a => a.aiRequested);
    assert.equal(attempt.status, "succeeded"); assert.equal(attempt.inputTokens, 17); assert.equal(attempt.outputTokens, 9);
    assert.equal(Object.keys(saved.structuralCheckpoints).length, 1);
  } finally { host.dispose(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
}));

test("admin/API separation, signed identity, scopes, CSRF, idempotency and CAS", async () => temporary(async root => {
  const release = await lockDataRoot(root);
  const server = await startPersonalServer({ root, adminPort: 0, apiPort: 0 });
  const api = `http://127.0.0.1:${server.apiPort}`;
  const admin = `http://127.0.0.1:${server.adminPort}`;
  try {
    const nonce = "a".repeat(64);
    const info = await (await fetch(api + "/api/v1/info?nonce=" + nonce)).json();
    const key = createPublicKey({ key: Buffer.from(info.publicKey, "base64"), format: "der", type: "spki" });
    assert.equal(verify(null, Buffer.from(nonce + "\n" + info.serverId + "\n" + info.publicKey), key, Buffer.from(info.signature, "base64")), true);
    assert.equal((await fetch(api + "/api/v1/books")).status, 401);
    assert.equal((await fetch(api + "/admin/api/status")).status, 401);
    assert.equal((await fetch(admin + "/admin/api/status")).status, 401);
    assert.equal((await fetch(admin + "/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"code":"x"}' })).status, 403);
    const token = await server.auth.issue("test-client", ["read", "write", "run"]);
    const reader = await server.auth.issue("read-only", ["read"]);
    const request = (path, body, extra = {}, auth = token.token) => fetch(api + path, {
      method: body === undefined ? "GET" : "POST", headers: { apikey: auth, "Content-Type": "application/json", ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal((await request("/api/v1/books", { commandId: randomUUID(), title: "X", brief: "S", writingStyle: "", audience: "" }, {}, reader.token)).status, 403);
    const creation = { commandId: randomUUID(), title: "Libro sintetico", brief: "Una storia.", writingStyle: "Chiaro", audience: "Adulti" };
    const created = await (await request("/api/v1/books", creation)).json();
    assert.equal((await (await request("/api/v1/books", creation)).json()).bookId, created.bookId);
    const snapshotResponse = await request(`/api/v1/books/${created.bookId}/snapshot`);
    const snapshot = await snapshotResponse.json(); const etag = snapshotResponse.headers.get("etag");
    assert.equal(snapshot.book.executionAuthority.serverId, info.serverId);
    const edit = { commandId: randomUUID(), sequence: snapshot.nextSequence, command: {
      type: "edit_memory", memoryId: "state", text: "Nuovo stato sintetico.",
      expectedStamp: currentStamp(snapshot.book, { kind: "memory", id: "state" }),
    } };
    const editPath = `/api/v1/books/${created.bookId}/commands`;
    assert.equal((await request(editPath, edit, { "If-Match": etag })).status, 200);
    assert.equal((await request(editPath, edit, { "If-Match": etag })).status, 200, "dedupe comes before stale CAS");
    const altered = { ...edit, command: { ...edit.command, text: "Diverso" } };
    assert.equal((await request(editPath, altered, { "If-Match": etag })).status, 409);
    assert.equal((await request(editPath, { ...edit, commandId: randomUUID(), sequence: 2 }, { "If-Match": etag })).status, 412);
    const after = await (await request(`/api/v1/books/${created.bookId}/snapshot`)).json();
    assert.equal(after.book.memory.currentState, edit.command.text); assert.equal(after.activities.length, 1);
    const receiptResponse = await request(editPath + "/" + edit.commandId);
    assert.equal(receiptResponse.status, 200);
    assert.equal((await receiptResponse.json()).sequence, edit.sequence);
    const missing = { commandId: randomUUID(), sequence: 2, command: { type: "start" } };
    const current = await request(`/api/v1/books/${created.bookId}/snapshot`);
    const resolved = await request(editPath + "/" + missing.commandId + "/resolve", missing, { "If-Match": current.headers.get("etag") });
    assert.equal(resolved.status, 200);
    assert.deepEqual((await resolved.json()).result, { ok: false, code: "cancelled_before_acceptance" });
    assert.equal((await request(editPath, missing, { "If-Match": etag })).status, 200, "late original returns the tombstone");
    assert.equal(server.controller.busy, false);
    const foreignReceipt = await request(editPath + "/" + edit.commandId, undefined, {}, reader.token);
    assert.equal(foreignReceipt.status, 404);
    assert.equal(JSON.stringify(after).includes(token.token), false);
    assert.equal((await request("/api/v1/books", undefined, { Origin: "https://evil.example" })).status, 403);
    await server.auth.revoke(token.clientId);
    assert.equal((await request("/api/v1/books")).status, 401);
  } finally { await server.close(); await release(); }
}));

test("pairing requires local approval, is single-use, bounded and survives restart", async () => temporary(async root => {
  const store = new FileBookStore(root); const vault = await Vault.open(root);
  const { Auth } = await import("../dist/testing.mjs");
  let auth = await Auth.open(store, vault);
  const pairing = await auth.pairing(["read", "run"]); const nonce = "b".repeat(64);
  const request = await auth.requestPairing(pairing.code, nonce, "Phone");
  assert.deepEqual(await auth.pollPairing(request.id, nonce), { pending: true });
  auth = await Auth.open(store, vault);
  await auth.approvePairing(request.id);
  const result = await auth.pollPairing(request.id, nonce);
  assert.equal(auth.authenticate(result.token, "run").label, "Phone");
  await assert.rejects(auth.pollPairing(request.id, nonce));
  await assert.rejects(auth.pairing(["update"]));
  const limited = await auth.pairing(["read"]);
  for (let n = 0; n < 5; n++) await assert.rejects(auth.requestPairing("000000000", nonce, "Wrong"));
  await assert.rejects(auth.requestPairing(limited.code, nonce, "Late"));
}));

test("network classification rejects metadata, private, mapped and transition addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.2",
    "100.64.0.1", "::1", "::ffff:127.0.0.1", "2002:0a00:1::", "2001:db8::1"])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true); assert.equal(publicAddress("2606:4700:4700::1111"), true);
});

test("file retry schedule and failed attempt are atomic, restartable and claimed only once", async () => temporary(async root => {
  const store = new FileBookStore(root), vault = await Vault.open(root);
  const book = newBook("Storia sintetica", "Attesa", "Chiaro", "Adulti"); book.status = "paused";
  await store.create(recordOf(book));
  let host = await createRuntime(store, vault);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0].longTermRetry = { enabled: true, intervalMinutes: 1, maxCycles: 3 };
  await host.runtime.saveSettings(settings);
  const runId = randomUUID();
  const plan = makeRetrySchedule({ bookId: book.id, runId, endpointId: "openai", modelId: "mock",
    bookStamp: retryStamp(narrativeStateJson(book)), taskKey: retryStamp("brainstorm:synthetic"),
    policy: settings.endpoints[0].longTermRetry, authorizedPolicies: { openai: settings.endpoints[0].longTermRetry },
    cyclesUsed: 0, now: Date.now() });
  const now = new Date().toISOString();
  const attempt = { id: randomUUID(), bookId: book.id, runId, phase: "brainstorm", title: "Task sintetico",
    reason: "Test", nextStep: "Attesa", status: "failed", aiRequested: true, createdAt: now, endedAt: now };
  try {
    await assert.rejects(saveFailedRetry(book, attempt, "stale", plan));
    assert.equal((await store.read(book.id)).activities.length, 0);
    await saveFailedRetry(book, attempt, book.updatedAt, plan);
    host.dispose(); host = await createRuntime(store, vault);
    assert.equal((await getRetrySchedule(book.id)).runId, runId);
    const claims = await Promise.allSettled([claimRetrySchedule(book.id, plan.generation, true), claimRetrySchedule(book.id, plan.generation, true)]);
    assert.equal(claims.filter(c => c.status === "fulfilled").length, 1);
    host.dispose(); host = await createRuntime(store, vault);
    await assert.rejects(claimRetrySchedule(book.id, plan.generation, true));
    const record = await store.read(book.id);
    assert.equal(record.activities.length, 1); assert.equal(record.activities[0].aiRequested, true);
    assert.equal(record.activities[0].inputTokens, undefined, "unknown usage stays unknown");
  } finally { host.dispose(); }
}));

test("Node manual GitHub save uses delegated PAT and recovers a lost PATCH ACK without a second PATCH", async () => temporary(async root => {
  const store = new FileBookStore(root), vault = await Vault.open(root);
  const book = newBook("Storia sintetica", "GitHub", "Chiaro", "Adulti");
  book.status = "paused"; book.remote = { owner: "synthetic", repository: "book", branch: "main", autoSync: false };
  await store.create(recordOf(book));
  const host = await createRuntime(store, vault);
  await host.provision({ settings: { defaultRoute: DEFAULT_SETTINGS.defaultRoute, taskRoutes: {},
    endpoints: DEFAULT_SETTINGS.endpoints.map(({ secret, ...e }) => e) },
    endpointKeys: {}, bookId: book.id, githubToken: "github_pat_synthetic_server_only" }, 0, ["https://api.openai.com/v1"]);
  const originalFetch = globalThis.fetch;
  const before = "a".repeat(40), after = "d".repeat(40);
  let head = before, patches = 0, marker, message, published;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (raw, init = {}) => {
    const url = new URL(String(raw)), method = init.method ?? "GET";
    assert.equal(url.origin, "https://api.github.com"); assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer github_pat_synthetic_server_only");
    if (url.pathname === "/repos/synthetic/book") return response({ private: true, permissions: { push: true } });
    if (url.pathname.endsWith("/git/ref/heads/main")) return response({ object: { sha: head } });
    if (url.pathname.includes("/contents/.bookwriter/sync.json") && marker) return response({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(marker)).toString("base64") });
    if (url.pathname.includes("/contents/")) return response({}, 404);
    if (url.pathname.endsWith("/git/commits/" + before)) return response({ tree: { sha: "b".repeat(40) } });
    if (url.pathname.endsWith("/git/commits/" + after)) return response({ message });
    if (url.pathname.endsWith("/git/trees") && method === "POST") {
      const body = JSON.parse(init.body); published = JSON.stringify(body);
      marker = JSON.parse(body.tree.find(entry => entry.path === ".bookwriter/sync.json").content);
      return response({ sha: "c".repeat(40) }, 201);
    }
    if (url.pathname.endsWith("/git/commits") && method === "POST") { message = JSON.parse(init.body).message; return response({ sha: after }, 201); }
    if (method === "PATCH") {
      patches++; assert.equal(JSON.parse(init.body).force, false);
      assert.ok((await store.read(book.id)).manualPushIntent, "intent durable before PATCH");
      head = after;
      throw new TypeError("synthetic dropped ACK after application");
    }
    throw new Error("Unexpected synthetic request");
  };
  try {
    const result = await pushManualGitHubBook(book.id);
    assert.equal(result.commit, after); assert.equal(result.recovered, true); assert.equal(patches, 1);
    const saved = await store.read(book.id);
    assert.equal(saved.book.remote.lastSyncedCommit, after); assert.equal(saved.manualPushIntent, undefined);
    assert.equal(published.includes("github_pat_synthetic_server_only"), false);
    assert.equal(published.includes("retrySchedule"), false);
    assert.equal((await fs.readFile(join(root, "private", "settings.json"), "utf8")).includes("github_pat_synthetic_server_only"), false);
  } finally { globalThis.fetch = originalFetch; host.dispose(); }
}));

test("restart marks requested commands and in-flight AI as uncertain, with no replay or invented usage", async () => temporary(async root => {
  const release = await lockDataRoot(root);
  let server = await startPersonalServer({ root, apiPort: 0, adminPort: 0 });
  const token = await server.auth.issue("Crash test", ["read", "write", "run"]);
  const client = server.auth.authenticate(token.token);
  const id = await server.controller.create(client, randomUUID(), { title: "Crash", brief: "Sintetico", writingStyle: "", audience: "" });
  const command = { commandId: randomUUID(), sequence: 1, command: { type: "start" } };
  const runId = randomUUID(), activityId = randomUUID();
  await server.store.transaction(id, record => {
    record.book.status = "running";
    record.runAuthorization = { commandId: command.commandId, runId, state: "started" };
    record.commands[command.commandId] = { clientId: client.id, sequence: 1, state: "accepted",
      digest: createHash("sha256").update(JSON.stringify({ clientId: client.id, ...command })).digest("hex"), result: { runId } };
    record.watermarks[client.id] = 1;
    record.activities.push({ id: activityId, bookId: id, runId, phase: "brainstorm", title: "Richiesta incerta",
      reason: "", nextStep: "", status: "running", aiRequested: true, createdAt: new Date().toISOString() });
  });
  await server.close();
  server = await startPersonalServer({ root, apiPort: 0, adminPort: 0 });
  try {
    const recovered = await server.store.read(id);
    assert.equal(recovered.book.status, "paused");
    assert.equal(recovered.activities[0].status, "cancelled");
    assert.equal(recovered.activities[0].inputTokens, undefined);
    assert.equal(recovered.runAuthorization.state, "uncertain");
    const replay = await server.controller.command(id, server.auth.authenticate(token.token), '"stale"', command);
    assert.equal(replay.state, "uncertain");
    assert.equal((await server.store.read(id)).activities.length, 1);
    assert.equal(server.controller.busy, false);
  } finally { await server.close(); await release(); }
}));
