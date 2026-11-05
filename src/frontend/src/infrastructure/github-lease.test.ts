import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { encryptLocal } from "./crypto";
import { saveSettings } from "./db";
import {
  acquireWriterLease, assertWriterLease, inspectWriterLease,
  LEASE_TAKEOVER_GRACE_MS, releaseWriterLease, renewWriterLease,
  RemoteWriterBusy, RemoteWriterLost,
} from "./github-lease";

const TOKEN = "github_pat_test_lease_not_real_2026";
const MAIN = "a".repeat(40);
const TREE = "b".repeat(40);
const remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function githubServer() {
  const lockRefs = new Map<string, string>();
  const trees = new Map<string, string>([[TREE, ""]]);
  const commits = new Map<string, { parent: string | null; tree: string }>(
    [[MAIN, { parent: null, tree: TREE }]],
  );
  const calls: Array<{ method: string; path: string; body: unknown; token: string }> = [];
  let counter = 1;
  const sha = () => (counter++).toString(16).padStart(40, "0");
  const filename = "/contents/.bookwriter/lease.json";
  const refPath = "/git/ref/heads/bookwriter-lock/";
  vi.stubGlobal("fetch", vi.fn(async (requestUrl: string | URL, init?: RequestInit) => {
    const url = new URL(String(requestUrl));
    const path = url.pathname.replace(/^\/repos\/test-owner\/book-repo/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ path, method, body, token: new Headers(init?.headers).get("Authorization") ?? "" });
    expect(url.origin).toBe("https://api.github.com");
    expect(init?.redirect).toBe("error");
    if (method === "GET" && path === "/git/ref/heads/main")
      return jsonResponse({ object: { sha: MAIN } });
    if (method === "GET" && path.startsWith(refPath)) {
      const found = lockRefs.get(path.slice(refPath.length));
      return found ? jsonResponse({ object: { sha: found } }) : jsonResponse({ message: "Not Found" }, 404);
    }
    if (method === "GET" && path.startsWith("/git/commits/")) {
      const commit = commits.get(path.slice("/git/commits/".length));
      return commit ? jsonResponse({ tree: { sha: commit.tree } }) : jsonResponse({}, 404);
    }
    if (method === "POST" && path === "/git/trees") {
      const payload = body as { tree: Array<{ content?: string }> };
      const id = sha();
      trees.set(id, payload.tree[0]?.content ?? "");
      return jsonResponse({ sha: id }, 201);
    }
    if (method === "POST" && path === "/git/commits") {
      const payload = body as { tree: string; parents: string[] };
      const id = sha();
      commits.set(id, { parent: payload.parents[0] ?? null, tree: payload.tree });
      return jsonResponse({ sha: id }, 201);
    }
    if (method === "POST" && path === "/git/refs") {
      const payload = body as { ref: string; sha: string };
      const key = payload.ref.replace("refs/heads/", "");
      if (lockRefs.has(key)) return jsonResponse({ message: "already exists" }, 422);
      lockRefs.set(key, payload.sha);
      return jsonResponse({ object: { sha: payload.sha } }, 201);
    }
    if (method === "PATCH" && path.startsWith("/git/refs/heads/")) {
      const key = path.slice("/git/refs/heads/".length);
      const payload = body as { sha: string; force: boolean };
      expect(payload.force).toBe(false);
      const head = lockRefs.get(key);
      if (commits.get(payload.sha)?.parent !== head)
        return jsonResponse({ message: "non fast forward" }, 409);
      lockRefs.set(key, payload.sha);
      return jsonResponse({ object: { sha: payload.sha } });
    }
    if (method === "GET" && path === filename) {
      const id = url.searchParams.get("ref") ?? "";
      const text = trees.get(commits.get(id)?.tree ?? "");
      return text ? jsonResponse({
        type: "file", encoding: "base64", content: btoa(text),
      }) : jsonResponse({ message: "Not Found" }, 404);
    }
    return jsonResponse({ message: "unexpected " + method + " " + path }, 500);
  }));
  return {
    calls,
    expireLock(bookId: string) {
      const id = lockRefs.get("bookwriter-lock/" + bookId)!;
      const commit = commits.get(id)!;
      const original = JSON.parse(trees.get(commit.tree)!) as Record<string, string>;
      original.expiresAt = new Date(Date.now() - LEASE_TAKEOVER_GRACE_MS - 60_000).toISOString();
      trees.set(commit.tree, JSON.stringify(original));
    },
  };
}
beforeEach(async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.githubToken = await encryptLocal(TOKEN);
  await saveSettings(settings);
});
afterEach(() => vi.unstubAllGlobals());

describe("Lease distribuito GitHub (branch fast-forward only)", () => {
  it("impedisce due autopilot simultanei; rinnova e rilascia senza force push", async () => {
    const server = githubServer();
    const bookId = newBook("Una trama", "Il libro", "", "").id;
    const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
    const other = crypto.randomUUID();
    await expect(acquireWriterLease(remote, bookId, other)).rejects.toBeInstanceOf(RemoteWriterBusy);
    const refreshed = await renewWriterLease(first);
    expect(refreshed.sessionId).toBe(first.sessionId);
    expect((await assertWriterLease(refreshed)).sessionId).toBe(first.sessionId);
    await releaseWriterLease(refreshed);
    const second = await acquireWriterLease(remote, bookId, other);
    expect(second.sessionId).toBe(other);
    await expect(assertWriterLease(first)).rejects.toBeInstanceOf(RemoteWriterLost);
    expect(server.calls.filter(c => c.method === "PATCH").every(c =>
      (c.body as Record<string, unknown>)?.force === false)).toBe(true);
    const bodies = JSON.stringify(server.calls.filter(c => c.method === "POST"));
    expect(bodies).not.toContain(TOKEN);
  });

  it("conserva il lease scaduto finché l'autore non richiede takeover esplicito", async () => {
    const server = githubServer();
    const bookId = crypto.randomUUID();
    const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
    server.expireLock(bookId);
    const secondId = crypto.randomUUID();
    await expect(acquireWriterLease(remote, bookId, secondId)).rejects.toMatchObject({
      canTakeover: true,
    });
    const second = await acquireWriterLease(remote, bookId, secondId, true);
    expect(second.sessionId).toBe(secondId);
    await expect(assertWriterLease(first)).rejects.toBeInstanceOf(RemoteWriterLost);
  });

  it("non cede a due richieste concorrenti il medesimo lease", async () => {
    githubServer();
    const bookId = crypto.randomUUID();
    const results = await Promise.allSettled([
      acquireWriterLease(remote, bookId, crypto.randomUUID()),
      acquireWriterLease(remote, bookId, crypto.randomUUID()),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await inspectWriterLease(remote, bookId))?.state).toBe("active");
  });
});
