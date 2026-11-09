import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptLocal } from "./crypto";
import { getBook, saveBook, saveSettings } from "./db";
import { getOutbox } from "./outbox";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { importGitHubBook, pushGitHubBook, RemoteConflict, validateRemote, verifyPublishedManualPush } from "./github-sync";

const BEFORE = "a".repeat(40);
const TREE = "b".repeat(40);
const NEXT_TREE = "c".repeat(40);
const NEXT = "d".repeat(40);
const TOKEN = "github_pat_mock_token_not_real_999";

function reply(content: unknown, status = 200): Response {
  return new Response(JSON.stringify(content), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function fakeGitHub(options: {
  isPrivate?: boolean; head?: string;
  patchResponseSha?: string | null;
  applyPatch?: boolean; headAfterPatch?: string; failHeadReadback?: boolean;
  patchOutcome?: "network-after" | "network-before" | "http-500-after" | "http-409";
  markerMismatch?: "operation" | "book" | "revision" | "message" | "missing";
} = {}) {
  const calls: Array<{ path: string; method: string; body: unknown; headers: Headers }> = [];
  let head = options.head ?? BEFORE;
  let patched = false;
  let marker: { operationId: string; bookId: string; sourceRevision: string } | undefined;
  const fetchMock = vi.fn(async (url: string | URL, request?: RequestInit): Promise<Response> => {
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    const method = request?.method ?? "GET";
    const body = request?.body ? JSON.parse(String(request.body)) as unknown : undefined;
    calls.push({ path, method, body, headers: new Headers(request?.headers) });
    expect(parsed.origin).toBe("https://api.github.com");
    expect(request?.redirect).toBe("error");
    if (path === "/repos/test-owner/book-repo" && method === "GET")
      return reply({ private: options.isPrivate ?? true, permissions: { push: true } });
    if (path.endsWith("/git/ref/heads/main") && method === "GET") {
      if (patched && options.failHeadReadback)
        throw new Error("Connessione interrotta durante la conferma HEAD");
      return reply({ object: { sha: head } });
    }
    if (path.includes("/contents/.bookwriter/sync.json") && method === "GET") {
      if (!marker || options.markerMismatch === "missing")
        return reply({ message: "Not Found" }, 404);
      const published = { ...marker };
      if (options.markerMismatch === "operation") published.operationId = crypto.randomUUID();
      if (options.markerMismatch === "book") published.bookId = crypto.randomUUID();
      if (options.markerMismatch === "revision") published.sourceRevision = "stale source";
      return reply({ type: "file", encoding: "base64",
        content: btoa(JSON.stringify(published)) });
    }
    if (path.includes("/contents/") && method === "GET")
      return reply({ message: "Not Found" }, 404);
    if (path.endsWith("/git/commits/" + (options.head ?? BEFORE)) && method === "GET")
      return reply({ tree: { sha: TREE } });
    if (path.endsWith("/git/trees") && method === "POST") {
      const files = (body as {
        tree: Array<{ path: string; content?: string }>
      }).tree;
      const content = files.find(f => f.path === ".bookwriter/sync.json")?.content;
      if (content) marker = JSON.parse(content) as typeof marker;
      return reply({ sha: NEXT_TREE }, 201);
    }
    if (path.endsWith("/git/commits/" + NEXT) && method === "GET")
      return reply({ message: options.markerMismatch === "message"
        ? "commit non riconosciuto" : "bookwriter: sync " + marker?.operationId });
    if (path.endsWith("/git/commits") && method === "POST")
      return reply({ sha: NEXT }, 201);
    if (path.endsWith("/git/refs/heads/main") && method === "PATCH") {
      patched = true;
      if (options.patchOutcome === "http-409") return reply({ message: "Conflict" }, 409);
      if (options.patchOutcome !== "network-before" && options.applyPatch !== false)
        head = options.headAfterPatch ?? NEXT;
      if (options.patchOutcome === "network-after" || options.patchOutcome === "network-before")
        throw new TypeError("Simulated dropped PATCH response");
      if (options.patchOutcome === "http-500-after")
        return reply({ message: "Simulated failure after commit" }, 503);
      return reply({ object: options.patchResponseSha === null
        ? {} : { sha: options.patchResponseSha ?? NEXT } });
    }
    return reply({ message: "Unexpected mock request" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function sampleBook() {
  const book = newBook("Una trama originale", "Libro GitHub", "Rigoroso", "Adulti");
  book.remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
  await saveBook(book);
  return book;
}

describe("GitHub sync conservativa", () => {
  beforeEach(async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.githubToken = await encryptLocal(TOKEN);
    await saveSettings(settings);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("crea un commit Git multi-file senza PAT, senza force e salva la baseline", async () => {
    const book = await sampleBook();
    const { calls } = fakeGitHub();
    const result = await pushGitHubBook(book.id);
    expect(result.commit).toBe(NEXT);
    const treeCall = calls.find(c => c.path.endsWith("/git/trees") && c.method === "POST");
    expect(treeCall).toBeDefined();
    const payload = JSON.stringify(treeCall?.body);
    expect(payload).toContain(".bookwriter/project.json");
    expect(payload).toContain("book.md");
    expect(payload).not.toContain(TOKEN);
    const patched = calls.find(c => c.method === "PATCH");
    expect(patched?.body).toMatchObject({ sha: NEXT, force: false });
    for (const call of calls) expect(call.headers.get("Authorization")).toBe("Bearer " + TOKEN);
    const updated = await getBook(book.id);
    expect(updated?.remote?.lastSyncedCommit).toBe(NEXT);
    const headReads = calls.filter(c => c.path.endsWith("/git/ref/heads/main") && c.method === "GET");
    expect(headReads).toHaveLength(3); // baseline, pre-write, post-PATCH readback
  });

  it("rifiuta una risposta PATCH HTTP 2xx con SHA errato senza confermare libro o outbox", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const beforeBook = await getBook(book.id);
    const beforeQueue = await getOutbox(book.id);
    const { calls } = fakeGitHub({ patchResponseSha: "e".repeat(40) });

    await expect(pushGitHubBook(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    expect(await getBook(book.id)).toEqual(beforeBook);
    expect(await getOutbox(book.id)).toEqual(beforeQueue);
  });

  it("rifiuta una risposta PATCH senza SHA anche se HTTP 2xx", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const beforeQueue = await getOutbox(book.id);
    fakeGitHub({ patchResponseSha: null });

    await expect(pushGitHubBook(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBeUndefined();
    expect(await getOutbox(book.id)).toEqual(beforeQueue);
  });

  it("non attesta il commit se il PATCH 2xx non muove realmente la HEAD", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const beforeBook = await getBook(book.id);
    const beforeQueue = await getOutbox(book.id);
    const { calls } = fakeGitHub({ applyPatch: false });

    await expect(pushGitHubBook(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    expect(calls.filter(c => c.method === "GET" && c.path.endsWith("/git/ref/heads/main"))).toHaveLength(3);
    expect(await getBook(book.id)).toEqual(beforeBook);
    expect(await getOutbox(book.id)).toEqual(beforeQueue);
  });

  it("rifiuta una HEAD diventata diversa subito dopo il PATCH", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const before = await getOutbox(book.id);
    fakeGitHub({ headAfterPatch: "f".repeat(40) });

    await expect(pushGitHubBook(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBeUndefined();
    expect(await getOutbox(book.id)).toEqual(before);
  });

  it("non considera sincronizzato il libro se la verifica HEAD perde la rete", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const beforeBook = await getBook(book.id);
    const beforeQueue = await getOutbox(book.id);
    fakeGitHub({ failHeadReadback: true });

    await expect(pushGitHubBook(book.id)).rejects.toThrow(/GitHub non raggiungibile/);
    expect(await getBook(book.id)).toEqual(beforeBook);
    expect(await getOutbox(book.id)).toEqual(beforeQueue);
  });

  it("recupera subito il push manuale se la risposta PATCH si perde dopo l'applicazione", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const revision = book.updatedAt;
    const { calls } = fakeGitHub({ patchOutcome: "network-after" });

    const result = await pushGitHubBook(book.id);
    expect(result).toMatchObject({ commit: NEXT, recovered: true, sourceRevision: revision });
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    expect(calls.filter(c => c.method === "POST" && c.path.endsWith("/git/commits"))).toHaveLength(1);
    expect(calls.some(c => c.path.includes("/contents/.bookwriter/sync.json"))).toBe(true);
    const latest = (await getBook(book.id))!;
    expect(latest.remote).toMatchObject({
      lastSyncedCommit: NEXT, lastSyncedLocalUpdatedAt: revision,
    });
    expect(latest.updatedAt).toBe(revision);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("recupera anche un HTTP 503 dopo che GitHub ha applicato il commit", async () => {
    const book = await sampleBook();
    const { calls } = fakeGitHub({ patchOutcome: "http-500-after" });
    const result = await pushGitHubBook(book.id);
    expect(result.recovered).toBe(true);
    expect(result.commit).toBe(NEXT);
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
  });

  it("non attesta la risposta PATCH persa prima dell'applicazione", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const beforeBook = await getBook(book.id);
    const beforeQueue = await getOutbox(book.id);
    const { calls } = fakeGitHub({ patchOutcome: "network-before" });

    await expect(pushGitHubBook(book.id)).rejects.toThrow(/GitHub non raggiungibile/);
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    expect(calls.filter(c => c.method === "GET" && c.path.endsWith("/git/ref/heads/main")))
      .toHaveLength(3);
    expect(await getBook(book.id)).toEqual(beforeBook);
    expect(await getOutbox(book.id)).toEqual(beforeQueue);
  });

  it("non attesta una HEAD modificata da terzi dopo la perdita dell'ACK", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const before = await getOutbox(book.id);
    const { calls } = fakeGitHub({
      patchOutcome: "network-after", headAfterPatch: "f".repeat(40),
    });
    await expect(pushGitHubBook(book.id)).rejects.toThrow(/GitHub non raggiungibile/);
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBeUndefined();
    expect(await getOutbox(book.id)).toEqual(before);
  });

  it.each(["operation", "book", "revision", "message", "missing"] as const)(
    "non recupera un commit con marker remoto non verificabile: %s", async markerMismatch => {
      const book = await sampleBook();
      book.remote!.autoSync = true;
      await saveBook(book);
      const before = await getBook(book.id);
      const beforeQueue = await getOutbox(book.id);
      const { calls } = fakeGitHub({ patchOutcome: "network-after", markerMismatch });
      await expect(pushGitHubBook(book.id)).rejects.toThrow(/GitHub non raggiungibile/);
      expect(await getBook(book.id)).toEqual(before);
      expect(await getOutbox(book.id)).toEqual(beforeQueue);
      expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    },
  );

  it("non attesta l'ACK perso se la rilettura della HEAD è irraggiungibile", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const before = await getOutbox(book.id);
    const { calls } = fakeGitHub({
      patchOutcome: "network-after", failHeadReadback: true,
    });
    await expect(pushGitHubBook(book.id)).rejects.toThrow(/GitHub non raggiungibile/);
    expect(await getOutbox(book.id)).toEqual(before);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBeUndefined();
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
  });

  it("non usa il recovery su rifiuto HTTP 409 e non ripete PATCH", async () => {
    const book = await sampleBook();
    book.remote!.autoSync = true;
    await saveBook(book);
    const before = await getOutbox(book.id);
    const { calls } = fakeGitHub({ patchOutcome: "http-409" });
    await expect(pushGitHubBook(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect(await getOutbox(book.id)).toEqual(before);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBeUndefined();
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    expect(calls.filter(c => c.method === "GET" && c.path.endsWith("/git/ref/heads/main")))
      .toHaveLength(2);
  });

  it("blocca il push manuale e automatico finché le scene fuse non sono state approvate", async () => {
    const book = await sampleBook();
    book.editorialReviewSceneIds = ["scene-needs-review"];
    book.remote!.autoSync = true;
    await saveBook(book, false);
    const { calls } = fakeGitHub();
    await expect(pushGitHubBook(book.id)).rejects.toThrow(/conferma nel Lettore/);
    await expect(pushGitHubBook(book.id, false, { automatic: true, operationId: crypto.randomUUID() }))
      .rejects.toThrow(/conferma nel Lettore/);
    expect(calls).toHaveLength(0);
  });

  it("ferma il sync se il branch si è spostato dopo l'ultimo commit", async () => {
    const book = await sampleBook();
    book.remote!.lastSyncedCommit = "e".repeat(40);
    await saveBook(book);
    const { calls } = fakeGitHub();
    await expect(pushGitHubBook(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect(calls.some(call => call.method === "POST" || call.method === "PATCH")).toBe(false);
  });

  it("blocca pubblicazione involontaria dei segreti nelle repository pubbliche", async () => {
    const book = await sampleBook();
    const { calls } = fakeGitHub({ isPrivate: false });
    await expect(pushGitHubBook(book.id)).rejects.toThrow(/PUBBLICA/);
    expect(calls.some(call => call.method === "POST")).toBe(false);
  });

  it("importa uno snapshot GitHub come nuovo libro senza modificare quelli esistenti", async () => {
    const remoteBook = newBook("Trama remota", "Un libro trovato su GitHub", "Realista", "Adulti");
    const source = JSON.stringify(remoteBook);
    const fake = vi.fn(async (url: string | URL, request?: RequestInit): Promise<Response> => {
      const u = new URL(String(url));
      expect(u.origin).toBe("https://api.github.com");
      const path = u.pathname;
      if (path.endsWith("/git/ref/heads/main")) return reply({ object: { sha: BEFORE } });
      if (path.endsWith("/contents/.bookwriter/project.json"))
        return reply({ type: "file", encoding: "base64", content: btoa(source) });
      if (path.endsWith("/contents/.bookwriter/activities.json"))
        return reply({ type: "file", encoding: "base64", content: btoa("[]") });
      return reply({ message: "not mocked" }, 500);
    });
    vi.stubGlobal("fetch", fake);
    const remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
    const result = await importGitHubBook(remote);
    expect(result.id).toBe(remoteBook.id);
    expect(result.remote?.lastSyncedCommit).toBe(BEFORE);
    expect((await getBook(remoteBook.id))?.title).toBe("Un libro trovato su GitHub");
    await expect(importGitHubBook(remote)).rejects.toBeInstanceOf(RemoteConflict);
    expect(fake).toHaveBeenCalled();
  });


  it("riconosce un commit remoto già riuscito quando il browser ha perso la risposta", async () => {
    const book = await sampleBook();
    book.remote!.lastSyncedCommit = BEFORE;
    book.remote!.autoSync = true;
    await saveBook(book);
    const queuedBeforeRecovery = await getOutbox(book.id);
    const operationId = crypto.randomUUID();
    const remoteRevision = "2026-11-05T13:00:00.123Z";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, request?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push((request?.method ?? "GET") + " " + path);
      if (path === "/repos/test-owner/book-repo")
        return reply({ private: true, permissions: { push: true } });
      if (path.endsWith("/git/ref/heads/main"))
        return reply({ object: { sha: NEXT } });
      if (path.endsWith("/git/commits/" + NEXT))
        return reply({ message: "bookwriter: sync " + operationId });
      if (path.endsWith("/contents/.bookwriter/sync.json"))
        return reply({ type: "file", encoding: "base64", content: btoa(JSON.stringify({
          operationId, sourceRevision: remoteRevision, bookId: book.id,
        })) });
      return reply({ message: "Unexpected URL" }, 500);
    }));
    const result = await pushGitHubBook(book.id, false, {
      automatic: true, operationId,
    });
    expect(result.recovered).toBe(true);
    expect(result.sourceRevision).toBe(remoteRevision);
    expect(result.commit).toBe(NEXT);
    expect(calls.some(call => call.startsWith("POST") || call.startsWith("PATCH"))).toBe(false);
    expect((await getBook(book.id))?.remote?.lastSyncedCommit).toBe(NEXT);
    // The remote marker identifies an older source revision and a DIFFERENT
    // operationId from the local queue. That independent pending checkpoint
    // must be retained unchanged, not rotated or incorrectly acknowledged.
    const pending = await getOutbox(book.id);
    expect(pending).toEqual(queuedBeforeRecovery);
    expect(pending?.state).toBe("pending");
    expect((await getBook(book.id))?.remote?.lastSyncedLocalUpdatedAt).toBe(remoteRevision);
  });

  it("non scambia un commit estraneo per un ACK automatico e non forza il branch", async () => {
    const book = await sampleBook();
    book.remote!.lastSyncedCommit = BEFORE;
    book.remote!.autoSync = true;
    await saveBook(book);
    const operationId = crypto.randomUUID();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, request?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push((request?.method ?? "GET") + " " + path);
      if (path === "/repos/test-owner/book-repo")
        return reply({ private: true, permissions: { push: true } });
      if (path.endsWith("/git/ref/heads/main")) return reply({ object: { sha: NEXT } });
      if (path.endsWith("/git/commits/" + NEXT))
        return reply({ message: "bookwriter: sync " + crypto.randomUUID() });
      return reply({ message: "Unexpected URL" }, 500);
    }));
    await expect(pushGitHubBook(book.id, false, { automatic: true, operationId }))
      .rejects.toBeInstanceOf(RemoteConflict);
    expect(calls.some(call => call.startsWith("POST") || call.startsWith("PATCH"))).toBe(false);
  });

  it("riconcilia un intento precedente solo con HEAD, messaggio, parent e marker esatti", async () => {
    const book = await sampleBook();
    const intent = {
      bookId: book.id, operationId: crypto.randomUUID(),
      owner: "test-owner", repository: "book-repo", branch: "main",
      baseSha: BEFORE, sourceRevision: book.updatedAt,
      preparedAt: new Date().toISOString(),
    };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      calls.push(method + " " + path);
      if (path.endsWith("/git/ref/heads/main"))
        return reply({ object: { sha: NEXT } });
      if (path.endsWith("/git/commits/" + NEXT))
        return reply({ message: "bookwriter: sync " + intent.operationId,
          parents: [{ sha: BEFORE }] });
      if (path.endsWith("/contents/.bookwriter/sync.json"))
        return reply({ type: "file", encoding: "base64",
          content: btoa(JSON.stringify({
            bookId: intent.bookId, operationId: intent.operationId,
            sourceRevision: intent.sourceRevision,
          })),
        });
      return reply({ message: "Unexpected" }, 500);
    }));
    expect(await verifyPublishedManualPush(intent)).toBe(NEXT);
    // The final GET rechecks that HEAD did not move during the proof.
    expect(calls).toHaveLength(4);
    expect(calls.every(x => x.startsWith("GET "))).toBe(true);
  });

  it.each([
    "head-not-moved", "alien-commit", "wrong-parent", "wrong-operation",
    "wrong-book", "wrong-revision", "missing-marker", "network-lost",
  ] as const)("non archivia un intento non dimostrabile: %s", async scenario => {
    const book = await sampleBook();
    const intent = {
      bookId: book.id, operationId: crypto.randomUUID(),
      owner: "test-owner", repository: "book-repo", branch: "main",
      baseSha: BEFORE, sourceRevision: book.updatedAt,
      preparedAt: new Date().toISOString(),
    };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      calls.push(method);
      if (scenario === "network-lost") throw new TypeError("Network lost");
      if (path.endsWith("/git/ref/heads/main"))
        return reply({ object: { sha: scenario === "head-not-moved" ? BEFORE : NEXT } });
      if (path.endsWith("/git/commits/" + NEXT))
        return reply({ message: scenario === "alien-commit"
          ? "a commit from another editor" : "bookwriter: sync " + intent.operationId,
          parents: [{ sha: scenario === "wrong-parent" ? "f".repeat(40) : BEFORE }],
        });
      if (path.endsWith("/contents/.bookwriter/sync.json")) {
        if (scenario === "missing-marker") return reply({ message: "Not Found" }, 404);
        return reply({ type: "file", encoding: "base64",
          content: btoa(JSON.stringify({
            bookId: scenario === "wrong-book" ? crypto.randomUUID() : intent.bookId,
            operationId: scenario === "wrong-operation" ? crypto.randomUUID() : intent.operationId,
            sourceRevision: scenario === "wrong-revision" ? "stale" : intent.sourceRevision,
          })),
        });
      }
      return reply({ message: "Unexpected" }, 500);
    }));
    await expect(verifyPublishedManualPush(intent)).rejects.toThrow();
    expect(calls.every(x => x === "GET")).toBe(true);
  });

  it("rifiuta path GitHub costruiti con branch o nome ostile", () => {
    expect(() => validateRemote({ owner: "a", repository: "../other", branch: "main" })).toThrow();
    expect(() => validateRemote({ owner: "a", repository: "repo", branch: "../../main" })).toThrow();
  });
});
