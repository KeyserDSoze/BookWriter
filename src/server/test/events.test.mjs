import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { lockDataRoot, startPersonalServer, currentStamp } from "../dist/testing.mjs";

async function withServer(action) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-events-"));
  const release = await lockDataRoot(root);
  const server = await startPersonalServer({ root, adminPort: 0, apiPort: 0, git: false });
  try { await action(server, `http://127.0.0.1:${server.apiPort}`); }
  finally { await server.close(); await release(); await fs.rm(root, { recursive: true, force: true }); }
}

/** Reads SSE frames from a real response until `until` is satisfied or the stream ends. */
async function frames(response, until, ms = 4000) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const seen = []; let buffer = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const part = await Promise.race([reader.read(), new Promise(done => setTimeout(() => done({ timeout: true }), 200))]);
      if (part.timeout) continue;
      if (part.done) return { seen, ended: true };
      buffer += decoder.decode(part.value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
        if (event) seen.push({ event, data: data ? JSON.parse(data) : undefined });
      }
      if (until(seen)) return { seen, ended: false };
    }
    return { seen, ended: false, timedOut: true };
  } finally { try { await reader.cancel(); } catch { /* closed */ } }
}

test("event stream: apikey only, catch-up marker, commit notification and revocation", async () => withServer(async (server, api) => {
  assert.equal((await fetch(api + "/api/v1/events")).status, 401);
  assert.equal((await fetch(api + "/api/v1/events?apikey=x")).status, 401, "a token in the URL is never accepted");
  const writer = await server.auth.issue("writer", ["read", "write", "run"]);
  const noRead = await server.auth.issue("no-read", ["write"]);
  assert.equal((await fetch(api + "/api/v1/events", { headers: { apikey: noRead.token } })).status, 403);
  const request = (path, body, auth = writer.token, extra = {}) => fetch(api + path, {
    method: body === undefined ? "GET" : "POST", headers: { apikey: auth, "Content-Type": "application/json", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const bookId = (await (await request("/api/v1/books", { commandId: randomUUID(), title: "Diretta", brief: "Una storia.", writingStyle: "", audience: "" })).json()).bookId;

  const live = await fetch(api + "/api/v1/events", { headers: { apikey: writer.token } });
  assert.equal(live.status, 200);
  assert.match(live.headers.get("content-type"), /^text\/event-stream/);
  const reading = frames(live, seen => seen.some(e => e.event === "snapshot-required" && e.data.bookId === bookId));
  await new Promise(done => setTimeout(done, 100));
  const snapshotResponse = await request(`/api/v1/books/${bookId}/snapshot`);
  const snapshot = await snapshotResponse.json();
  const edit = { commandId: randomUUID(), sequence: snapshot.nextSequence, command: { type: "edit_memory", memoryId: "state",
    text: "Nuovo stato.", expectedStamp: currentStamp(snapshot.book, { kind: "memory", id: "state" }) } };
  assert.equal((await request(`/api/v1/books/${bookId}/commands`, edit, writer.token, { "If-Match": snapshotResponse.headers.get("etag") })).status, 200);
  const result = await reading;
  assert.deepEqual(result.seen[0], { event: "snapshot-required", data: { all: true } });
  assert.ok(result.seen.some(e => e.event === "snapshot-required" && e.data.bookId === bookId), "the commit was announced");
  const payload = JSON.stringify(result.seen);
  assert.equal(payload.includes("Nuovo stato."), false, "events carry identifiers, never the manuscript");
  assert.equal(payload.includes(writer.token), false);

  const revoked = await fetch(api + "/api/v1/events", { headers: { apikey: writer.token } });
  const ending = frames(revoked, () => false, 5000);
  await new Promise(done => setTimeout(done, 100));
  await server.auth.revoke(writer.clientId);
  const closed = await ending;
  assert.equal(closed.ended, true, "the stream closes at the next heartbeat after revocation");
  assert.equal((await fetch(api + "/api/v1/events", { headers: { apikey: writer.token } })).status, 401);
}));

test("event stream: origin allow-list and stream cap", async () => withServer(async (server, api) => {
  const token = await server.auth.issue("reader", ["read"]);
  assert.equal((await fetch(api + "/api/v1/events", { headers: { apikey: token.token, Origin: "https://evil.example" } })).status, 403);
  const opened = [];
  try {
    for (let n = 0; n < 20; n++) {
      const response = await fetch(api + "/api/v1/events", { headers: { apikey: token.token } });
      assert.equal(response.status, 200); opened.push(response);
    }
    const extra = await fetch(api + "/api/v1/events", { headers: { apikey: token.token } });
    assert.equal(extra.status, 429);
  } finally { for (const response of opened) await response.body.cancel().catch(() => undefined); }
}));
