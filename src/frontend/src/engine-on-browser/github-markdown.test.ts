import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticNarrarium } from "@engine/domain/__fixtures__/narrarium";
import { knowledgeBook } from "@engine/domain/__fixtures__/knowledge";
import { createEditorialCycle } from "@engine/domain/editorial-board";
import { newBook, DEFAULT_SETTINGS } from "@engine/domain/types";
import { projectBook, projectLegacyBook } from "@engine/domain/narrarium";
import { gitBlobSha, markdownIdentity } from "@engine/infrastructure/github-markdown";
import { inspectGitHubDestination, pushGitHubBook, readGitHubSnapshot } from "@engine/infrastructure/github-sync";
import { encryptLocal } from "../infrastructure/crypto";
import { getDb, getBook, listBooks, saveActivity, saveBook, saveSettings } from "../infrastructure/db";
import { createBackup, readBackup } from "../infrastructure/backup";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { importGitHubBook, importGitHubMarkdownCopy } from "../infrastructure/github-import";

const HEAD = "a".repeat(40), NEXT = "b".repeat(40), TREE = "c".repeat(40);
const remote = { owner: "synthetic-owner", repository: "synthetic-novel", branch: "main" };
const TOKEN = "github_pat_synthetic_markdown_only";
const scenePath = "chapters/001-arrivo/001-il-molo.md";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function repository(initial: Record<string, string>, options: { truncated?: boolean; mode?: string; moveHead?: boolean; invalidUtf8?: boolean } = {}) {
  let files = { ...initial }, head = HEAD;
  const blobs = new Map<string, string>();
  const calls: string[] = [];
  let pending: Array<{ path: string; content?: string; sha?: null }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input), method = init?.method ?? "GET";
    expect(url.origin).toBe("https://api.github.com");
    expect(url.href).not.toContain(TOKEN);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer " + TOKEN);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    const path = url.pathname.replace("/repos/synthetic-owner/synthetic-novel", "");
    calls.push(method + " " + path);
    if (!path) return reply({ private: true, permissions: { push: true }, default_branch: "main" });
    if (path === "/git/ref/heads/main") return reply({ object: { sha: head } });
    if (path.startsWith("/contents/")) {
      const name = decodeURIComponent(path.slice("/contents/".length));
      expect(url.searchParams.get("ref")).toMatch(/^[a-f0-9]{40}$/);
      return files[name] === undefined ? reply({}, 404) : reply({ type: "file", encoding: "base64", content: Buffer.from(files[name]!).toString("base64") });
    }
    if (path.startsWith("/git/trees/") && method === "GET") {
      expect(path.endsWith(HEAD) || path.endsWith(NEXT)).toBe(true);
      const tree = [];
      for (const [path, content] of Object.entries(files)) {
        const sha = await gitBlobSha(content); blobs.set(sha, content);
        tree.push({ path, sha, type: "blob", mode: options.mode ?? "100644" });
      }
      if (options.moveHead) head = NEXT;
      return reply({ truncated: options.truncated ?? false, tree });
    }
    if (path.startsWith("/git/blobs/")) {
      const content = blobs.get(path.split("/").at(-1)!)!;
      const bytes = options.invalidUtf8 ? Buffer.from([0xff]) : Buffer.from(content);
      return reply({ encoding: "base64", content: bytes.toString("base64"), size: bytes.length });
    }
    if (path === "/git/trees" && method === "POST") { pending = JSON.parse(String(init?.body)).tree; return reply({ sha: TREE }); }
    if (path === "/git/commits" && method === "POST") return reply({ sha: NEXT });
    if (path.startsWith("/git/commits/") && method === "GET") return reply({ tree: { sha: TREE } });
    if (path === "/git/refs/heads/main" && method === "PATCH") {
      expect(JSON.parse(String(init?.body)).force).toBe(false);
      for (const entry of pending) if (entry.sha === null) delete files[entry.path]; else files[entry.path] = entry.content!;
      head = NEXT; return reply({ object: { sha: head } });
    }
    throw new Error("Unexpected synthetic request");
  }));
  return { calls, files: () => files };
}

beforeEach(async () => {
  const db = await getDb();
  await Promise.all(["books", "activities", "outbox", "meta", "settings"].map(store => db.clear(store)));
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal(TOKEN) });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("GitHub Markdown portabile, senza strumenti esterni", () => {
  it("rileva il libro, importa additivamente a HEAD fissa e impedisce il doppio import", async () => {
    const local = newBook("Locale", "Da non toccare", "", ""); await saveBook(local);
    const before = await getBook(local.id);
    const api = await repository(syntheticNarrarium);
    const preview = await inspectGitHubDestination(remote);
    expect(preview).toMatchObject({ kind: "markdown", title: "Il porto di prova", head: HEAD });
    const imported = await importGitHubBook(remote, () => true, HEAD);
    expect(imported.id).toBe((await markdownIdentity(syntheticNarrarium["book.md"]!, remote)).id);
    expect(imported.remote?.lastSyncedCommit).toBe(HEAD);
    expect(imported.chapters[0]!.scenes[0]!.text).toContain("🌊");
    expect(imported.chapters[0]!.frozenAt).toBeUndefined();
    expect(await getBook(local.id)).toEqual(before);
    expect((await listBooks()).length).toBe(2);
    await expect(importGitHubBook(remote)).rejects.toThrow(/già presente/);
    expect(api.calls.every(c => c.startsWith("GET "))).toBe(true); // reading never writes
  });

  it("un libro a metà lavoro si salva e si riapre identico su un altro PC (capitolo non congelato, ciclo editoriale, mondo, compiti)", async () => {
    const book = knowledgeBook();
    book.title = "Le sparizioni"; book.remote = { ...remote, autoSync: true };
    book.phase = "chapterReview"; book.status = "running"; // saved from a PC whose autopilot is working
    const chapter = book.chapters[1]!;
    chapter.frozenAt = undefined; chapter.summary = undefined; chapter.bookSummaryAtFreeze = undefined;
    chapter.scenes[1] = { ...chapter.scenes[1]!, status: "draft", summary: undefined };
    chapter.scenes.push({ id: "scene:002:003", number: 3, title: "Il tram", objective: "Seguire Markus", text: "", status: "planned" });
    book.editorialCycle = createEditorialCycle(chapter.id);
    book.memory.currentState = "Elena sospetta del Consiglio, ma tace.";
    await saveBook(book, false);
    const task = { id: crypto.randomUUID(), bookId: book.id, runId: crypto.randomUUID(), phase: "prose" as const,
      title: "Scrittura della scena", reason: "Test", nextStep: "Rileggere", status: "succeeded" as const,
      createdAt: "2026-11-17T09:00:00.000Z", output: "Elena capisce che la firma era del Consiglio cittadino." };
    await saveActivity(task);
    const api = await repository({});
    // The save of the queue worker, while the autopilot is still running.
    const result = await pushGitHubBook(book.id, false, { automatic: true });
    expect(result.bytes).toBeGreaterThan(0);
    expect(api.files()["chapters/002-l-informatore/chapter.md"]).toContain('canon: "draft"');
    expect(api.files()["chapters/002-l-informatore/003-il-tram.md"]).toContain('canon: "planned"');

    // The other PC: nothing of this book is there yet.
    const db = await getDb();
    await Promise.all(["books", "activities", "outbox"].map(store => db.clear(store)));
    const opened = await importGitHubBook(remote);
    expect(opened.id).toBe(book.id);
    expect(opened.status).toBe("paused"); // it was running elsewhere: never silently running here
    expect(opened.chapters.map(c => c.frozenAt !== undefined)).toEqual([true, false]);
    expect(opened.chapters[1]!.scenes.map(s => [s.id, s.status, s.text])).toEqual(chapter.scenes.map(s => [s.id, s.status, s.text]));
    expect(opened.editorialCycle).toEqual(book.editorialCycle);
    expect(opened.memory).toEqual(book.memory);
    expect(opened.knowledge).toEqual(book.knowledge);
    expect(opened.phase).toBe("chapterReview");
    expect((await db.getAll("activities")).map(a => a.id)).toEqual([task.id]);
  });

  it("l'identità non dipende dal titolo, ma distingue repository e ramo", async () => {
    const root = syntheticNarrarium["book.md"]!;
    const id = (await markdownIdentity(root, remote)).id;
    expect((await markdownIdentity(root.replace("Il porto di prova", "Altro titolo"), remote)).id).toBe(id);
    expect((await markdownIdentity(root, { ...remote, branch: "other" })).id).not.toBe(id);
    expect((await markdownIdentity(root, { ...remote, repository: "other" })).id).not.toBe(id);
  });

  it("preserva anche il BOM UTF-8 e gli a capo Windows senza falsare le impronte Git", async () => {
    const files = Object.fromEntries(Object.entries(syntheticNarrarium).map(([path, text]) => [path, "\uFEFF" + text.replace(/\n/g, "\r\n")]));
    await repository(files);
    const book = await importGitHubBook(remote);
    expect(book.markdownSource).toEqual(files);
    expect(book.chapters[0]!.scenes[0]!.text).toContain("\r\n\r\nIl vento si ferma.\r\n");
  });

  it("un log remoto con ID già usato non sovrascrive attività di altri libri né lascia un import parziale", async () => {
    const local = newBook("Locale", "Originale", "", ""), other = newBook("Remoto", "Altro libro", "", "");
    await saveBook(local);
    const activity = { id: crypto.randomUUID(), bookId: local.id, runId: crypto.randomUUID(), phase: "outline" as const,
      title: "Audit locale", reason: "Test", nextStep: "Rileggere", status: "succeeded" as const, createdAt: local.createdAt };
    await saveActivity(activity);
    const files = projectBook(other, []).files;
    files[".bookwriter/activities.json"] = JSON.stringify([{ ...activity, bookId: other.id, title: "Audit remoto" }]);
    await repository(files);
    await expect(importGitHubBook(remote)).rejects.toThrow(/identificatori già presenti/);
    expect((await listBooks()).map(b => b.id)).toEqual([local.id]);
    expect(await (await getDb()).get("activities", activity.id)).toEqual(activity);
  });

  it("il primo push esplicito dopo le verifiche conserva i documenti manuali e produce uno snapshot coerente", async () => {
    const api = await repository(syntheticNarrarium);
    const book = await importGitHubBook(remote);
    // Synthetic fixture for an already completed editorial process, not an import permission.
    book.chapters[0]!.frozenAt = "2026-11-14T12:00:00.000Z";
    await saveBook(book, false);
    await pushGitHubBook(book.id);
    expect(api.files()["reviews/sinossi-autore.md"]).toBe(syntheticNarrarium["reviews/sinossi-autore.md"]);
    expect(api.files()[".bookwriter/manifest.json"]).toContain('"markdownFormat": 3');
    const snapshot = await readGitHubSnapshot(remote);
    expect(snapshot?.book.chapters[0]!.scenes[0]!.text).toBe(book.chapters[0]!.scenes[0]!.text);
    expect(snapshot?.head).toBe(NEXT);
  });

  it("schede, eventi e timeline viaggiano nello snapshot GitHub; modifiche esterne o collegamenti falsi bloccano", async () => {
    const book = knowledgeBook();
    const files = projectBook(book, []).files;
    expect(Object.keys(files).filter(p => p.startsWith("schemas/"))).toHaveLength(8);
    // A repository pushed in format 2 (0.20–0.21) is still read as it is.
    await repository(projectBook(book, [], 2).files);
    expect((await readGitHubSnapshot(remote))!.book.knowledge).toEqual(book.knowledge);
    let api = await repository(files);
    const snapshot = await readGitHubSnapshot(remote);
    expect(snapshot!.book.knowledge).toEqual(book.knowledge);
    expect(api.calls.every(c => c.startsWith("GET "))).toBe(true);
    const edited = { ...files, "events/primo-indizio.md": files["events/primo-indizio.md"]!.replace("Una firma cancellata", "Una fotografia") };
    api = await repository(edited);
    await expect(readGitHubSnapshot(remote)).rejects.toThrow(/Markdown/);
    const project = JSON.parse(files[".bookwriter/project.json"]!);
    project.revision = { id: "r", instruction: "x", beforePhase: "prose", affectedSceneIds: [], cursor: 0, changeOperationId: crypto.randomUUID() };
    await repository({ ...files, ".bookwriter/project.json": JSON.stringify(project) });
    await expect(readGitHubSnapshot(remote)).rejects.toThrow(/modifica inesistente/);
    expect(await listBooks()).toEqual([]);
  });

  it.each(["scene", "new", "deleted", "state", "entity"])("non ignora Markdown %s diverso da un JSON precedente", async kind => {
    const book = newBook("Premessa", "Snapshot sintetico", "Stile", "Adulti");
    const files = projectBook(book, []).files;
    if (kind === "new" || kind === "scene") files[scenePath] = syntheticNarrarium[scenePath]!;
    if (kind === "deleted") delete files["book.md"];
    if (kind === "state") files["state/current.md"] += "Nuova memoria manuale.";
    if (kind === "entity") files["characters/nuovo.md"] = syntheticNarrarium["characters/mara.md"]!;
    const api = await repository(files);
    expect(await inspectGitHubDestination(remote)).toMatchObject({ kind: "divergent" });
    await expect(readGitHubSnapshot(remote)).rejects.toThrow(/Markdown/);
    expect(await listBooks()).toEqual([]);
    expect(api.calls.every(c => c.startsWith("GET "))).toBe(true);
  });

  it("rileva anche modifiche ai vecchi Markdown paragraph con manifest legacy", async () => {
    const book = newBook("Premessa", "Legacy", "Stile", "Adulti");
    const files = projectLegacyBook(book, []).files;
    files["book.md"] += "Modifica esterna.";
    await repository(files);
    await expect(readGitHubSnapshot(remote)).rejects.toThrow(/Markdown/);
  });

  it("legge ancora il profilo Markdown 1 e rileva note aggiunte senza ignorarle nel JSON", async () => {
    const book = newBook("Premessa", "Formato precedente", "Stile", "Adulti");
    const files = projectBook(book, [], 1).files;
    await repository(files);
    expect((await readGitHubSnapshot(remote))!.book.id).toBe(book.id);
    files["research/notes/new.md"] = "Una nota aggiunta a mano senza aggiornare il JSON.";
    await repository(files);
    await expect(readGitHubSnapshot(remote)).rejects.toThrow(/Markdown/);
  });

  it("una divergenza diventa una copia solo su richiesta: no snapshot, freeze, audit o consensi ereditati", async () => {
    const old = newBook("Locale", "Originale", "", ""); await saveBook(old);
    const files = { ...syntheticNarrarium, ".bookwriter/project.json": JSON.stringify(old) };
    const api = await repository(files);
    const before = await getBook(old.id);
    const copy = await importGitHubMarkdownCopy(remote, HEAD);
    expect(copy.id).not.toBe(old.id);
    expect(copy.title).toContain("copia Markdown");
    expect(copy.chapters[0]!.frozenAt).toBeUndefined();
    expect(copy.remote).toBeUndefined();
    expect(copy.narrativeKnowledgeShareDecisions).toBeUndefined();
    expect((await (await getDb()).getAll("activities"))).toEqual([]);
    expect(await getBook(old.id)).toEqual(before);
    expect(api.calls.every(c => c.startsWith("GET "))).toBe(true);
  });

  it.each([
    [".bookwriter/project.json", "{JSON non valido"],
    [".bookwriter/manifest.json", "{manifest non valido"],
  ])("un file interno corrotto %s non nasconde i Markdown: propone soltanto la copia confermata", async (path, content) => {
    await repository({ ...syntheticNarrarium, [path]: content });
    expect(await inspectGitHubDestination(remote)).toMatchObject({ kind: "divergent", title: "Il porto di prova" });
    await expect(importGitHubBook(remote)).rejects.toThrow();
    expect(await listBooks()).toEqual([]);
    const copy = await importGitHubMarkdownCopy(remote, HEAD);
    expect(copy.remote).toBeUndefined();
    expect(copy.chapters[0]!.scenes[0]!.text).toContain("Il vento si ferma.");
  });

  it.each([
    { truncated: true }, { mode: "120000" }, { moveHead: true }, { invalidUtf8: true },
  ])("fallisce senza scrivere con albero incompleto, link, HEAD cambiata o UTF-8 errato: %j", async options => {
    const api = await repository(syntheticNarrarium, options);
    await expect(importGitHubBook(remote, () => true, HEAD)).rejects.toThrow();
    expect(await listBooks()).toEqual([]);
    expect(api.calls.every(c => c.startsWith("GET "))).toBe(true);
  });

  it("scarta un'importazione superata prima del commit, senza creare copie", async () => {
    await repository(syntheticNarrarium);
    await expect(importGitHubBook(remote, () => false, HEAD)).rejects.toThrow(/superata/);
    await expect(importGitHubMarkdownCopy(remote, HEAD, () => false)).rejects.toThrow(/superata/);
    expect(await listBooks()).toEqual([]);
  });

  it("la deadline interrompe anche il body HTTP sospeso e non salva copie parziali", async () => {
    await repository(syntheticNarrarium);
    const fetch = globalThis.fetch;
    let started!: () => void;
    const bodyStarted = new Promise<void>(resolve => { started = resolve; });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).includes("/contents/book.md")) {
        started();
        return new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }));
      }
      return fetch(input, init);
    }));
    const pending = expect(importGitHubBook(remote)).rejects.toThrow(/Risposta GitHub incompleta/);
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(20_001);
    await pending;
    expect(await listBooks()).toEqual([]);
  });

  it("rifiuta Content-Length eccessivo prima di leggere il corpo", async () => {
    await repository(syntheticNarrarium);
    const fetch = globalThis.fetch;
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).includes("/contents/book.md")) return new Response(new ReadableStream({
        start: () => undefined, pull: () => { reads++; return new Promise(() => undefined); },
      }, { highWaterMark: 0 }), { headers: { "Content-Length": "999999999" } });
      return fetch(input, init);
    }));
    await expect(importGitHubBook(remote)).rejects.toThrow(/troppo grande/);
    expect(reads).toBe(0);
    expect(await listBooks()).toEqual([]);
  });

  it("conserva i documenti in ZIP content/full e rifiuta percorsi ostili nell'archivio", async () => {
    await repository(syntheticNarrarium);
    await importGitHubBook(remote);
    const zip = await createBackup("content");
    expect((await readBackup(zip as File)).books[0]!.markdownSource).toEqual(syntheticNarrarium);
    const full = await createBackup("full", "a-long-synthetic-password");
    expect((await readBackup(full as File, "a-long-synthetic-password")).books[0]!.markdownSource).toEqual(syntheticNarrarium);
    const parts = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const data = JSON.parse(strFromU8(parts["content.json"]!));
    data.books[0].markdownSource["../tools.py"] = "hostile";
    const hostile = new Blob([new Uint8Array(zipSync({ "manifest.json": parts["manifest.json"]!, "content.json": strToU8(JSON.stringify(data)) }))]) as File;
    await expect(readBackup(hostile)).rejects.toThrow(/Schema backup/);
  });
});
