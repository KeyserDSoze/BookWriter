import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject, type Activity } from "../domain/types";
import { encryptLocal } from "./crypto";
import { getDb, getBook, listBooks, listActivities, saveBook, saveActivity, saveSettings } from "./db";
import { getOutbox } from "./outbox";
import {
  inspectBookConflict, applyBookConflictResolution, preserveRemoteVersion,
} from "./conflict-recovery";
import { RemoteConflict } from "./github-sync";
import { getSceneMergeDraft, rejectSceneMergeDraft, saveManualSceneMergeDraft } from "../application/scene-merge";

const BASE = "a".repeat(40), HEAD = "b".repeat(40), NEXT = "c".repeat(40);
const PAT = "github_pat_mock_for_conflict_test_2026";
const REMOTE = { owner: "test-owner", repository: "book-repo", branch: "main" };
function encode(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}
function githubSnapshots(base: BookProject, remote: BookProject) {
  let head = HEAD;
  const calls: Array<{ method: string; path: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    calls.push({ method, path });
    expect(url.origin).toBe("https://api.github.com");
    expect(init?.redirect).toBe("error");
    if (path.endsWith("/git/ref/heads/main")) return reply({ object: { sha: head } });
    const content = url.searchParams.get("ref") === BASE ? base : remote;
    if (path.endsWith("/contents/.bookwriter/project.json")) {
      return reply({ type: "file", encoding: "base64", content: encode(JSON.stringify(content)) });
    }
    if (path.endsWith("/contents/.bookwriter/activities.json")) {
      const remoteActivity: Activity = {
        id: crypto.randomUUID(), bookId: content.id, runId: crypto.randomUUID(),
        phase: "review", title: "Review remota", reason: "Test",
        nextStep: "Continuare", status: "succeeded", createdAt: new Date().toISOString(),
      };
      return reply({ type: "file", encoding: "base64",
        content: encode(JSON.stringify([remoteActivity])) });
    }
    return reply({ message: "Unexpected" }, 500);
  }));
  return {
    calls,
    changeHead() { head = NEXT; },
  };
}
async function originalBook() {
  const book = newBook("Premessa locale", "Un libro", "Energico", "Adulti");
  book.status = "paused";
  book.remote = { ...REMOTE, lastSyncedCommit: BASE, autoSync: true,
    lastSyncedLocalUpdatedAt: book.updatedAt };
  book.chapters = [{
    id: "chapter:001", number: 1, title: "Primo capitolo",
    purpose: "Scoprire il mondo",
    scenes: [{
      id: "scene:001:001", number: 1, title: "Il passaggio",
      objective: "Entrare in città", text: "Testo originale locale.",
      status: "canon",
    }],
  }];
  book.memory.secrets.identita = "Il protagonista conosce il segreto";
  await saveBook(book, false);
  const activity: Activity = {
    id: crypto.randomUUID(), bookId: book.id, runId: crypto.randomUUID(),
    phase: "prose", title: "Scrittura originale", reason: "Libro",
    nextStep: "Revisione", status: "succeeded", createdAt: new Date().toISOString(),
  };
  await saveActivity(activity);
  return book;
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox"); await db.clear("mergeDrafts");
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.githubToken = await encryptLocal(PAT);
  await saveSettings(settings);
  vi.stubGlobal("navigator", {
    locks: { request: async (_name: string, _options: unknown,
      fn: (lock: object) => Promise<unknown>) => fn({ name: "mock-lock" }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Recupero narrativo non distruttivo", () => {
  it("legge baseline e remoto senza scritture, confronta le scene e salva il remoto separatamente", async () => {
    const book = await originalBook();
    const base = structuredClone(book);
    const remote = structuredClone(book);
    remote.chapters[0]!.scenes[0]!.text = "Testo GitHub modificato.";
    remote.memory.secrets.identita = "La verità è nota solo all'antagonista.";
    const github = githubSnapshots(base, remote);
    const review = await inspectBookConflict(book.id);
    expect(review.baseAvailable).toBe(true);
    expect(review.headSha).toBe(HEAD);
    expect(review.units.find(x => x.kind === "scene")?.origin).toBe("only-remote");
    expect(await listBooks()).toHaveLength(1);
    const copyId = await preserveRemoteVersion(review);
    const copy = await getBook(copyId);
    expect(copy?.remote).toBeUndefined();
    expect(copy?.chapters[0]!.scenes[0]!.text).toBe("Testo GitHub modificato.");
    expect((await listActivities(copyId)).length).toBe(1);
    expect((await getBook(book.id))?.chapters[0]!.scenes[0]!.text).toBe("Testo originale locale.");
    expect(github.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("crea entrambi i backup e applica solo le scelte selezionate senza push GitHub", async () => {
    const book = await originalBook();
    // A previously pending autosync is invalidated after explicit conflict resolution.
    await saveBook(book);
    expect(await getOutbox(book.id)).toBeDefined();
    const base = structuredClone(book);
    const remote = structuredClone(book);
    remote.chapters[0]!.scenes[0]!.text = "Scena versione remota.";
    remote.memory.secrets.identita = "Versione remota del segreto.";
    const github = githubSnapshots(base, remote);
    const review = await inspectBookConflict(book.id);
    const scene = review.units.find(x => x.kind === "scene")!;
    const result = await applyBookConflictResolution(review, { [scene.id]: "remote" });
    const merged = await getBook(book.id);
    expect(merged?.chapters[0]!.scenes[0]!.text).toBe("Scena versione remota.");
    expect(merged?.memory.secrets.identita).toBe("Il protagonista conosce il segreto");
    expect(merged?.remote?.lastSyncedCommit).toBe(HEAD);
    expect(merged?.remote?.autoSync).toBe(false);
    expect(merged?.status).toBe("paused");
    expect((await getBook(result.localBackupId))?.chapters[0]!.scenes[0]!.text)
      .toBe("Testo originale locale.");
    expect((await getBook(result.remoteBackupId))?.memory.secrets.identita)
      .toBe("Versione remota del segreto.");
    expect((await getBook(result.remoteBackupId))?.remote).toBeUndefined();
    expect((await listActivities(result.localBackupId)).length).toBe(1);
    expect((await listActivities(result.remoteBackupId)).length).toBe(1);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(x => /Risoluzione manuale/.test(x.title))).toBe(true);
    expect(github.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("applica solo una proposta approvata come BOZZA, conservando le versioni originali", async () => {
    const book = await originalBook();
    const base = structuredClone(book);
    const remote = structuredClone(book);
    remote.chapters[0]!.scenes[0]!.text = "Scena remota differente.";
    const github = githubSnapshots(base, remote);
    const review = await inspectBookConflict(book.id);
    const scene = review.units.find(u => u.kind === "scene")!;
    const draft = await saveManualSceneMergeDraft(
      review, "chapter:001", "scene:001:001", "Testo proposto fra due versioni.",
    );
    expect((await getBook(book.id))?.chapters[0]?.scenes[0]?.status).toBe("canon");
    const result = await applyBookConflictResolution(
      review, { [scene.id]: "proposal" },
      { [scene.id]: { draftId: draft.id, text: "Testo proposto corretto dall'autore." } },
    );
    const merged = await getBook(book.id);
    expect(merged?.chapters[0]?.scenes[0]?.text).toBe("Testo proposto corretto dall'autore.");
    expect(merged?.chapters[0]?.scenes[0]?.status).toBe("draft");
    expect(merged?.chapters[0]?.scenes[0]?.summary).toBeUndefined();
    expect(merged?.remote?.autoSync).toBe(false);
    expect((await getBook(result.localBackupId))?.chapters[0]?.scenes[0]?.text).toBe("Testo originale locale.");
    expect((await getBook(result.remoteBackupId))?.chapters[0]?.scenes[0]?.text).toBe("Scena remota differente.");
    expect((await getSceneMergeDraft(draft.id))?.status).toBe("accepted");
    expect((await getSceneMergeDraft(draft.id))?.acceptedText).toBe("Testo proposto corretto dall'autore.");
    expect(github.calls.every(request => request.method === "GET")).toBe(true);
  });

  it("non accetta una bozza rifiutata e non crea alcuna copia in caso di errore", async () => {
    const book = await originalBook();
    const remote = structuredClone(book);
    remote.chapters[0]!.scenes[0]!.text = "La scena GitHub";
    githubSnapshots(structuredClone(book), remote);
    const review = await inspectBookConflict(book.id);
    const scene = review.units.find(u => u.kind === "scene")!;
    const draft = await saveManualSceneMergeDraft(review, "chapter:001", "scene:001:001", "Bozza da rifiutare");
    await rejectSceneMergeDraft(draft.id);
    await expect(applyBookConflictResolution(
      review, { [scene.id]: "proposal" },
      { [scene.id]: { draftId: draft.id, text: "Prova non autorizzata" } },
    )).rejects.toThrow(/bozza/i);
    expect(await listBooks()).toHaveLength(1);
    expect((await getBook(book.id))?.chapters[0]?.scenes[0]?.text).toBe("Testo originale locale.");
  });

  it("blocca l'applicazione se il commit GitHub è cambiato, lasciando intatto il libro", async () => {
    const book = await originalBook();
    const source = structuredClone(book);
    const github = githubSnapshots(source, { ...structuredClone(book), brief: "Brief remoto" });
    const review = await inspectBookConflict(book.id);
    github.changeHead();
    await expect(applyBookConflictResolution(review, {})).rejects.toBeInstanceOf(RemoteConflict);
    expect(await listBooks()).toHaveLength(1);
    expect((await getBook(book.id))?.brief).toBe("Premessa locale");
  });

  it("blocca l'applicazione se il libro locale è stato modificato dopo il confronto", async () => {
    const book = await originalBook();
    githubSnapshots(structuredClone(book), { ...structuredClone(book), brief: "Brief remoto" });
    const review = await inspectBookConflict(book.id);
    const changed = await getBook(book.id);
    changed!.brief = "Una nuova correzione dell'autore";
    await saveBook(changed!, false);
    await expect(applyBookConflictResolution(review, {})).rejects.toBeInstanceOf(RemoteConflict);
    expect(await listBooks()).toHaveLength(1);
    expect((await getBook(book.id))?.brief).toBe("Una nuova correzione dell'autore");
  });

  it("rifiuta una repository che contiene il libro di un altro autore", async () => {
    const book = await originalBook();
    const other = newBook("Altro libro", "Altro", "", "");
    githubSnapshots(other, other);
    await expect(inspectBookConflict(book.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect(await listBooks()).toHaveLength(1);
  });
  it("rifiuta ripristino mentre il lock di una scheda concorrente è occupato", async () => {
    const book = await originalBook();
    githubSnapshots(structuredClone(book), { ...structuredClone(book), brief: "Testo remoto" });
    const review = await inspectBookConflict(book.id);
    vi.stubGlobal("navigator", {
      locks: { request: async (_name: string, _options: unknown,
        callback: (lock: null) => Promise<unknown>) => callback(null) },
    });
    await expect(applyBookConflictResolution(review, {})).rejects.toBeInstanceOf(RemoteConflict);
    expect(await listBooks()).toHaveLength(1);
  });

});
