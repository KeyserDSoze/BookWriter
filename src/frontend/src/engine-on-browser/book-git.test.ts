import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { host } from "@engine/core/host";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "@engine/domain/types";
import { projectBook } from "@engine/domain/narrarium";
import { MemoryGitHub } from "@engine/testing/memory-git";
import { pushGitHubBook } from "@engine/infrastructure/github-sync";
import { abortMerge, createBranch, deleteBranch, finishMerge, listBookBranches, pullBook, resolveMerge, startBranchMerge, switchBranch } from "@engine/application/book-git";
import { chooseMerge } from "@engine/domain/book-merge";
import { encryptLocal } from "../infrastructure/crypto";
import { getBook, getDb, saveBook, saveSettings } from "../infrastructure/db";

const TEXT = ["Apertura.", "Il faro era spento.", "Mara salì le scale.", "Parlò con Elio.", "Chiusura."].join("\n");
let memory: MemoryGitHub;
let book: BookProject;

function sample(): BookProject {
  const created = newBook("Premessa", "Il faro", "Sobrio", "Adulti");
  created.status = "paused"; created.phase = "completed";
  created.chapters = [{ id: "ch:1", number: 1, title: "Il ponte", purpose: "p", frozenAt: "2026-01-01T00:00:00.000Z", summary: "r",
    scenes: [{ id: "s:1", number: 1, title: "Incontro", objective: "o", text: TEXT, status: "canon", summary: "s" }] }];
  created.remote = { owner: "demo", repository: "faro", branch: "main", autoSync: false, allowPublicSync: false };
  return created;
}
/** Another device: the same book, changed, committed with the app's own projection. */
async function external(branch: string, change: (copy: BookProject) => void): Promise<string> {
  const tip = memory.file(branch, ".bookwriter/project.json")!;
  const copy = JSON.parse(tip) as BookProject;
  change(copy);
  copy.updatedAt = new Date(Date.parse(copy.updatedAt) + 60_000).toISOString();
  const projection = projectBook(copy, []);
  const files: Record<string, string | null> = { ...projection.files, ".bookwriter/manifest.json": JSON.stringify(projection.manifest, null, 2) + "\n" };
  return memory.commit(branch, files);
}
const text = async () => (await getBook(book.id))!.chapters[0]!.scenes[0]!.text;
const edit = (value: string) => async () => {
  const current = (await getBook(book.id))!;
  current.chapters[0]!.scenes[0]!.text = value;
  await saveBook(current, false, current.updatedAt);
};

beforeEach(async () => {
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, cb: (lock: object) => unknown) => cb({}) } });
  const db = await getDb();
  for (const name of ["books", "activities", "outbox", "meta", "settings"]) await db.clear(name);
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal("pat-sintetico") });
  memory = new MemoryGitHub();
  await memory.commit("main", { "LEGGIMI.txt": "inizio\n" });
  Object.assign(host(), { gitHub: memory });
  book = sample();
  await saveBook(book, false);
  book = (await getBook(book.id))!;
  const pushed = await pushGitHubBook(book.id);
  expect(pushed.commit).toBe(memory.refs.get("main"));
  book = (await getBook(book.id))!;
});
afterEach(() => { Object.assign(host(), { gitHub: undefined }); vi.unstubAllGlobals(); });

describe("pull, branch e unione sul motore condiviso", () => {
  it("fast-forward senza modifiche locali, poi unione a tre vie di modifiche in punti diversi", async () => {
    const first = await external("main", copy => { copy.chapters[0]!.scenes[0]!.text = TEXT.replace("Chiusura.", "Chiusura, di notte."); });
    expect(await pullBook(book.id)).toEqual({ state: "fast_forwarded", commit: first });
    expect((await getBook(book.id))!.remote!.lastSyncedCommit).toBe(first);
    expect(await pullBook(book.id)).toEqual({ state: "current", commit: first });

    await edit((await text()).replace("Il faro era spento.", "Il faro era spento da anni."))();
    const other = await external("main", copy => { copy.chapters[0]!.scenes[0]!.text = copy.chapters[0]!.scenes[0]!.text.replace("Apertura.", "Prologo.\nApertura."); });
    const merged = await pullBook(book.id);
    expect(merged.state).toBe("merged");
    const result = await text();
    expect(result).toContain("Prologo."); expect(result).toContain("spento da anni"); expect(result).toContain("di notte");
    const tip = memory.refs.get("main")!;
    expect(memory.commits.get(tip)!.parents).toHaveLength(2);
    expect(memory.commits.get(tip)!.parents).toContain(other);
    expect((await getBook(book.id))!.remote!.lastSyncedCommit).toBe(tip);
    expect((await getBook(book.id))!.chapters[0]!.frozenAt).toBeUndefined();
  });

  it("una riga cambiata in due modi apre un'unione: nulla esce finché non è decisa, e annullarla lascia il libro com'era", async () => {
    await edit(TEXT.replace("Parlò con Elio.", "Tacque."))();
    await external("main", copy => { copy.chapters[0]!.scenes[0]!.text = TEXT.replace("Parlò con Elio.", "Urlò."); });
    const before = memory.refs.get("main");
    const outcome = await pullBook(book.id);
    expect(outcome.state).toBe("needs_resolution");
    const session = (await getBook(book.id))!.mergeSession!;
    expect(session.conflicts).toHaveLength(1);
    await expect(finishMerge(book.id)).rejects.toThrow("senza decisione");
    await expect(pullBook(book.id)).rejects.toThrow("in attesa di decisioni");
    await expect(pushGitHubBook(book.id)).rejects.toThrow("attesa di decisioni");
    expect(memory.refs.get("main")).toBe(before);
    await abortMerge(book.id, session.id);
    expect((await getBook(book.id))!.mergeSession).toBeUndefined();
    expect(await text()).toContain("Tacque.");

    expect((await pullBook(book.id)).state).toBe("needs_resolution");
    const again = (await getBook(book.id))!.mergeSession!;
    expect((await resolveMerge(book.id, again.id, { [again.conflicts[0]!.id]: { choice: "theirs" } })).unresolved).toBe(0);
    const done = await finishMerge(book.id);
    expect(done.commit).toBe(memory.refs.get("main"));
    expect(await text()).toContain("Urlò.");
    expect((await getBook(book.id))!.mergeSession).toBeUndefined();
  });

  it("branch: si crea dal corrente senza perdere le modifiche, si lavora, si cambia e si unisce", async () => {
    await edit(TEXT.replace("Parlò con Elio.", "Tacque."))();
    const created = await createBranch(book.id, { name: "bozza", switchTo: true });
    expect(created).toMatchObject({ branch: "bozza", commit: book.remote!.lastSyncedCommit, switched: true });
    expect((await getBook(book.id))!.remote!.branch).toBe("bozza");
    expect(await text()).toContain("Tacque.");
    await expect(switchBranch(book.id, "main")).rejects.toThrow("non salvate");
    await pushGitHubBook(book.id);
    expect(memory.refs.get("main")).toBe(book.remote!.lastSyncedCommit);
    expect(await switchBranch(book.id, "main")).toMatchObject({ branch: "main" });
    expect(await text()).toBe(TEXT);

    const list = await listBookBranches(book.id);
    expect(list.branches.map(b => b.name)).toEqual(["bozza", "main"]);
    // bozza has everything main has plus the edit: merging is a clean take of their side.
    const outcome = await startBranchMerge(book.id, { from: "bozza" });
    expect(outcome.state).toBe("merged");
    expect(await text()).toContain("Tacque.");
    expect(memory.commits.get(memory.refs.get("main")!)!.parents).toHaveLength(2);
    expect((await startBranchMerge(book.id, { from: "bozza" })).state).toBe("current");
    await expect(createBranch(book.id, { name: "bozza" })).rejects.toThrow("esiste già");
    await expect(createBranch(book.id, { name: "bookwriter-lock/x" })).rejects.toThrow();
  });

  it("un branch si elimina solo se è già dentro quello corrente; mai il corrente, mai uno con modifiche proprie", async () => {
    await createBranch(book.id, { name: "bozza" });
    await createBranch(book.id, { name: "prova" });
    await expect(deleteBranch(book.id, "main")).rejects.toThrow("corrente");
    expect(await deleteBranch(book.id, "prova")).toMatchObject({ deleted: "prova" });
    expect(memory.refs.has("prova")).toBe(false);
    await expect(deleteBranch(book.id, "prova")).rejects.toThrow("non esiste");
    // bozza gets its own work: it is no longer contained in main.
    await external("bozza", copy => { copy.chapters[0]!.scenes[0]!.text = TEXT.replace("Chiusura.", "Chiusura, di notte."); });
    await expect(deleteBranch(book.id, "bozza")).rejects.toThrow("uniscilo prima");
    expect(memory.refs.has("bozza")).toBe(true);
    await expect(deleteBranch(book.id, "bookwriter-lock/x")).rejects.toThrow();
  });

  it("le proposte di testo valgono solo sulle scene presenti nei due rami", async () => {
    await edit(TEXT.replace("Parlò con Elio.", "Tacque."))();
    await external("main", copy => { copy.chapters[0]!.scenes[0]!.text = TEXT.replace("Parlò con Elio.", "Urlò."); });
    await pullBook(book.id);
    const session = (await getBook(book.id))!.mergeSession!;
    const next = structuredClone(session);
    expect(() => chooseMerge(next, session.conflicts[0]!.id, "proposal", "")).toThrow("vuota");
    await resolveMerge(book.id, session.id, { [session.conflicts[0]!.id]: { choice: "proposal", proposal: "Parlarono piano." } });
    await finishMerge(book.id);
    const result = (await getBook(book.id))!.chapters[0]!.scenes[0]!;
    expect(result.text).toBe("Parlarono piano."); expect(result.status).toBe("draft");
  });
});
