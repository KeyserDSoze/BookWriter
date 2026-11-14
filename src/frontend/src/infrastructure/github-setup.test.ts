import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { connectGitHubBook } from "../application/github-connect";
import { encryptLocal } from "./crypto";
import { getBook, getDb, saveBook, saveSettings } from "./db";
import { discoverGitHubRepositories, initializeEmptyGitHubRepository, inspectGitHubSetup } from "./github-setup";

const TOKEN = "github_pat_setup_synthetic_not_real";
const HEAD = "a".repeat(40);
const remote = { owner: "test-owner", repository: "novel", branch: "trunk" };
const metadata = { name: "novel", owner: { login: "test-owner" }, private: true,
  default_branch: "trunk", permissions: { push: true } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

function server() {
  let empty = true;
  let publicRepo = false;
  let foreign = false;
  let project: ReturnType<typeof newBook> | undefined;
  let putResponse: "ok" | "lost" | "wrongHead" = "ok";
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe("https://api.github.com");
    expect(url.href).not.toContain(TOKEN);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer " + TOKEN);
    expect(init?.redirect).toBe("error");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === "/user/repos") return json([{ ...metadata, private: !publicRepo }]);
    const path = url.pathname.replace("/repos/test-owner/novel", "");
    if (!path) return json({ ...metadata, private: !publicRepo });
    if (path === "/branches") return json(empty ? [] : [{ name: "trunk" }]);
    if (path === "/git/ref/heads/trunk") return json({ object: { sha: putResponse === "wrongHead" ? "b".repeat(40) : HEAD } });
    if (path === "/contents/.bookwriter/initialization.json" && method === "PUT") {
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      empty = false;
      if (putResponse === "lost") throw new TypeError(TOKEN);
      return json({ commit: { sha: HEAD } }, 201);
    }
    if (path === "/contents/.bookwriter/project.json" && project)
      return json({ type: "file", encoding: "base64", content: btoa(JSON.stringify(project)) });
    if (path === "/contents/book.md" && foreign)
      return json({ type: "file", encoding: "base64", content: btoa("Existing manuscript") });
    return json({}, 404);
  }));
  return {
    calls, initialized() { empty = false; }, public() { publicRepo = true; },
    foreign() { empty = false; foreign = true; },
    project(book: ReturnType<typeof newBook>) { empty = false; project = book; },
    put(mode: typeof putResponse) { putResponse = mode; },
  };
}

beforeEach(async () => {
  const db = await getDb();
  await Promise.all(["books", "activities", "outbox", "meta", "settings"].map(store => db.clear(store)));
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal(TOKEN) });
  vi.stubGlobal("navigator", { locks: { request: async (_: string, _options: unknown, action: (lock: object) => Promise<unknown>) => action({}) } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Collegamento GitHub guidato", () => {
  it("rileva proprietario e ramo, senza dedurli dal PAT e senza scritture", async () => {
    const api = server();
    expect(await discoverGitHubRepositories()).toEqual([{ remote, private: true, canPush: true }]);
    expect((await inspectGitHubSetup(remote)).kind).toBe("empty");
    expect(api.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("inizializza una repository vuota con un solo file neutro create-only e rilegge la HEAD", async () => {
    const api = server();
    const book = newBook("Brief privato", "Un titolo privato", "", "");
    await saveBook(book);
    await connectGitHubBook(book.id, book.updatedAt, remote);
    const connected = await getBook(book.id);
    expect(connected?.remote).toMatchObject(remote);
    expect(connected?.remote?.lastSyncedCommit).toBeUndefined();
    expect(connected?.brief).toBe(book.brief);
    const writes = api.calls.filter(call => call.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.method).toBe("PUT");
    expect(writes[0]!.body?.sha).toBeUndefined();
    expect(writes[0]!.body?.branch).toBe("trunk");
    const written = atob(String(writes[0]!.body?.content));
    expect(written).toContain("bookwriter-initialization");
    expect(written).not.toContain(book.id);
    expect(JSON.stringify(writes)).not.toContain(TOKEN);
    expect(JSON.stringify(writes)).not.toContain("privato");
  });

  it("non scrive su una repository pubblica senza consenso", async () => {
    const api = server(); api.public();
    const book = newBook("Idea", "Titolo", "", ""); await saveBook(book);
    await expect(connectGitHubBook(book.id, book.updatedAt, remote)).rejects.toThrow(/pubblica/);
    expect((await getBook(book.id))?.remote).toBeUndefined();
    expect(api.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("un libro remoto diventa una proposta d'importazione, non un collegamento o una sovrascrittura", async () => {
    const api = server();
    const existing = newBook("Privato", "Libro remoto", "", ""); api.project(existing);
    expect(await inspectGitHubSetup(remote)).toMatchObject({ kind: "book", bookId: existing.id, title: existing.title });
    const book = newBook("Locale", "Libro locale", "", ""); await saveBook(book);
    await expect(connectGitHubBook(book.id, book.updatedAt, remote)).rejects.toThrow(/contiene già un libro/);
    expect((await getBook(book.id))?.remote).toBeUndefined();
    expect(api.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("non tocca book.md estraneo", async () => {
    const api = server(); api.foreign();
    const book = newBook("Locale", "Libro locale", "", ""); await saveBook(book);
    await expect(connectGitHubBook(book.id, book.updatedAt, remote)).rejects.toThrow(/non importabili/);
    expect(api.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("non ritenta un PUT con risposta persa e non dichiara riuscito il collegamento", async () => {
    const api = server(); api.put("lost");
    const book = newBook("Locale", "Libro locale", "", ""); await saveBook(book);
    await expect(connectGitHubBook(book.id, book.updatedAt, remote)).rejects.toThrow(/Nessun tentativo automatico/);
    expect((await getBook(book.id))?.remote).toBeUndefined();
    expect(api.calls.filter(call => call.method === "PUT")).toHaveLength(1);
    // The next explicit attempt finds the neutral commit and does not write it again.
    api.put("ok");
    await connectGitHubBook(book.id, book.updatedAt, remote);
    expect(api.calls.filter(call => call.method === "PUT")).toHaveLength(1);
  });

  it("non conferma una HEAD diversa e non registra una baseline falsa", async () => {
    const api = server(); api.put("wrongHead");
    await expect(initializeEmptyGitHubRepository(remote, false, async () => undefined)).rejects.toThrow(/cambiata/);
  });

  it("controlla revisione e scelta corrente prima di inizializzare", async () => {
    const api = server();
    const book = newBook("Locale", "Libro locale", "", ""); await saveBook(book);
    await expect(connectGitHubBook(book.id, "stale", remote)).rejects.toThrow(/cambiato/);
    await expect(connectGitHubBook(book.id, book.updatedAt, remote, false, () => false)).rejects.toThrow(/cambiata/);
    expect(api.calls).toHaveLength(0);
  });

  it("non inizializza se manca il lock o è già occupato", async () => {
    const api = server();
    const book = newBook("Locale", "Libro locale", "", ""); await saveBook(book);
    vi.stubGlobal("navigator", {});
    await expect(connectGitHubBook(book.id, book.updatedAt, remote)).rejects.toThrow(/Web Locks/);
    vi.stubGlobal("navigator", { locks: { request: async (_: string, _options: unknown, action: (lock: null) => Promise<void>) => action(null) } });
    await expect(connectGitHubBook(book.id, book.updatedAt, remote)).rejects.toThrow(/altra scheda/);
    expect(api.calls).toHaveLength(0);
  });

  it("rifiuta destinazioni ostili e non usa URL forniti da GitHub", async () => {
    const fetcher = vi.fn(async () => json([{ ...metadata, owner: { login: "evil.test/path" }, url: "https://evil.test" }]));
    vi.stubGlobal("fetch", fetcher);
    await expect(discoverGitHubRepositories()).rejects.toThrow(/non valido/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
