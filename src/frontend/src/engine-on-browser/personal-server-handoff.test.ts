import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { newBook, type BookProject } from "@engine/domain/types";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";
import { getDb, getBook, saveBook } from "../infrastructure/db";
import {
  probePersonalServer, connectPersonalServer, personalServerConnection, disconnectPersonalServer, replicaKey,
} from "../infrastructure/personal-server-client";
import {
  beginPersonalServerHandoff, sendPersonalServerHandoff, checkPersonalServerHandoff, cancelPersonalServerHandoff,
  pendingPersonalServerHandoff, handoffBlocker, handoffKey,
} from "../infrastructure/personal-server-handoff";
import { withWriterGuard } from "@engine/application/writer-guard";
import { serverHandoffDigestInput } from "@engine/domain/personal-server";
import { defaultWebResearchSettings } from "@engine/domain/web-research";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const serverId = crypto.randomUUID();
const secret = "test-server-secret-" + "x".repeat(50);
const answer = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });

let clientId: string;
let accepted: { handoffId: string; consent?: boolean; epoch: string; book: BookProject; activities: unknown[] } | undefined;
let cancelled: boolean;
let posts: number;
let dropNextAnswer: boolean;
let failResolve: boolean;
let held: Set<string>;

function installLocks() {
  held = new Set();
  vi.stubGlobal("navigator", { locks: { request: async (name: string, options: { ifAvailable?: boolean }, action: (lock: object | null) => unknown) => {
    if (held.has(name)) return options.ifAvailable ? action(null) : undefined;
    held.add(name);
    try { return await action({}); } finally { held.delete(name); }
  } } });
}
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  clientId = crypto.randomUUID(); accepted = undefined; cancelled = false; posts = 0; dropNextAnswer = false; failResolve = false;
  installLocks();
  vi.stubGlobal("fetch", vi.fn(async (raw: string, init: RequestInit = {}) => {
    const url = new URL(raw), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      return answer({ apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.31.0", bookFormatVersion: BOOK_FORMAT_VERSION,
        serverId, publicKey, fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") });
    }
    if (url.pathname === "/api/v1/session") return answer({ clientId, label: "Test", scopes: ["read", "write", "run"] });
    if (url.pathname === "/api/v1/handoffs" && method === "POST") {
      posts++;
      const body = JSON.parse(init.body as string);
      if (cancelled) return answer({ code: "handoff_cancelled" }, { status: 409 });
      accepted = body;
      if (dropNextAnswer) { dropNextAnswer = false; throw new TypeError("Dropped response"); }
      return answer({ bookId: body.book.id }, { status: 201 });
    }
    const resolve = /\/api\/v1\/handoffs\/([\w-]+)\/resolve$/.exec(url.pathname);
    if (resolve && method === "POST") {
      if (failResolve) throw new TypeError("Offline");
      const bookId = JSON.parse(init.body as string).bookId;
      if (accepted) return answer({ state: "adopted", bookId });
      cancelled = true; return answer({ state: "cancelled", bookId });
    }
    const receipt = /\/api\/v1\/books\/([\w-]+)\/commands\/([\w-]+)$/.exec(url.pathname);
    if (receipt) {
      if (!accepted) return answer({ code: "book_missing" }, { status: 404 });
      return answer({ digest: createHash("sha256").update(serverHandoffDigestInput(clientId, accepted)).digest("hex"),
        clientId, sequence: 1, state: "completed", result: { bookId: accepted.book.id, handoff: true } });
    }
    if (url.pathname.endsWith("/snapshot") && accepted)
      return answer({ book: accepted.book, activities: accepted.activities, revision: 1, nextSequence: 1, retrySchedule: null,
        hasManualPushIntent: false }, { headers: { ETag: `"${accepted.book.executionAuthority!.epoch}:1"` } });
    return answer({}, { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function connected() {
  await connectPersonalServer("https://server.example.org", secret, await probePersonalServer("https://server.example.org"));
  return (await personalServerConnection())!;
}
async function localBook(change: (book: BookProject) => void = () => undefined) {
  const book = newBook("Una storia sintetica.", "Libro locale", "Chiaro", "Adulti");
  book.status = "paused"; change(book);
  await saveBook(book, false);
  return (await getBook(book.id))!;
}
const store = async (name: string, key: string) => (await getDb()).get(name as "meta", key);

describe("Adozione di un libro locale: blocco prima dell'invio", () => {
  it("rende il libro una replica e registra l'intento nella stessa transazione, senza rete", async () => {
    await connected();
    const book = await localBook(b => { b.webResearch = defaultWebResearchSettings(new Date().toISOString()); });
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const marker = await beginPersonalServerHandoff(book.id, book.updatedAt);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
    const stored = (await getBook(book.id))!;
    expect(stored.executionAuthority).toEqual({ kind: "server", serverId, epoch: marker.epoch });
    expect(stored.webResearch?.enabled).toBe(false);
    expect(await pendingPersonalServerHandoff(book.id)).toEqual(marker);
    await expect(saveBook(stored, false, stored.updatedAt)).rejects.toThrow("replica");
    const action = vi.fn();
    await expect(withWriterGuard(book.id, crypto.randomUUID(), new AbortController(), action)).rejects.toThrow("replica");
    expect(action).not.toHaveBeenCalled();
    await expect(beginPersonalServerHandoff(book.id, book.updatedAt)).rejects.toThrow();
  });
  it("rifiuta GitHub, libro in esecuzione, tentativi aperti, code locali, revisione vecchia e connessione assente", async () => {
    await expect(beginPersonalServerHandoff(crypto.randomUUID(), new Date().toISOString())).rejects.toThrow("Ricollega");
    await connected();
    const github = await localBook(b => { b.remote = { owner: "o", repository: "r", branch: "main", autoSync: false }; });
    await expect(beginPersonalServerHandoff(github.id, github.updatedAt)).rejects.toThrow("GitHub");
    expect(handoffBlocker(github)).toContain("GitHub");
    const running = await localBook(b => { b.status = "running"; });
    await expect(beginPersonalServerHandoff(running.id, running.updatedAt)).rejects.toThrow("pausa");
    const open = await localBook();
    await (await getDb()).put("activities", { id: crypto.randomUUID(), bookId: open.id, runId: crypto.randomUUID(), phase: "brainstorm",
      title: "In corso", reason: "", nextStep: "", status: "running", createdAt: new Date().toISOString() }, "a1");
    await expect(beginPersonalServerHandoff(open.id, open.updatedAt)).rejects.toThrow("in corso");
    const queued = await localBook();
    await (await getDb()).put("meta", { any: true }, "retry-schedule:v1:" + queued.id);
    await expect(beginPersonalServerHandoff(queued.id, queued.updatedAt)).rejects.toThrow("retry");
    const stale = await localBook();
    await expect(beginPersonalServerHandoff(stale.id, "2000-01-01T00:00:00.000Z")).rejects.toThrow();
    for (const book of [github, running, open, queued, stale]) {
      expect((await getBook(book.id))?.executionAuthority).toBeUndefined();
      expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
    }
  });
  it("due avvii concorrenti: un solo intento", async () => {
    await connected();
    const book = await localBook();
    const results = await Promise.allSettled([
      beginPersonalServerHandoff(book.id, book.updatedAt), beginPersonalServerHandoff(book.id, book.updatedAt)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  });
  it("un'altra scheda che tiene il blocco di scrittura impedisce l'avvio", async () => {
    await connected();
    const book = await localBook();
    held.add("bookwriter:writer:" + book.id);
    await expect(beginPersonalServerHandoff(book.id, book.updatedAt)).rejects.toThrow("altra scheda");
    expect((await getBook(book.id))?.executionAuthority).toBeUndefined();
  });
});

describe("Invio, ricezione e annullamento", () => {
  it("invio riuscito: marcatore chiuso nella stessa transazione della replica", async () => {
    await connected();
    const book = await localBook();
    const marker = await beginPersonalServerHandoff(book.id, book.updatedAt);
    const replica = await sendPersonalServerHandoff(book.id);
    expect(replica.executionAuthority?.epoch).toBe(marker.epoch);
    expect(accepted?.consent).toBe(true);
    expect(accepted?.handoffId).toBe(marker.handoffId);
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
    expect(await store("meta", replicaKey(book.id))).toMatchObject({ revision: 1, epoch: marker.epoch });
  });
  it("risposta persa: il libro resta bloccato, il nuovo invio è idempotente e conclude senza duplicati", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    dropNextAnswer = true;
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow("non confermata");
    expect(await pendingPersonalServerHandoff(book.id)).toBeDefined();
    expect((await getBook(book.id))?.executionAuthority).toBeDefined();
    const first = JSON.stringify(accepted);
    await sendPersonalServerHandoff(book.id);
    expect(JSON.stringify(accepted)).toBe(first);
    expect(posts).toBe(2);
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
  });
  it("verifica ricezione: 404 non sblocca nulla; ricevuta con impronta esatta chiude il trasferimento", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    expect(await checkPersonalServerHandoff(book.id)).toBe("not_received");
    expect(await pendingPersonalServerHandoff(book.id)).toBeDefined();
    dropNextAnswer = true;
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow();
    expect(await checkPersonalServerHandoff(book.id)).toBe("adopted");
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
  });
  it("ricevuta con impronta diversa: nulla viene approvato", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    dropNextAnswer = true;
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow();
    accepted = { ...accepted!, book: { ...accepted!.book, title: "Altro testo" } };
    await expect(checkPersonalServerHandoff(book.id)).rejects.toThrow("non coerente");
    expect(await pendingPersonalServerHandoff(book.id)).toBeDefined();
  });
  it("annullamento: il server registra il rifiuto, poi il libro torna modificabile; un invio tardivo viene respinto", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    expect(await cancelPersonalServerHandoff(book.id)).toBe("cancelled");
    expect(cancelled).toBe(true);
    const unlocked = (await getBook(book.id))!;
    expect(unlocked.executionAuthority).toBeUndefined();
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
    await saveBook({ ...unlocked, title: "Di nuovo modificabile" }, false, unlocked.updatedAt);
    expect((await getBook(book.id))?.title).toBe("Di nuovo modificabile");
    expect(await store("meta", handoffKey(book.id))).toBeUndefined();
  });
  it("annullamento con server irraggiungibile o già accettato: il libro non viene mai sbloccato", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    failResolve = true;
    await expect(cancelPersonalServerHandoff(book.id)).rejects.toThrow();
    expect((await getBook(book.id))?.executionAuthority).toBeDefined();
    expect(await pendingPersonalServerHandoff(book.id)).toBeDefined();
    failResolve = false; dropNextAnswer = true;
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow();
    expect(await cancelPersonalServerHandoff(book.id)).toBe("adopted");
    expect((await getBook(book.id))?.executionAuthority?.serverId).toBe(serverId);
    expect(await pendingPersonalServerHandoff(book.id)).toBeUndefined();
  });
  it("un'altra connessione non può inviare o annullare: libro e intento restano intatti", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    await disconnectPersonalServer();
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow("connessione");
    clientId = crypto.randomUUID();
    await connected();
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow("altra connessione");
    await expect(cancelPersonalServerHandoff(book.id)).rejects.toThrow("altra connessione");
    expect(posts).toBe(0);
    expect(await pendingPersonalServerHandoff(book.id)).toBeDefined();
    expect((await getBook(book.id))?.executionAuthority).toBeDefined();
  });
  it("un registro illeggibile non sblocca e non invia", async () => {
    await connected();
    const book = await localBook();
    await beginPersonalServerHandoff(book.id, book.updatedAt);
    await (await getDb()).put("meta", { version: 2, junk: true }, handoffKey(book.id));
    await expect(sendPersonalServerHandoff(book.id)).rejects.toThrow("non verificabile");
    await expect(cancelPersonalServerHandoff(book.id)).rejects.toThrow("non verificabile");
    expect(posts).toBe(0);
    expect((await getBook(book.id))?.executionAuthority).toBeDefined();
  });
});
