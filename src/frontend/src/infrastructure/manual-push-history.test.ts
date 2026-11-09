import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptLocal } from "./crypto";
import { saveSettings } from "./db";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { RemoteConflict, verifyPublishedManualPush } from "./github-sync";
import type { ManualPushIntent } from "./manual-push-intent";

const BASE = "a".repeat(40);
const PUBLISHED = "b".repeat(40);
const HEAD = "c".repeat(40);
const NEW_HEAD = "d".repeat(40);

function intent(): ManualPushIntent {
  const book = newBook("Il manoscritto", "Romanzo", "Sobrio", "Adulti");
  return {
    bookId: book.id, operationId: crypto.randomUUID(),
    owner: "old-writer", repository: "old-novel", branch: "main",
    baseSha: BASE, sourceRevision: book.updatedAt,
    preparedAt: new Date().toISOString(),
  };
}
function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
}
type Scenario =
  | "valid" | "two-descendants" | "foreign-marker" | "missing-marker"
  | "foreign-message" | "wrong-parent" | "merge" | "malformed"
  | "cycle" | "head-moves" | "network" | "no-ancestor" | "too-deep";

function mockHistory(record: ManualPushIntent, scenario: Scenario) {
  const calls: Array<{ method: string; path: string; ref: string | null }> = [];
  const depthSha = (n: number) => n.toString(16).padStart(40, "0");
  const firstHead = scenario === "too-deep" ? depthSha(41)
    : scenario === "two-descendants" ? NEW_HEAD : HEAD;
  let headReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    calls.push({ method, path: u.pathname, ref: u.searchParams.get("ref") });
    if (scenario === "network") throw new TypeError("Network offline");
    if (u.pathname.endsWith("/git/ref/heads/main")) {
      headReads++;
      return reply({ object: { sha: scenario === "head-moves" && headReads >= 2
        ? NEW_HEAD : firstHead } });
    }
    if (u.pathname.includes("/git/commits/")) {
      const sha = u.pathname.split("/").at(-1);
      if (scenario === "too-deep") {
        const n = parseInt(sha ?? "", 16);
        return reply({
          message: "unrelated", parents: [{ sha: depthSha(n - 1) }],
        });
      }
      if (sha === NEW_HEAD) return reply({
        message: "Later unrelated editor", parents: [{ sha: HEAD }],
      });
      if (sha === HEAD) return reply({
        message: scenario === "cycle" ? "Unrelated" : "Another device later",
        parents: scenario === "merge"
          ? [{ sha: PUBLISHED }, { sha: "f".repeat(40) }]
          : [{ sha: scenario === "malformed" ? "not-a-sha"
            : scenario === "cycle" ? HEAD
            : scenario === "no-ancestor" ? BASE : PUBLISHED }],
      });
      if (sha === PUBLISHED) return reply({
        message: scenario === "foreign-message"
          ? "Another operation" : "bookwriter: sync " + record.operationId,
        parents: [{ sha: scenario === "wrong-parent" ? "f".repeat(40) : BASE }],
      });
      return reply({ message: "Missing SHA" }, 404);
    }
    if (u.pathname.endsWith("/contents/.bookwriter/sync.json")) {
      if (scenario === "missing-marker")
        return reply({ message: "Not Found" }, 404);
      return reply({ type: "file", encoding: "base64",
        content: btoa(JSON.stringify({
          bookId: record.bookId,
          operationId: scenario === "foreign-marker" ? crypto.randomUUID() : record.operationId,
          sourceRevision: record.sourceRevision,
        })),
      });
    }
    return reply({ message: "Unexpected read" }, 500);
  }));
  return { calls };
}

beforeEach(async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.githubToken = await encryptLocal("github_pat_fake_history_proof_2026");
  await saveSettings(settings);
});
afterEach(() => vi.unstubAllGlobals());

describe("Riconciliazione HEAD avanzata: catena strettamente lineare e bounded", () => {
  it.each(["valid", "two-descendants"] as const)(
    "riconosce il commit storico con %s senza attribuire il nuovo HEAD all'autore", async scenario => {
      const record = intent();
      const { calls } = mockHistory(record, scenario);
      expect(await verifyPublishedManualPush(record)).toBe(PUBLISHED);
      expect(calls.every(x => x.method === "GET")).toBe(true);
      expect(calls.filter(x => x.path.endsWith("/git/ref/heads/main"))).toHaveLength(2);
      expect(calls.filter(x => x.path.endsWith("/contents/.bookwriter/sync.json")))
        .toEqual([{ method: "GET",
          path: "/repos/old-writer/old-novel/contents/.bookwriter/sync.json", ref: PUBLISHED }]);
      expect(calls.filter(x => x.path.includes("/git/commits/")))
        .toHaveLength(scenario === "valid" ? 2 : 3);
    },
  );

  it.each([
    "foreign-marker", "missing-marker", "foreign-message", "wrong-parent",
    "merge", "malformed", "cycle", "head-moves", "network",
    "no-ancestor", "too-deep",
  ] as const)("rifiuta %s senza richiedere scritture o promuovere una prova parziale", async scenario => {
    const record = intent();
    const { calls } = mockHistory(record, scenario);
    await expect(verifyPublishedManualPush(record)).rejects.toThrow();
    expect(calls.every(x => x.method === "GET")).toBe(true);
    if (scenario === "too-deep")
      expect(calls.filter(x => x.path.includes("/git/commits/"))).toHaveLength(32);
    if (scenario === "head-moves")
      expect(calls.filter(x => x.path.endsWith("/git/ref/heads/main"))).toHaveLength(2);
    if (scenario === "foreign-marker" || scenario === "missing-marker")
      expect(calls.some(x => x.ref === PUBLISHED)).toBe(true);
  });
});
