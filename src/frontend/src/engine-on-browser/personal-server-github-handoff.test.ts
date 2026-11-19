import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "@engine/domain/types";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";
import { serverGitHubHandoffDigestInput, type GitHubHandoffRequest } from "@engine/domain/personal-server";
import { encryptLocal } from "../infrastructure/crypto";
import { getBook, getDb, saveBook, saveSettings } from "../infrastructure/db";
import { connectPersonalServer, personalServerConnection, probePersonalServer, replicaKey } from "../infrastructure/personal-server-client";
import {
  beginPersonalServerHandoff, checkPersonalServerHandoff, handoffBlocker, pendingPersonalServerHandoff,
  sendPersonalServerHandoff, takeBackPersonalServerBook,
} from "../infrastructure/personal-server-handoff";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const serverId = crypto.randomUUID();
const secret = "test-server-secret-" + "x".repeat(50);
const HEAD = "a".repeat(40), RELEASED = "b".repeat(40);
const answer = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });

let clientId: string;
let received: GitHubHandoffRequest | undefined;
let dropNextAnswer: boolean;
let serverBook: BookProject | undefined;
let revision: number;

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta", "settings"]) await db.clear(store);
  clientId = crypto.randomUUID(); received = undefined; dropNextAnswer = false; serverBook = undefined; revision = 1;
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, cb: (lock: object) => unknown) => cb({}) } });
  vi.stubGlobal("fetch", vi.fn(async (raw: string, init: RequestInit = {}) => {
    const url = new URL(raw), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      return answer({ apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.34.0", bookFormatVersion: BOOK_FORMAT_VERSION,
        serverId, publicKey, fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") });
    }
    if (url.pathname === "/api/v1/session") return answer({ clientId, label: "Test", scopes: ["read", "write", "run"] });
    if (url.pathname === "/api/v1/handoffs/github" && method === "POST") {
      received = JSON.parse(init.body as string);
      if (dropNextAnswer) { dropNextAnswer = false; throw new TypeError("Risposta persa"); }
      return answer({ bookId: received!.bookId, markerPublished: true }, { status: 201 });
    }
    if (/\/commands\/[\w-]+$/.test(url.pathname)) {
      if (!received) return answer({}, { status: 404 });
      return answer({ digest: createHash("sha256").update(serverGitHubHandoffDigestInput(clientId, received)).digest("hex"),
        clientId, sequence: 1, state: "completed", result: { bookId: received.bookId, handoff: true } });
    }
    if (url.pathname.endsWith("/snapshot") && serverBook)
      return answer({ book: serverBook, activities: [], revision, nextSequence: 1, retrySchedule: null, hasManualPushIntent: false },
        { headers: { ETag: `"${serverBook.executionAuthority!.epoch}:${revision}"` } });
    return answer({}, { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function connected() {
  await connectPersonalServer("https://server.example.org", secret, await probePersonalServer("https://server.example.org"));
}
/** A local book already saved to GitHub: clean, with a confirmed commit. */
async function savedBook() {
  const book = newBook("Una storia sintetica.", "Libro su GitHub", "Chiaro", "Adulti");
  book.status = "paused";
  book.remote = { owner: "demo", repository: "faro", branch: "main", autoSync: false, allowPublicSync: false, lastSyncedCommit: HEAD };
  await saveBook(book, false);
  const stored = (await getBook(book.id))!;
  stored.remote = { ...stored.remote!, lastSyncedLocalUpdatedAt: stored.updatedAt };
  await (await getDb()).put("books", stored, stored.id);
  return stored;
}
const withPat = async () => saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal("pat-sintetico") });

describe("Affidare al server un libro già su GitHub", () => {
  it("rifiuta un libro non salvato, la delega mancante e un PAT non salvato, prima di toccare il libro", async () => {
    await connected(); await withPat();
    const book = await savedBook();
    await expect(beginPersonalServerHandoff(book.id, book.updatedAt)).rejects.toThrow("delegandogli il PAT");
    expect(handoffBlocker({ ...book, updatedAt: "2099-01-01T00:00:00.000Z" })).toContain("Salva prima");
    expect(handoffBlocker({ ...book, remote: { ...book.remote!, lastSyncedCommit: undefined } })).toContain("Salva prima");
    await (await getDb()).clear("settings");
    await expect(beginPersonalServerHandoff(book.id, book.updatedAt, { delegatePat: true })).rejects.toThrow("PAT");
    expect((await getBook(book.id))!.executionAuthority).toBeUndefined();
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
  });

  it("blocca il libro prima della rete, non invia il testo ma solo l'indicazione della repository, e riprende dopo una risposta persa", async () => {
    await connected(); await withPat();
    const book = await savedBook();
    const calls = () => (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const before = calls();
    const marker = await beginPersonalServerHandoff(book.id, book.updatedAt, { delegatePat: true });
    expect(calls()).toBe(before);
    expect(marker.github).toEqual({ owner: "demo", repository: "faro", branch: "main", expectedHead: HEAD, consentPublic: false });
    const locked = (await getBook(book.id))!;
    expect(locked.executionAuthority).toEqual({ kind: "server", serverId, epoch: marker.epoch });
    await expect(saveBook(locked, false, locked.updatedAt)).rejects.toThrow("replica");

    dropNextAnswer = true;
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow();
    expect(received).toMatchObject({ handoffId: marker.handoffId, epoch: marker.epoch, bookId: book.id, consent: true, githubToken: "pat-sintetico",
      github: { expectedHead: HEAD } });
    expect(JSON.stringify(received)).not.toContain("Una storia sintetica");
    expect(await pendingPersonalServerHandoff(book.id)).toEqual(marker);
    serverBook = { ...locked, remote: { ...locked.remote!, autoSync: false } };
    expect(await checkPersonalServerHandoff(book.id)).toBe("adopted");
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
    expect(JSON.stringify(await (await getDb()).get("meta", replicaKey(book.id)))).not.toContain("pat-sintetico");
  });
});

describe("Riprendere sul dispositivo un libro rilasciato dal server", () => {
  async function replica(released: boolean) {
    await connected(); await withPat();
    const book = await savedBook();
    const marker = await beginPersonalServerHandoff(book.id, book.updatedAt, { delegatePat: true });
    const locked = (await getBook(book.id))!;
    serverBook = { ...locked, ...(released ? { executionAuthority: { ...locked.executionAuthority!, releasedAt: new Date().toISOString(), releasedCommit: RELEASED } } : {}) };
    await sendPersonalServerHandoff(book.id);
    return { book, marker };
  }
  it("il libro torna locale, pulito rispetto alla versione rilasciata, senza traccia della replica", async () => {
    const { book } = await replica(true);
    expect((await getBook(book.id))!.executionAuthority?.releasedCommit).toBe(RELEASED);
    const back = await takeBackPersonalServerBook(book.id);
    expect(back.executionAuthority).toBeUndefined();
    const stored = (await getBook(book.id))!;
    expect(stored.executionAuthority).toBeUndefined();
    expect(stored.remote).toMatchObject({ lastSyncedCommit: RELEASED, autoSync: false, lastSyncedLocalUpdatedAt: stored.updatedAt });
    expect(await (await getDb()).get("meta", replicaKey(book.id))).toBeUndefined();
    await saveBook(stored, false, stored.updatedAt);
  });
  it("senza il rilascio del server non cambia nulla", async () => {
    const { book } = await replica(false);
    await expect(takeBackPersonalServerBook(book.id)).rejects.toThrow("non ha ancora rilasciato");
    expect((await getBook(book.id))!.executionAuthority?.serverId).toBe(serverId);
    expect(await (await getDb()).get("meta", replicaKey(book.id))).toBeDefined();
  });
});
