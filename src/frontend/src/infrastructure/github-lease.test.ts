import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { encryptLocal } from "./crypto";
import { saveSettings } from "./db";
import { rememberWriterSession } from "./writer-sessions";
import {
  acquireWriterLease, assertWriterLease, inspectWriterLease, isLeaseFromThisBrowser,
  LeaseGitHubUnavailable, LeaseRenewalMissed, leaseTuning,
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
  // GitHub reads that lag behind a write: the ref keeps showing its previous commit for a few reads.
  const previousHeads = new Map<string, string>();
  let staleConfigured = 0, staleKey: string | undefined, staleLeft = 0;
  let foreignAfterPatch = false;
  // GitHub that does not answer (network) or fails with a 5xx for a given kind of request, a given number of times.
  const injected: Array<{ match: (method: string, path: string) => boolean; left: number; mode: "http500" | "network" }> = [];
  let createFailure: "none" | "http422" | "network_before" | "network_after" = "none";
  let treeFailure = false;
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
    const hit = injected.find(rule => rule.left > 0 && rule.match(method, path));
    if (hit) {
      hit.left--;
      if (hit.mode === "network") throw new TypeError("simulated network failure");
      return reply({ message: "Server Error" }, 500);
    }
    if (method === "GET" && path === "/git/ref/heads/main")
      return reply({ object: { sha: MAIN } });
    if (method === "GET" && path.startsWith(refPath)) {
      const key = "bookwriter-lock/" + path.slice(refPath.length);
      if (staleLeft > 0 && staleKey === key && previousHeads.has(key)) {
        staleLeft--;
        return reply({ object: { sha: previousHeads.get(key) } });
      }
      const found = lockRefs.get(key);
      return found ? reply({ object: { sha: found } }) : reply({ message: "Not Found" }, 404);
    }
    if (method === "GET" && path.startsWith("/git/commits/")) {
      const commit = commits.get(path.slice("/git/commits/".length));
      return commit ? reply({ tree: { sha: commit.tree } }) : reply({}, 404);
    }
    if (method === "POST" && path === "/git/trees") {
      if (treeFailure) return reply({ message: TOKEN }, 422);
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
      if (createFailure === "http422") return reply({ message: TOKEN }, 422);
      if (createFailure === "network_before") throw new TypeError(TOKEN);
      lockRefs.set(key, payload.sha);
      if (createFailure === "network_after") throw new TypeError(TOKEN);
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
      if (head) previousHeads.set(key, head);
      if (staleConfigured > 0) { staleKey = key; staleLeft = staleConfigured; staleConfigured = 0; }
      if (foreignAfterPatch) {
        // Another device wins the branch right after our write.
        foreignAfterPatch = false;
        const mine = JSON.parse(trees.get(commits.get(payload.sha)!.tree)!) as Record<string, string>;
        const treeId = sha(); trees.set(treeId, JSON.stringify({ ...mine, sessionId: crypto.randomUUID(), renewedAt: new Date().toISOString() }));
        const commitId = sha(); commits.set(commitId, { parent: payload.sha, tree: treeId });
        lockRefs.set(key, commitId);
      }
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
    failCreate(mode: typeof createFailure) { createFailure = mode; },
    /** After the next accepted write, the next `n` reads of the lock branch still show the previous commit. */
    staleReads(n: number) { staleConfigured = n; staleLeft = 0; },
    foreignWriteAfterNextPatch() { foreignAfterPatch = true; },
    failRequests(match: (method: string, path: string) => boolean, times: number, mode: "http500" | "network" = "http500") {
      injected.push({ match, left: times, mode });
    },
    clearFailures() { injected.length = 0; },
    setExpiry(bookId: string, expiresAt: string) {
      const id = lockRefs.get("bookwriter-lock/" + bookId)!;
      const commit = commits.get(id)!;
      trees.set(commit.tree, JSON.stringify({ ...JSON.parse(trees.get(commit.tree)!) as Record<string, string>, expiresAt }));
    },
    failTree() { treeFailure = true; },
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
  leaseTuning.readbackDelaysMs = [1, 1, 1]; // the real waits (0.6 s, 1.5 s, 3 s) are not needed against a mock
  leaseTuning.unavailableRetryDelaysMs = [1, 1];
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.githubToken = await encryptLocal(TOKEN);
  await saveSettings(settings);
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe("Lease distribuito GitHub (branch fast-forward only)", () => {
  it.each(["http422", "network_before"] as const)("acquisizione %s: non attribuisce a un altro browser una causa non verificata", async failure => {
    const server = githubServer();
    server.failCreate(failure);
    const bookId = crypto.randomUUID();
    const error = await acquireWriterLease(remote, bookId, crypto.randomUUID()).catch(error => error as Error);
    expect(error).toBeInstanceOf(RemoteWriterLost);
    if (!(error instanceof Error)) throw new Error("L'acquisizione doveva fallire.");
    expect(error.message).not.toContain("aggiornato da un altro browser");
    expect(error.message).not.toContain(TOKEN);
    if (failure === "http422") {
      expect(error.message).toContain("creazione del ramo");
      expect(error.message).toContain("HTTP 422");
      expect(error.message).toContain("regole GitHub");
    }
    expect(await inspectWriterLease(remote, bookId)).toBeNull();
    expect(server.calls.filter(call => call.method === "POST" && call.path === "/git/refs")).toHaveLength(1);
    expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(0);
  });

  it("conferma l'acquisizione se il POST è riuscito ma la risposta si perde: nessun secondo POST", async () => {
    const server = githubServer();
    server.failCreate("network_after");
    const bookId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const acquired = await acquireWriterLease(remote, bookId, sessionId);
    expect(acquired.sessionId).toBe(sessionId);
    expect((await inspectWriterLease(remote, bookId))?.headSha).toBe(acquired.headSha);
    expect(server.calls.filter(call => call.method === "POST" && call.path === "/git/refs")).toHaveLength(1);
  });

  it("un tree rifiutato non è un commit concorrente e non avvia un secondo tentativo", async () => {
    const server = githubServer();
    server.failTree();
    await expect(acquireWriterLease(remote, crypto.randomUUID(), crypto.randomUUID()))
      .rejects.toThrow(/preparazione dei dati.*HTTP 422/);
    expect(server.calls.filter(call => call.method !== "GET")).toHaveLength(1);
  });

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

  describe("blocco lasciato da una pagina ricaricata o chiusa", () => {
    it("lo stesso browser, che tiene il lock del libro, lo sostituisce subito con un commit fast-forward", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const before = crypto.randomUUID(), after = crypto.randomUUID();
      await rememberWriterSession(bookId, before);
      const dead = await acquireWriterLease(remote, bookId, before, false, { writerLockHeld: true });
      // F5: the page is gone, nobody released the lease, it is still valid for two minutes.
      expect((await inspectWriterLease(remote, bookId))?.state).toBe("active");
      expect(await isLeaseFromThisBrowser({ bookId, sessionId: before })).toBe(true);
      const patches = server.calls.filter(call => call.method === "PATCH").length;
      const fresh = await acquireWriterLease(remote, bookId, after, false, { writerLockHeld: true });
      expect(fresh.sessionId).toBe(after);
      expect((await inspectWriterLease(remote, bookId))).toMatchObject({ sessionId: after, state: "active" });
      const written = server.calls.filter(call => call.method === "PATCH");
      expect(written).toHaveLength(patches + 1);
      expect(written.every(call => (call.body as Record<string, unknown>).force === false)).toBe(true);
      // The page that was lost can no longer renew or confirm anything: fencing is intact.
      await expect(renewWriterLease(dead)).rejects.toBeInstanceOf(RemoteWriterLost);
      await expect(assertWriterLease(dead)).rejects.toBeInstanceOf(RemoteWriterLost);
    });
    it("senza il lock del libro nessuna sostituzione immediata, nemmeno per una sessione ricordata", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const before = crypto.randomUUID();
      await rememberWriterSession(bookId, before);
      await acquireWriterLease(remote, bookId, before);
      const patches = server.calls.filter(call => call.method === "PATCH").length;
      await expect(acquireWriterLease(remote, bookId, crypto.randomUUID())).rejects.toBeInstanceOf(RemoteWriterBusy);
      await expect(acquireWriterLease(remote, bookId, crypto.randomUUID(), false, { writerLockHeld: false })).rejects.toBeInstanceOf(RemoteWriterBusy);
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(patches);
    });
    it("il blocco di un altro dispositivo non si sostituisce mai, anche se si tiene il lock locale", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const foreign = crypto.randomUUID();
      await acquireWriterLease(remote, bookId, foreign); // another device: never remembered for this book
      const other = crypto.randomUUID();
      const error = await acquireWriterLease(remote, bookId, other, false, { writerLockHeld: true }).catch(e => e as unknown);
      expect(error).toBeInstanceOf(RemoteWriterBusy);
      expect((error as RemoteWriterBusy).canTakeover).toBe(false);
      expect((await inspectWriterLease(remote, bookId))?.sessionId).not.toBe(other);
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(0);
      // The same session remembered for ANOTHER book does not make this book's lease ours.
      await rememberWriterSession(crypto.randomUUID(), foreign);
      await expect(acquireWriterLease(remote, bookId, crypto.randomUUID(), false, { writerLockHeld: true })).rejects.toBeInstanceOf(RemoteWriterBusy);
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(0);
    });
    it("un blocco già rilasciato o ricordato in modo parziale non cambia le regole: ricordare è solo un indizio, non un permesso", async () => {
      githubServer();
      const bookId = crypto.randomUUID();
      expect(await isLeaseFromThisBrowser({ bookId, sessionId: crypto.randomUUID() })).toBe(false);
      for (let i = 0; i < 12; i++) await rememberWriterSession(bookId, crypto.randomUUID());
      const last = crypto.randomUUID();
      await rememberWriterSession(bookId, last);
      expect(await isLeaseFromThisBrowser({ bookId, sessionId: last })).toBe(true);
    });
  });

  describe("rinnovo accettato da GitHub ma rilettura del ramo diversa dal commit scritto", () => {
    const refReads = (server: ReturnType<typeof githubServer>) =>
      server.calls.filter(call => call.method === "GET" && call.path.startsWith("/git/ref/heads/bookwriter-lock/")).length;

    it("una lettura in ritardo di GitHub si risolve rileggendo: nessuna seconda scrittura, il rinnovo è confermato", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      server.staleReads(2);
      const before = refReads(server);
      const renewed = await renewWriterLease(first);
      expect(renewed.headSha).not.toBe(first.headSha);
      expect((await inspectWriterLease(remote, bookId))?.headSha).toBe(renewed.headSha);
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
      expect(refReads(server) - before).toBeGreaterThanOrEqual(4); // find the lease + 3 reads (2 stale, then the commit)
    });

    it("se la lettura resta indietro ma il blocco è ancora nostro e valido, il rinnovo non è dato per riuscito e il lavoro continua; il battito dopo funziona", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      server.staleReads(50);
      const error = await renewWriterLease(first).catch(e => e as unknown);
      expect(error).toBeInstanceOf(LeaseRenewalMissed);
      expect(error).toBeInstanceOf(RemoteWriterLost);
      const missed = error as LeaseRenewalMissed;
      expect(missed.message).toMatch(/Rinnovo del lease GitHub non confermato/);
      expect(missed.message).toMatch(/mostra ancora il commit precedente/);
      expect(missed.current.sessionId).toBe(first.sessionId);
      expect(missed.current.headSha).toBe(first.headSha); // nothing is claimed as renewed
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(1); // the write is never repeated
      server.staleReads(0);
      const next = await renewWriterLease(missed.current);
      expect(next.sessionId).toBe(first.sessionId);
      expect(server.calls.filter(call => call.method === "PATCH")).toHaveLength(2);
    });

    it("se il blocco è passato a un'altra sessione subito dopo il rinnovo è perso, senza attese, e il messaggio lo dice", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      server.foreignWriteAfterNextPatch();
      const before = refReads(server);
      const error = await renewWriterLease(first).catch(e => e as unknown);
      expect(error).toBeInstanceOf(RemoteWriterLost);
      expect(error).not.toBeInstanceOf(LeaseRenewalMissed);
      expect((error as Error).message).toMatch(/passato a un'altra sessione/);
      expect((error as Error).message).not.toContain(first.sessionId);
      expect(refReads(server) - before).toBe(2); // the renewal's own read + one readback, no retries
      await expect(assertWriterLease(first)).rejects.toBeInstanceOf(RemoteWriterLost);
    });

    it("con il blocco vicino alla scadenza una lettura in ritardo non si tollera più", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      server.setExpiry(bookId, new Date(Date.now() + 30_000).toISOString());
      server.staleReads(50);
      const error = await renewWriterLease(first).catch(e => e as unknown);
      expect(error).toBeInstanceOf(RemoteWriterLost);
      expect(error).not.toBeInstanceOf(LeaseRenewalMissed);
      expect((error as Error).message).toMatch(/Rinnovo del lease GitHub non confermato/);
    });
  });

  describe("GitHub che non risponde o risponde 500 mentre si lavora", () => {
    const commitPosts = (method: string, path: string) => method === "POST" && path === "/git/commits";
    const lockReads = (method: string, path: string) => method === "GET" && path.startsWith("/git/ref/heads/bookwriter-lock/");
    const patches = (server: ReturnType<typeof githubServer>) => server.calls.filter(call => call.method === "PATCH").length;

    it("un 500 passeggero sul commit del rinnovo si ripete (nessun ramo toccato) e il rinnovo riesce", async () => {
      const server = githubServer();
      const first = await acquireWriterLease(remote, crypto.randomUUID(), crypto.randomUUID());
      const before = patches(server);
      server.failRequests(commitPosts, 1);
      const renewed = await renewWriterLease(first);
      expect(renewed.headSha).not.toBe(first.headSha);
      expect(patches(server) - before).toBe(1); // the branch is updated once
    });

    it.each(["http500", "network"] as const)("se GitHub resta indisponibile (%s) il rinnovo non è dato per riuscito ma il lavoro non si ferma: nessuna scrittura sul ramo", async mode => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      const before = patches(server);
      server.failRequests(commitPosts, 99, mode);
      const error = await renewWriterLease(first).catch(e => e as unknown);
      expect(error).toBeInstanceOf(LeaseRenewalMissed);
      const missed = error as LeaseRenewalMissed;
      expect(missed.message).toMatch(/GitHub non risponde/);
      expect(missed.message).toMatch(/Nulla è stato scritto/);
      expect(missed.current).toEqual(first); // same handle, same old expiry: nothing claimed as renewed
      expect(patches(server)).toBe(before);
      server.clearFailures(); // GitHub is back: the next beat renews normally
      const next = await renewWriterLease(missed.current);
      expect(next.headSha).not.toBe(first.headSha);
      expect(patches(server) - before).toBe(1);
    });

    it("con il blocco vicino alla scadenza un GitHub che non risponde ferma il lavoro", async () => {
      const server = githubServer();
      const first = await acquireWriterLease(remote, crypto.randomUUID(), crypto.randomUUID());
      server.failRequests(commitPosts, 99);
      const nearExpiry = { ...first, expiresAt: new Date(Date.now() + 30_000).toISOString() };
      const error = await renewWriterLease(nearExpiry).catch(e => e as unknown);
      expect(error).toBeInstanceOf(LeaseGitHubUnavailable);
      expect(error).not.toBeInstanceOf(LeaseRenewalMissed);
      expect((error as Error).message).toMatch(/HTTP 500/);
    });

    it("un rifiuto vero (409/422) o un clock sbagliato non vengono mai tollerati", async () => {
      const server = githubServer();
      const first = await acquireWriterLease(remote, crypto.randomUUID(), crypto.randomUUID());
      server.failNextPatch("http409");
      const error = await renewWriterLease(first).catch(e => e as unknown);
      expect(error).toBeInstanceOf(RemoteWriterLost);
      expect(error).not.toBeInstanceOf(LeaseRenewalMissed);
    });

    it("il controllo dopo la chiamata AI non butta via il risultato per un 500 passeggero", async () => {
      const server = githubServer();
      const first = await acquireWriterLease(remote, crypto.randomUUID(), crypto.randomUUID());
      server.failRequests(lockReads, 1);
      const verified = await assertWriterLease(first);
      expect(verified.sessionId).toBe(first.sessionId);
    });

    it("…e se GitHub resta giù lo accetta solo finché il blocco già confermato è valido; poi no", async () => {
      const server = githubServer();
      const first = await acquireWriterLease(remote, crypto.randomUUID(), crypto.randomUUID());
      server.failRequests(lockReads, 99, "network");
      expect(await assertWriterLease(first)).toEqual(first); // ours and valid for ~2 minutes: nobody can have taken over
      const nearExpiry = { ...first, expiresAt: new Date(Date.now() + 30_000).toISOString() };
      await expect(assertWriterLease(nearExpiry)).rejects.toBeInstanceOf(LeaseGitHubUnavailable);
      const expired = { ...first, expiresAt: new Date(Date.now() - 1_000).toISOString() };
      await expect(assertWriterLease(expired)).rejects.toBeInstanceOf(RemoteWriterLost);
    });

    it("un blocco passato a un altro non è mai confuso con un GitHub che non risponde", async () => {
      const server = githubServer();
      const bookId = crypto.randomUUID();
      const first = await acquireWriterLease(remote, bookId, crypto.randomUUID());
      server.setExpiry(bookId, new Date(Date.now() - 200_000).toISOString());
      const other = crypto.randomUUID();
      await recoverExpiredWriterLease(remote, bookId); // human recovery: the lease is released
      await acquireWriterLease(remote, bookId, other);
      await expect(assertWriterLease(first)).rejects.toBeInstanceOf(RemoteWriterLost);
    });
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
