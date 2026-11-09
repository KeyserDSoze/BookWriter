import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptLocal } from "./crypto";
import { saveSettings } from "./db";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { verifyPublishedManualPush } from "./github-sync";
import type { ManualPushIntent } from "./manual-push-intent";

const BASE = "a".repeat(40);
const PUBLISHED = "b".repeat(40);
const MERGE = "e".repeat(40);
const SIDE = "f".repeat(40);
const LATER = "c".repeat(40);
const ROOT = "1".repeat(40);
const MOVED = "d".repeat(40);
const chainSha = (n: number) => n.toString(16).padStart(40, "0");

function intent(): ManualPushIntent {
  const book = newBook("Una trama", "Riconciliazione merge", "Sobrio", "Adulti");
  return {
    bookId: book.id, operationId: crypto.randomUUID(),
    owner: "historical", repository: "novel", branch: "main",
    baseSha: BASE, sourceRevision: book.updatedAt,
    preparedAt: new Date().toISOString(),
  };
}
function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { "Content-Type": "application/json" } });
}
type Mode = "valid" | "reverse" | "nested-merge" | "duplicate-candidate" |
  "marker-false" | "wrong-base" | "cycle" | "self-parent" |
  "duplicate-parent" | "octopus" | "missing-branch" | "budget" |
  "head-moves" | "foreign-only" | "network";

function mockMerge(record: ManualPushIntent, mode: Mode) {
  const calls: Array<{ method: string; path: string; ref: string | null }> = [];
  const startHead = mode === "budget" ? MERGE : MERGE;
  let headReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const target = new URL(String(url));
    const method = init?.method ?? "GET";
    const path = target.pathname;
    calls.push({ method, path, ref: target.searchParams.get("ref") });
    if (mode === "network") throw new TypeError("Disconnected");
    if (path.endsWith("/git/ref/heads/main")) {
      headReads++;
      return reply({ object: { sha: mode === "head-moves" && headReads > 1
        ? MOVED : startHead } });
    }
    if (path.includes("/git/commits/")) {
      const sha = path.split("/").at(-1);
      if (sha === MERGE) {
        const parents = mode === "self-parent" ? [MERGE] :
          mode === "duplicate-parent" ? [PUBLISHED, PUBLISHED] :
          mode === "octopus" ? [PUBLISHED, SIDE, ROOT] :
          mode === "nested-merge" ? [SIDE, LATER] :
          mode === "budget" ? [PUBLISHED, chainSha(48)] :
          mode === "reverse" ? [PUBLISHED, SIDE] : [SIDE, PUBLISHED];
        return reply({ message: "Merge other device branches",
          parents: parents.map(sha => ({ sha })) });
      }
      if (sha === SIDE) return mode === "missing-branch"
        ? reply({ message: "Not Found" }, 404)
        : reply({ message: mode === "duplicate-candidate"
          ? "bookwriter: sync " + record.operationId : "Another device",
          parents: [{ sha: mode === "cycle" ? MERGE : BASE }] });
      if (sha === LATER) return reply({
        message: "Nested merge", parents: [{ sha: PUBLISHED }, { sha: ROOT }],
      });
      if (sha === ROOT) return reply({ message: "Other branch", parents: [{ sha: BASE }] });
      if (sha === PUBLISHED) return reply({
        message: mode === "foreign-only" ? "Unrelated writer" :
          "bookwriter: sync " + record.operationId,
        parents: [{ sha: mode === "wrong-base" ? ROOT : BASE }],
      });
      if (mode === "budget") {
        const n = parseInt(sha ?? "", 16);
        if (n > 1 && n <= 48)
          return reply({ message: "Long history", parents: [{ sha: chainSha(n - 1) }] });
      }
      return reply({ message: "Unknown SHA" }, 404);
    }
    if (path.endsWith("/contents/.bookwriter/sync.json")) {
      if (target.searchParams.get("ref") !== PUBLISHED &&
          !(mode === "duplicate-candidate" && target.searchParams.get("ref") === SIDE))
        return reply({ message: "Unexpected marker ref" }, 404);
      return reply({ type: "file", encoding: "base64",
        content: btoa(JSON.stringify({
          bookId: record.bookId,
          operationId: mode === "marker-false" ? crypto.randomUUID() : record.operationId,
          sourceRevision: record.sourceRevision,
        })),
      });
    }
    return reply({ message: "Unexpected GET" }, 500);
  }));
  return calls;
}
beforeEach(async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.githubToken = await encryptLocal("github_pat_fake_merge_2026");
  await saveSettings(settings);
});
afterEach(() => vi.unstubAllGlobals());

describe("Intenti sospesi: ricerca completa su merge binari limitati", () => {
  it.each(["valid", "reverse", "nested-merge"] as const)(
    "riconosce il solo commit originale in un DAG con %s e rilegge HEAD", async mode => {
      const record = intent();
      const calls = mockMerge(record, mode);
      expect(await verifyPublishedManualPush(record)).toBe(PUBLISHED);
      expect(calls.every(x => x.method === "GET")).toBe(true);
      expect(calls.filter(x => x.path.endsWith("/git/ref/heads/main"))).toHaveLength(2);
      expect(calls.filter(x => x.path.endsWith("/contents/.bookwriter/sync.json")))
        .toEqual([{ method: "GET",
          path: "/repos/historical/novel/contents/.bookwriter/sync.json", ref: PUBLISHED }]);
      expect(calls.some(x => x.path.endsWith("/git/commits/" + SIDE))).toBe(true);
    },
  );

  it.each([
    "duplicate-candidate", "marker-false", "wrong-base", "cycle",
    "self-parent", "duplicate-parent", "octopus", "missing-branch",
    "budget", "head-moves", "foreign-only", "network",
  ] as const)("mantiene il tentativo senza prova completa: %s", async mode => {
    const record = intent();
    const calls = mockMerge(record, mode);
    await expect(verifyPublishedManualPush(record)).rejects.toThrow();
    expect(calls.every(x => x.method === "GET")).toBe(true);
    if (mode === "budget")
      expect(calls.filter(x => x.path.includes("/git/commits/"))).toHaveLength(32);
    if (mode === "head-moves")
      expect(calls.filter(x => x.path.endsWith("/git/ref/heads/main"))).toHaveLength(2);
    if (mode === "duplicate-candidate")
      expect(calls.some(x => x.ref === SIDE)).toBe(true);
  });
});
