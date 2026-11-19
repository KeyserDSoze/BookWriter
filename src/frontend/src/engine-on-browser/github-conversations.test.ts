import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type AppSettings } from "@engine/domain/types";
import { CONVERSATIONS_DIR, CONVERSATIONS_INDEX } from "@engine/domain/conversation-export";
import { encryptLocal } from "../infrastructure/crypto";
import { getDb, saveBook, saveSettings } from "../infrastructure/db";
import { saveAiTrace } from "@engine/infrastructure/ai-observability";
import { pushGitHubBook } from "@engine/infrastructure/github-sync";

const BEFORE = "a".repeat(40), TREE = "b".repeat(40), NEXT_TREE = "c".repeat(40), NEXT = "d".repeat(40);
const TOKEN = "github_pat_mock_token_not_real_999";
const reply = (content: unknown, status = 200) => new Response(JSON.stringify(content), {
  status, headers: { "Content-Type": "application/json" } });

interface TreeEntry { path: string; content?: string; sha?: null }
/** One repository whose manifest remembers what an earlier push wrote. */
function fakeRepository(previousPaths: string[] = []) {
  let head = BEFORE;
  let tree: TreeEntry[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, request?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname, method = request?.method ?? "GET";
    const body = request?.body ? JSON.parse(String(request.body)) as { tree?: TreeEntry[] } : undefined;
    if (path === "/repos/test-owner/book-repo" && method === "GET") return reply({ private: true, permissions: { push: true } });
    if (path.endsWith("/git/ref/heads/main") && method === "GET") return reply({ object: { sha: head } });
    if (path.includes("/contents/.bookwriter/manifest.json"))
      return previousPaths.length ? reply({ type: "file", encoding: "base64",
        content: btoa(JSON.stringify({ schemaVersion: 1, bookId: bookId(), paths: previousPaths })) }) : reply({}, 404);
    if (path.includes("/contents/")) return reply({}, 404);
    if (path.endsWith("/git/commits/" + BEFORE)) return reply({ tree: { sha: TREE } });
    if (path.endsWith("/git/trees") && method === "POST") { tree = body!.tree!; return reply({ sha: NEXT_TREE }, 201); }
    if (path.endsWith("/git/commits") && method === "POST") return reply({ sha: NEXT }, 201);
    if (path.endsWith("/git/refs/heads/main") && method === "PATCH") { head = NEXT; return reply({ object: { sha: NEXT } }); }
    return reply({ message: "Unexpected" }, 500);
  }));
  return { tree: () => tree, paths: () => tree.filter(entry => entry.sha !== null).map(entry => entry.path),
    removed: () => tree.filter(entry => entry.sha === null).map(entry => entry.path) };
}
let currentBookId = "";
const bookId = () => currentBookId;

async function configure(extra: Partial<AppSettings> = {}) {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal(TOKEN), ...extra });
}
async function book(synced = false) {
  const created = newBook("Brief riservato", "Libro con conversazioni", "Sobrio", "Adulti");
  created.remote = { owner: "test-owner", repository: "book-repo", branch: "main",
    ...(synced ? { lastSyncedCommit: BEFORE } : {}) };
  await saveBook(created);
  currentBookId = created.id;
  return created;
}
const keep = (id: string, minutes: number, extra: Record<string, unknown> = {}) => saveAiTrace({
  activityId: id, bookId: currentBookId, createdAt: new Date(Date.now() - minutes * 60_000).toISOString(),
  endpointId: "openai", modelId: "m", systemPrompt: "SYSTEM RISERVATO", userPrompt: "USER RISERVATO " + id,
  response: "RISPOSTA " + id, truncated: false, kept: true, ...extra });

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["meta", "books", "activities", "outbox"]) await db.clear(store);
});
afterEach(() => vi.unstubAllGlobals());

describe("conversazioni AI nel push GitHub", () => {
  it("di default non scrive nessuna conversazione, nemmeno se sono conservate", async () => {
    await configure({ keepAiConversations: true }); // kept locally, but the GitHub switch is off
    const created = await book();
    await keep("conv-1", 5);
    const repo = fakeRepository();
    await pushGitHubBook(created.id);
    expect(repo.paths().some(path => path.startsWith(CONVERSATIONS_DIR))).toBe(false);
    expect(JSON.stringify(repo.tree())).not.toContain("USER RISERVATO");
  });
  it("con le due spunte scrive le conversazioni conservate del libro, e il manifest le elenca", async () => {
    await configure({ keepAiConversations: true, syncAiConversationsToGitHub: true });
    const created = await book();
    await keep("conv-1", 10);
    await keep("conv-2", 5);
    await keep("temporanea", 3, { kept: false });
    await keep("altro-libro", 2, { bookId: "altro" });
    const repo = fakeRepository();
    await pushGitHubBook(created.id);
    expect(repo.paths().filter(path => path.startsWith(CONVERSATIONS_DIR)).sort()).toEqual([
      CONVERSATIONS_DIR + "conv-1.json", CONVERSATIONS_DIR + "conv-2.json", CONVERSATIONS_INDEX]);
    const manifest = JSON.parse(repo.tree().find(entry => entry.path === ".bookwriter/manifest.json")!.content!) as { paths: string[] };
    expect(manifest.paths).toEqual(expect.arrayContaining([CONVERSATIONS_DIR + "conv-1.json", CONVERSATIONS_INDEX]));
    const text = JSON.stringify(repo.tree());
    expect(text).toContain("USER RISERVATO conv-1");
    expect(text).not.toContain("altro-libro");
    expect(text).not.toContain("temporanea");
    expect(text).not.toContain(TOKEN);
  });
  it("lo schema resta lossless: project.json e activities.json non portano le conversazioni", async () => {
    await configure({ keepAiConversations: true, syncAiConversationsToGitHub: true });
    const created = await book();
    await keep("conv-1", 10);
    const repo = fakeRepository();
    await pushGitHubBook(created.id);
    for (const path of [".bookwriter/project.json", ".bookwriter/activities.json"])
      expect(repo.tree().find(entry => entry.path === path)!.content).not.toContain("USER RISERVATO");
  });
  it("togliendo la spunta, al push successivo i file scritti da BookWriter vengono rimossi (non gli altri)", async () => {
    await configure({ keepAiConversations: true, syncAiConversationsToGitHub: false });
    const created = await book(true);
    await keep("conv-1", 5);
    const repo = fakeRepository([".bookwriter/manifest.json", ".bookwriter/project.json",
      CONVERSATIONS_DIR + "conv-1.json", CONVERSATIONS_DIR + "conv-vecchia.json", CONVERSATIONS_INDEX, "notes/mie-note.txt"]);
    await pushGitHubBook(created.id);
    expect(repo.removed().sort()).toEqual([
      CONVERSATIONS_DIR + "conv-1.json", CONVERSATIONS_DIR + "conv-vecchia.json", CONVERSATIONS_INDEX]);
    expect(repo.removed()).not.toContain("notes/mie-note.txt");
  });
  it("tiene il push sotto il limite dell'operazione anche con molte conversazioni grandi", async () => {
    await configure({ keepAiConversations: true, syncAiConversationsToGitHub: true });
    const created = await book();
    // ~357k characters each: 20 of them are more than the 6 MiB the conversations may take.
    for (let index = 0; index < 20; index++)
      await keep("grande-" + String(index).padStart(2, "0"), 100 - index,
        { response: "x".repeat(119_000), userPrompt: "u".repeat(119_000), systemPrompt: "s".repeat(119_000) });
    const repo = fakeRepository();
    await pushGitHubBook(created.id);
    expect(JSON.stringify(repo.tree()).length).toBeLessThanOrEqual(12 * 1024 * 1024);
    const index = JSON.parse(repo.tree().find(entry => entry.path === CONVERSATIONS_INDEX)!.content!) as
      { count: number; omitted: number; conversations: Array<{ activityId: string }> };
    expect(index.count + index.omitted).toBe(20);
    expect(index.count).toBeGreaterThan(0);
    expect(index.omitted).toBeGreaterThan(0);
    // the newest ones are the ones that made it, the oldest one was left out
    expect(index.conversations[0]!.activityId).toBe("grande-19");
    expect(index.conversations.map(item => item.activityId)).not.toContain("grande-00");
  });
});
