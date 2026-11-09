import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptLocal } from "./crypto";
import { getBook, saveBook, saveSettings } from "./db";
import { getOutbox } from "./outbox";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { importGitHubBook, pushGitHubBook, RemoteConflict, validateRemote } from "./github-sync";

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

function fakeGitHub(options: { isPrivate?: boolean; head?: string } = {}) {
  const calls: Array<{ path: string; method: string; body: unknown; headers: Headers }> = [];
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
    if (path.endsWith("/git/ref/heads/main") && method === "GET")
      return reply({ object: { sha: options.head ?? BEFORE } });
    if (path.includes("/contents/") && method === "GET")
      return reply({ message: "Not Found" }, 404);
    if (path.endsWith("/git/commits/" + (options.head ?? BEFORE)) && method === "GET")
      return reply({ tree: { sha: TREE } });
    if (path.endsWith("/git/trees") && method === "POST")
      return reply({ sha: NEXT_TREE }, 201);
    if (path.endsWith("/git/commits") && method === "POST")
      return reply({ sha: NEXT }, 201);
    if (path.endsWith("/git/refs/heads/main") && method === "PATCH")
      return reply({ object: { sha: NEXT } });
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

  it("rifiuta path GitHub costruiti con branch o nome ostile", () => {
    expect(() => validateRemote({ owner: "a", repository: "../other", branch: "main" })).toThrow();
    expect(() => validateRemote({ owner: "a", repository: "repo", branch: "../../main" })).toThrow();
  });
});
