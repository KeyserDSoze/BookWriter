import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { encryptLocal } from "./crypto";
import { saveSettings } from "./db";
import {
  acquireWriterLease, assertWriterLease, inspectWriterLease,
  recoverExpiredWriterLease, LEASE_TAKEOVER_GRACE_MS,
  releaseWriterLease, renewWriterLease,
  RemoteWriterBusy, RemoteWriterLost,
} from "./github-lease";

const TOKEN = "github_pat_test_lease_not_real_2026";
const MAIN = "a".repeat(40);
const TREE = "b".repeat(40);
const remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
const jsonResponse = (body: unknown, status = 200,
  reset: string | null = String(Math.floor((Date.now()+30*60_000)/1000))) =>
  new Response(JSON.stringify(body), { status,
    headers: reset===null?{}:{"X-RateLimit-Reset":reset} });

function githubServer(resetHeader:()=>string|null=()=>
  String(Math.floor((Date.now()+30*60_000)/1000))) {
  const reply=(body:unknown,status=200)=>
    jsonResponse(body,status,resetHeader());
  const lockRefs = new Map<string, string>();
  const trees = new Map<string, string>([[TREE, ""]]);
  const commits = new Map<string, { parent: string | null; tree: string }>(
    [[MAIN, { parent: null, tree: TREE }]],
  );
  const calls: Array<{ method: string; path: string; body: unknown; token: string }> = [];
  let patchFailure: "none" | "http409" | "network_before" | "network_after" = "none";
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
      return reply({ object: { sha: MAIN } });
    if (method === "GET" && path.startsWith(refPath)) {
      const found = lockRefs.get("bookwriter-lock/" + path.slice(refPath.length));
      return found ? reply({ object: { sha: found } }) : reply({ message: "Not Found" }, 404);
    }
    if (method === "GET" && path.startsWith("/git/commits/")) {
      const commit = commits.get(path.slice("/git/commits/".length));
      return commit ? reply({ tree: { sha: commit.tree } }) : reply({}, 404);
    }
    if (method === "POST" && path === "/git/trees") {
      const payload = body as { tree: Array<{ content?: string }> };
      const id = sha();
      trees.set(id, payload.tree[0]?.content ?? "");
      return reply({ sha: id }, 201);
    }
    if (method === "POST" && path === "/git/commits") {
      const payload = body as { tree: string; parents: string[] };
      const id = sha();
      commits.set(id, { parent: payload.parents[0] ?? null, tree: payload.tree });
      return reply({ sha: id }, 201);
    }
    if (method === "POST" && path === "/git/refs") {
      const payload = body as { ref: string; sha: string };
      const key = payload.ref.replace("refs/heads/", "");
      if (lockRefs.has(key)) return reply({ message: "already exists" }, 422);
      lockRefs.set(key, payload.sha);
      return reply({ object: { sha: payload.sha } }, 201);
    }
    if (method === "PATCH" && path.startsWith("/git/refs/heads/")) {
      const key = path.slice("/git/refs/heads/".length);
      const payload = body as { sha: string; force: boolean };
      expect(payload.force).toBe(false);
      const head = lockRefs.get(key);
      if (commits.get(payload.sha)?.parent !== head)
        return reply({ message: "non fast forward" }, 409);
      const failure = patchFailure;
      patchFailure = "none";
      if (failure === "http409") return reply({ message: "non fast forward" }, 409);
      if (failure === "network_before") throw new TypeError("simulated lost request");
      lockRefs.set(key, payload.sha);
      if (failure === "network_after") throw new TypeError("simulated lost response");
      return reply({ object: { sha: payload.sha } });
    }
    if (method === "GET" && path === filename) {
      const id = url.searchParams.get("ref") ?? "";
      const text = trees.get(commits.get(id)?.tree ?? "");
      return text ? reply({
        type: "file", encoding: "base64", content: btoa(text),
      }) : reply({ message: "Not Found" }, 404);
    }
    return reply({ message: "unexpected " + method + " " + path }, 500);
  }));
  return {
    calls,
    failNextPatch(mode: "http409" | "network_before" | "network_after") {
      patchFailure = mode;
    },
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
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });

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
    const bodies = JSON.stringify(server.calls.filter(c => c.method === "POST").map(c => c.body));
    expect(bodies).not.toContain(TOKEN);
    expect(bodies).not.toContain("headSha");
  });

  it.each(["http409", "network_before"] as const)(
    "non confonde un rinnovo %s con un lease precedente ancora attivo",
    async failure => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      const initialHead = first.headSha;
      server.failNextPatch(failure);

      await expect(renewWriterLease(first))
        .rejects.toThrow(/Rinnovo del lease GitHub non confermato/);
      expect((await inspectWriterLease(remote, bookId))?.headSha).toBe(initialHead);
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
      expect(server.calls.filter(call => call.method === "PATCH").every(call =>
        (call.body as Record<string, unknown>)?.force === false)).toBe(true);
      // The in-memory mock intentionally records Authorization headers; only
      // GitHub paths and persisted request bodies must remain token-free.
      expect(JSON.stringify(server.calls.map(({ path, method, body }) =>
        ({ path, method, body })))).not.toContain(TOKEN);
    },
  );

  it("riconosce il commit esatto se l'ACK del PATCH si perde dopo l'applicazione", async () => {
    const server = githubServer();
    const bookId = crypto.randomUUID();
    const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
    server.failNextPatch("network_after");

    const renewed = await renewWriterLease(first);
    expect(renewed.headSha).not.toBe(first.headSha);
    expect(renewed.sessionId).toBe(first.sessionId);
    expect((await inspectWriterLease(remote, bookId))?.headSha).toBe(renewed.headSha);
    expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
    expect(server.calls.filter(call => call.method === "PATCH").every(call =>
      (call.body as Record<string, unknown>)?.force === false)).toBe(true);
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

  it("rifiuta clock locale avanti di 24 ore prima del takeover e di qualunque commit",async()=>{
    const actual=Date.now();
    const reset=String(Math.floor((actual+30*60_000)/1000));
    const server=githubServer(()=>reset);
    const bookId=crypto.randomUUID();
    const original=await acquireWriterLease(remote,bookId,crypto.randomUUID());
    vi.spyOn(Date,"now").mockReturnValue(actual+24*60*60_000);
    await expect(inspectWriterLease(remote,bookId))
      .rejects.toThrow(/orologio del dispositivo/);
    await expect(acquireWriterLease(remote,bookId,crypto.randomUUID(),true))
      .rejects.toThrow(/orologio del dispositivo/);
    await expect(recoverExpiredWriterLease(remote,bookId))
      .rejects.toThrow(/orologio del dispositivo/);
    await expect(assertWriterLease(original))
      .rejects.toBeInstanceOf(RemoteWriterLost);
    expect(server.calls.filter(c=>c.method==="PATCH")).toHaveLength(0);
  });

  it("rifiuta clock locale indietro di 24 ore prima del rinnovo, anche con sessione proprietaria",async()=>{
    const actual=Date.now();
    const reset=String(Math.floor((actual+30*60_000)/1000));
    const server=githubServer(()=>reset);
    const bookId=crypto.randomUUID();
    const original=await acquireWriterLease(remote,bookId,crypto.randomUUID());
    vi.spyOn(Date,"now").mockReturnValue(actual-24*60*60_000);
    await expect(renewWriterLease(original))
      .rejects.toThrow(/orologio del dispositivo/);
    await expect(acquireWriterLease(remote,bookId,crypto.randomUUID()))
      .rejects.toThrow(/orologio del dispositivo/);
    expect(server.calls.filter(c=>c.method==="PATCH")).toHaveLength(0);
  });

  it("non dipende dall'header Date nascosto dal CORS: usa X-RateLimit-Reset quando plausibile",async()=>{
    const server=githubServer();
    const bookId=crypto.randomUUID();
    const original=await acquireWriterLease(remote,bookId,crypto.randomUUID());
    expect((await assertWriterLease(original)).sessionId).toBe(original.sessionId);
    await releaseWriterLease(original);
    expect((await inspectWriterLease(remote,bookId))?.state).toBe("released");
    expect(server.calls.some(c=>c.method==="PATCH")).toBe(true);
  });

  it("fail-closed senza X-RateLimit-Reset o con valore non valido, anche sul lease esistente",async()=>{
    let reset:string|null=String(Math.floor((Date.now()+30*60_000)/1000));
    const server=githubServer(()=>reset);
    const bookId=crypto.randomUUID();
    const original=await acquireWriterLease(remote,bookId,crypto.randomUUID());
    reset=null;
    await expect(inspectWriterLease(remote,bookId))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    await expect(renewWriterLease(original))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    await expect(acquireWriterLease(remote,bookId,crypto.randomUUID(),true))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    reset="not-a-number";
    await expect(inspectWriterLease(remote,bookId))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    expect(server.calls.filter(c=>c.method==="PATCH")).toHaveLength(0);
    await expect(acquireWriterLease(remote,crypto.randomUUID(),crypto.randomUUID()))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
  });

  it("valida il clock anche per il 404 di branch assente, prima di qualunque scrittura", async () => {
    const actual = Date.now();
    const plausibleReset = String(Math.floor((actual + 30 * 60_000) / 1000));
    let reset: string | null = null;
    const server = githubServer(() => reset);
    const bookId = crypto.randomUUID();

    await expect(inspectWriterLease(remote, bookId))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    await expect(acquireWriterLease(remote, bookId, crypto.randomUUID()))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    expect(server.calls.map(call => call.method)).toEqual(["GET", "GET"]);
    expect(server.calls.every(call => call.path.includes("/git/ref/heads/bookwriter-lock/")))
      .toBe(true);

    reset = "invalid";
    await expect(inspectWriterLease(remote, bookId))
      .rejects.toThrow(/X-RateLimit-Reset valido/);
    reset = plausibleReset;
    const clock = vi.spyOn(Date, "now").mockReturnValue(actual + 24 * 60 * 60_000);
    await expect(inspectWriterLease(remote, bookId))
      .rejects.toThrow(/orologio del dispositivo/);
    await expect(acquireWriterLease(remote, bookId, crypto.randomUUID()))
      .rejects.toThrow(/orologio del dispositivo/);
    expect(server.calls.every(call => call.method === "GET")).toBe(true);

    clock.mockRestore();
    expect(await inspectWriterLease(remote, bookId)).toBeNull();
    const acquired = await acquireWriterLease(remote, bookId, crypto.randomUUID());
    expect(acquired.bookId).toBe(bookId);
    expect(server.calls.some(call => call.method === "POST")).toBe(true);
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
