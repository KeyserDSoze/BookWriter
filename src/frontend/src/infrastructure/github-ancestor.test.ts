import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptLocal } from "./crypto";
import { saveSettings } from "./db";
import { DEFAULT_SETTINGS } from "../domain/types";
import { isGitHubAncestor } from "./github-sync";

const REMOTE = { owner: "demo", repository: "faro", branch: "main" };
const BASE = "a".repeat(40), HEAD = "b".repeat(40);
const sha = (n: number) => n.toString(16).padStart(40, "0");

beforeEach(async () => {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal("github_pat_TOKEN_DI_PROVA_0123456789") });
});
afterEach(() => vi.unstubAllGlobals());

function commitsApi(pages: string[][]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname + parsed.search);
    expect(parsed.origin).toBe("https://api.github.com");
    expect(init.redirect).toBe("error");
    const page = Number(parsed.searchParams.get("page"));
    expect(parsed.searchParams.get("sha")).toBe(HEAD);
    return new Response(JSON.stringify((pages[page - 1] ?? []).map(value => ({ sha: value }))), { status: 200 });
  }));
  return calls;
}

describe("discendenza dei commit su GitHub", () => {
  it("trova il commit di base nella prima pagina con una sola richiesta leggera", async () => {
    const calls = commitsApi([[HEAD, sha(1), BASE]]);
    expect(await isGitHubAncestor(REMOTE, BASE, HEAD)).toBe("ancestor");
    expect(calls).toEqual(["/repos/demo/faro/commits?sha=" + HEAD + "&per_page=100&page=1"]);
  });
  it("continua sulle pagine successive, fino a 1.000 commit", async () => {
    const full = (start: number) => Array.from({ length: 100 }, (_, i) => sha(start + i));
    const calls = commitsApi([full(1), full(200), [BASE]]);
    expect(await isGitHubAncestor(REMOTE, BASE, HEAD)).toBe("ancestor");
    expect(calls).toHaveLength(3);
  });
  it("storia esaurita senza trovare la base: non è un antenato", async () => {
    commitsApi([[HEAD, sha(1)]]);
    expect(await isGitHubAncestor(REMOTE, BASE, HEAD)).toBe("not_found");
  });
  it("oltre 10 pagine piene: troppo lontano, senza richieste infinite", async () => {
    const calls = commitsApi(Array.from({ length: 12 }, (_, page) => Array.from({ length: 100 }, (_x, i) => sha(page * 100 + i + 1))));
    expect(await isGitHubAncestor(REMOTE, BASE, HEAD)).toBe("too_far");
    expect(calls).toHaveLength(10);
  });
  it("rifiuta SHA non validi prima di ogni richiesta e risposte non valide", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(isGitHubAncestor(REMOTE, "non-uno-sha", HEAD)).rejects.toThrow(/non valido/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "x" }), { status: 200 })));
    await expect(isGitHubAncestor(REMOTE, BASE, HEAD)).rejects.toThrow(/non valido/);
  });
});
