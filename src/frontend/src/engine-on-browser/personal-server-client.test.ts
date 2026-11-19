import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { DEFAULT_SETTINGS, newBook } from "@engine/domain/types";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";
import { getDb, getBook, saveBook, saveActivity, saveSettings, recoverInterruptedRuns } from "../infrastructure/db";
import { encryptLocal } from "../infrastructure/crypto";
import { projectSettings } from "@engine/domain/cloud-profile";
import { host } from "@engine/core/host";
import {
  probePersonalServer, connectPersonalServer, syncServerBook, personalServerConnection,
  disconnectPersonalServer, sendServerCommand, reconcileServerCommand, SERVER_CONNECTION_KEY, replicaKey,
  createPersonalServerBook, pendingPersonalServerCreation, resumePersonalServerCreation,
  personalServerConfiguration, provisionPersonalServer, setPersonalServerBookPat,
} from "../infrastructure/personal-server-client";
import { withWriterGuard } from "@engine/application/writer-guard";
import { serverBookConfigFromBook, serverCommandDigestInput, type ServerCommandEnvelope, type ServerCommandReceipt } from "@engine/domain/personal-server";
import { serverCommandJournalKey, readServerCommandJournal } from "../infrastructure/personal-server-command-journal";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const serverId = crypto.randomUUID();
const secret = "test-server-secret-" + "x".repeat(50);
let remote = newBook("Sintetico", "Replica", "Chiaro", "Adulti");
let requests: Array<{ url: string; apikey: string | null }>;
let clientId: string, revision: number, nextSequence: number;
let onApi: ((url: URL, init: RequestInit) => Response | undefined | Promise<Response | undefined>) | undefined;
const answer = (data: unknown, headers = {}) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", ...headers } });
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta", "settings"]) await db.clear(store);
  requests = [];
  clientId = crypto.randomUUID(); revision = 1; nextSequence = 1; onApi = undefined;
  remote = newBook("Sintetico", "Replica", "Chiaro", "Adulti");
  remote.executionAuthority = { kind: "server", serverId, epoch: crypto.randomUUID() };
  remote.status = "running";
  vi.stubGlobal("fetch", vi.fn(async (raw: string, init: RequestInit) => {
    const url = new URL(raw);
    requests.push({ url: raw, apikey: new Headers(init.headers).get("apikey") });
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      return answer({ apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.31.0", bookFormatVersion: BOOK_FORMAT_VERSION,
        serverId, publicKey, fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") });
    }
    if (url.pathname === "/api/v1/session") return answer({ clientId, label: "Test", scopes: ["read", "run", "write"] });
    const override = await onApi?.(url, init);
    if (override) return override;
    return answer({ book: remote, activities: [], revision, nextSequence, retrySchedule: null, hasManualPushIntent: false },
      { ETag: `"${remote.executionAuthority!.epoch}:${revision}"` });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function connect() {
  const info = await probePersonalServer("https://server.example.org");
  await connectPersonalServer("https://server.example.org", secret, info);
  return (await personalServerConnection())!;
}
const receiptFor = (envelope: ServerCommandEnvelope, state: ServerCommandReceipt["state"] = "completed", result: unknown = { accepted: true }): ServerCommandReceipt =>
  ({ digest: createHash("sha256").update(serverCommandDigestInput(clientId, envelope)).digest("hex"), clientId,
    sequence: envelope.sequence, state, result });
async function journal() { return readServerCommandJournal(await (await getDb()).get("meta", serverCommandJournalKey(remote.id))); }
async function connectedReplica() { const connection = await connect(); await syncServerBook(connection, remote.id); return connection; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
describe("Replica del server: identità, fencing e isolamento", () => {
  it("verifica la firma prima del token; persiste soltanto il cifrato", async () => {
    const connection = await connect();
    expect(requests.filter(r => r.url.includes("/info")).every(r => r.apikey === null)).toBe(true);
    expect(requests.find(r => r.url.endsWith("/session"))?.apikey).toBe(secret);
    expect(JSON.stringify(connection)).not.toContain(secret);
    expect(requests.every(r => !r.url.includes(secret))).toBe(true);
    const altered = { ...connection, serverId: crypto.randomUUID() };
    await expect(probePersonalServer(connection.baseUrl, altered)).rejects.toThrow("Identità");
  });
  it("il cursore e la replica sono atomici, senza outbox/retry eseguibili né copie storiche inventate", async () => {
    const connection = await connect();
    await syncServerBook(connection, remote.id);
    const db = await getDb();
    expect((await getBook(remote.id))?.status).toBe("running");
    expect(await db.get("meta", replicaKey(remote.id))).toMatchObject({ revision: 1, serverId });
    expect(await db.getAll("outbox")).toHaveLength(0);
    expect((await db.getAllKeys("meta")).some(key => String(key).startsWith("task-book:") || String(key).startsWith("retry-schedule:"))).toBe(false);
    await expect(saveBook(remote, true, remote.updatedAt)).rejects.toThrow("replica");
    await expect(saveActivity({ id: crypto.randomUUID(), bookId: remote.id, runId: crypto.randomUUID(), phase: "brainstorm",
      title: "Non consentito", status: "running", reason: "", nextStep: "", createdAt: new Date().toISOString() })).rejects.toThrow("replica");
    await expect(host().transaction(remote.id, record => {
      record.activities.push({ id: crypto.randomUUID(), bookId: remote.id, runId: crypto.randomUUID(), phase: "brainstorm",
        title: "Non consentito", status: "succeeded", reason: "", nextStep: "", createdAt: new Date().toISOString() });
    }, { activities: true })).rejects.toThrow("replica");
    const action = vi.fn();
    await expect(withWriterGuard(remote.id, crypto.randomUUID(), new AbortController(), action)).rejects.toThrow("replica");
    expect(action).not.toHaveBeenCalled();
  });
  it("ID coincidente con libro locale: non lo sostituisce e non avanza il cursore", async () => {
    const local = { ...remote, executionAuthority: undefined, status: "paused" as const, title: "Lavoro dell'autore" };
    await saveBook(local, false);
    const connection = await connect();
    await expect(syncServerBook(connection, remote.id)).rejects.toThrow("preservato");
    expect((await getBook(remote.id))?.title).toBe("Lavoro dell'autore");
    expect(await (await getDb()).get("meta", replicaKey(remote.id))).toBeUndefined();
  });
  it("startup e disconnessione non pausano il server e non rendono eseguibile la replica", async () => {
    const connection = await connect();
    await syncServerBook(connection, remote.id);
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, action: (value: object) => unknown) => action({}) } });
    expect(await recoverInterruptedRuns()).toEqual([]);
    expect((await getBook(remote.id))?.status).toBe("running");
    await disconnectPersonalServer();
    expect(await (await getDb()).get("meta", SERVER_CONNECTION_KEY)).toBeUndefined();
    expect((await getBook(remote.id))?.executionAuthority?.serverId).toBe(serverId);
  });
});

describe("Creazione e impostazioni riviste prima dell'invio", () => {
  it("dopo un ACK perso reinvia la stessa creazione con il solo template e la conclude insieme alla replica", async () => {
    await connect();
    const source = newBook("PREMESSA_NON_DA_COPIARE", "Sorgente", "Stile", "Adulti");
    source.memory.secrets["RISERVATO"] = "Testo da non copiare";
    source.authorConstraints = ["VINCOLO_NON_DA_COPIARE"];
    source.editorialProfiles = { schemaVersion: 1, writers: [], readers: [{ id: "lettore", name: "Lettore personale",
      instructions: "Controlla il ritmo del dialogo.", enabled: true, role: "readerGenre" }] };
    source.modelRoutes = { audience: { endpointId: "openai", modelId: "custom" } };
    source.aiBudget = { enabled: true, enabledAt: "2000-01-01T00:00:00.000Z", limitEur: 20, maxOutputTokens: 256 };
    const bodies: string[] = [];
    onApi = async (url, init) => {
      if (url.pathname === "/api/v1/books" && init.method === "POST") {
        bodies.push(String(init.body));
        expect((await pendingPersonalServerCreation())?.commandId).toBe(JSON.parse(bodies[0]!).commandId);
        if (bodies.length === 1) throw new TypeError("Risposta sintetica persa");
        return answer({ bookId: remote.id });
      }
    };
    const input = { title: "Nuovo", brief: "Idea nuova", writingStyle: "Chiaro", audience: "Adulti", bookConfig: serverBookConfigFromBook(source) };
    await expect(createPersonalServerBook(input)).rejects.toThrow("non confermata");
    await expect(createPersonalServerBook(input)).rejects.toThrow("Esiste già una creazione");
    expect(await pendingPersonalServerCreation()).not.toBeUndefined();
    expect((await resumePersonalServerCreation()).id).toBe(remote.id);
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!).bookConfig).toMatchObject({ editorialProfiles: source.editorialProfiles, modelRoutes: source.modelRoutes });
    expect(bodies[0]).not.toMatch(/PREMESSA_NON_DA_COPIARE|VINCOLO_NON_DA_COPIARE|RISERVATO|enabledAt|executionAuthority/);
    expect(await pendingPersonalServerCreation()).toBeUndefined();
  });

  it("rifiuta il cambio di client nel riprendere una creazione", async () => {
    await connect();
    const input = { title: "Nuovo", brief: "Idea", writingStyle: "Chiaro", audience: "Adulti" };
    onApi = (url, init) => {
      if (url.pathname === "/api/v1/books" && init.method === "POST") throw new TypeError("Risposta sintetica persa");
      return undefined;
    };
    await expect(createPersonalServerBook(input)).rejects.toThrow();
    clientId = crypto.randomUUID(); await connect();
    await expect(resumePersonalServerCreation()).rejects.toThrow("stesso server e client");
    expect(requests.filter(r => r.url.endsWith("/api/v1/books"))).toHaveLength(1);
  });

  it("usa la revisione mostrata, non scrive bozze e la delega PAT non riscrive il router", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.githubToken = await encryptLocal("PAT sintetico");
    settings.endpoints[0]!.secret = await encryptLocal("Chiave sintetica");
    await saveSettings(settings);
    await connect();
    const writes: unknown[] = [];
    let remoteRevision = 3;
    onApi = (url, init) => {
      if (url.pathname === "/api/v1/settings" && init.method === "GET")
        return answer({ revision: remoteRevision, settings: projectSettings(settings), endpointKeys: [], githubBooks: [] }, { ETag: `"config:${remoteRevision}"` });
      if (init.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        if (new Headers(init.headers).get("If-Match") !== `"config:${remoteRevision}"`)
          return new Response("{}", { status: 412 });
        return answer({ revision: ++remoteRevision });
      }
    };
    const compared = await personalServerConfiguration();
    const draft = { ...settings, defaultRoute: { ...settings.defaultRoute, modelId: "non salvato" } };
    await expect(provisionPersonalServer(compared, draft, {})).rejects.toThrow("salvate sono cambiate");
    expect(writes).toHaveLength(0);
    remoteRevision++;
    await expect(provisionPersonalServer(compared, settings, { openai: "delegate" })).rejects.toMatchObject({ status: 412 });
    expect(requests.filter(r => r.url.endsWith("/settings")), "no new GET to silently replace the reviewed ETag").toHaveLength(2);
    const fresh = await personalServerConfiguration();
    await setPersonalServerBookPat(fresh, remote.id, "delegate", settings.githubToken);
    expect(writes[1]).toEqual({ consent: true, githubToken: "PAT sintetico" });
    expect(requests.at(-1)?.url).toContain(`/books/${remote.id}/github-credential`);
  });
});

describe("Comandi remoti durevoli senza replay", () => {
  it("prepara prima del POST e conferma ricevuta, replica e cursore nella stessa transazione", async () => {
    await connectedReplica();
    onApi = async (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        const envelope = JSON.parse(init.body as string) as ServerCommandEnvelope;
        expect((await journal()).entries).toHaveLength(1);
        expect((await journal()).entries[0]).toMatchObject({ state: "prepared", envelope });
        nextSequence++; revision++; remote.status = "paused";
        return answer(receiptFor(envelope));
      }
    };
    await sendServerCommand(remote.id, { type: "pause" });
    expect((await journal()).entries).toEqual([]);
    expect((await getBook(remote.id))?.status).toBe("paused");
    expect(await (await getDb()).get("meta", replicaKey(remote.id))).toMatchObject({ revision: 2, nextSequence: 2, clientId });
    expect(requests.filter(r => r.url.endsWith("/commands"))).toHaveLength(1);
  });
  it("ACK perso dopo l'accettazione: blocca il nuovo invio e recupera soltanto tramite GET", async () => {
    await connectedReplica();
    let receipt: ServerCommandReceipt | undefined;
    onApi = (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        receipt = receiptFor(JSON.parse(init.body as string)); nextSequence++; revision++; remote.status = "paused";
        throw new TypeError("Dropped response");
      }
      if (/\/commands\/[\w-]+$/.test(url.pathname)) return answer(receipt);
    };
    await expect(sendServerCommand(remote.id, { type: "pause" })).rejects.toThrow("non confermata");
    expect((await journal()).entries[0]?.state).toBe("prepared");
    await expect(sendServerCommand(remote.id, { type: "start" })).rejects.toThrow("precedente");
    const result = await reconcileServerCommand(remote.id);
    expect(result.completed).toBe(1);
    expect((await journal()).entries).toEqual([]);
    expect((await getBook(remote.id))?.status).toBe("paused");
    expect(requests.filter(r => r.url.endsWith("/commands"))).toHaveLength(1);
  });
  it("404 non elimina l'intento: solo la scelta distinta registra il rifiuto degli invii tardivi", async () => {
    await connectedReplica();
    let resolved = false;
    onApi = (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") throw new TypeError("Never reached server");
      if (url.pathname.endsWith("/resolve")) {
        resolved = true; nextSequence++; revision++;
        return answer(receiptFor(JSON.parse(init.body as string), "completed", { ok: false, code: "cancelled_before_acceptance" }));
      }
      if (/\/commands\/[\w-]+$/.test(url.pathname))
        return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    };
    await expect(sendServerCommand(remote.id, { type: "start" })).rejects.toThrow();
    await expect(reconcileServerCommand(remote.id)).rejects.toThrow("non prova");
    expect((await journal()).entries).toHaveLength(1); expect(resolved).toBe(false);
    expect(await reconcileServerCommand(remote.id, { cancelUnreceived: true })).toMatchObject({ completed: 1, cancelled: 1 });
    expect((await journal()).entries).toEqual([]);
    expect(requests.filter(r => r.url.endsWith("/commands"))).toHaveLength(1);
    expect(requests.filter(r => r.url.endsWith("/resolve"))).toHaveLength(1);
  });
  it("un rifiuto 4xx resta verificabile, senza eliminare il payload in base al solo HTTP", async () => {
    await connectedReplica();
    onApi = (url, init) => url.pathname.endsWith("/commands") && init.method === "POST"
      ? new Response("{}", { status: 412, headers: { "Content-Type": "application/json" } }) : undefined;
    await expect(sendServerCommand(remote.id, { type: "edit_memory", memoryId: "state", expectedStamp: "old", text: "Bozza da conservare." })).rejects.toThrow("Stato remoto cambiato");
    expect((await journal()).entries[0]?.envelope.command).toMatchObject({ text: "Bozza da conservare." });
  });
  it("due schede concorrenti prenotano un solo intento per la sequenza corrente", async () => {
    await connectedReplica();
    const entered = deferred<void>(), release = deferred<void>();
    onApi = async (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        entered.resolve(); await release.promise; nextSequence++; revision++;
        return answer(receiptFor(JSON.parse(init.body as string)));
      }
    };
    const calls = Promise.allSettled([sendServerCommand(remote.id, { type: "pause" }), sendServerCommand(remote.id, { type: "pause" })]);
    await entered.promise;
    release.resolve();
    const results = await calls;
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(requests.filter(r => r.url.endsWith("/commands"))).toHaveLength(1);
  });
  it("un effetto ancora accettato non impedisce Pausa; la sua ricevuta resta distinta", async () => {
    await connectedReplica();
    let first: ServerCommandEnvelope | undefined;
    onApi = (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        const envelope = JSON.parse(init.body as string) as ServerCommandEnvelope;
        nextSequence++; revision++;
        if (!first) { first = envelope; return answer(receiptFor(envelope, "accepted")); }
        remote.status = "paused"; return answer(receiptFor(envelope));
      }
      if (/\/commands\/[\w-]+$/.test(url.pathname)) return answer(receiptFor(first!));
    };
    await sendServerCommand(remote.id, { type: "save_github", consentPublic: false });
    expect((await journal()).entries[0]?.state).toBe("accepted");
    await sendServerCommand(remote.id, { type: "pause" });
    expect((await getBook(remote.id))?.status).toBe("paused");
    expect((await journal()).entries).toHaveLength(1);
    await reconcileServerCommand(remote.id);
    expect((await journal()).entries).toEqual([]);
    expect(requests.filter(r => r.url.endsWith("/commands"))).toHaveLength(2);
  });
  it("ricevuta estranea o snapshot precedente non eliminano l'intento né avanzano la replica", async () => {
    await connectedReplica();
    onApi = (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        nextSequence++; revision++; remote.status = "paused";
        return answer({ ...receiptFor(JSON.parse(init.body as string)), digest: "0".repeat(64) });
      }
    };
    await expect(sendServerCommand(remote.id, { type: "pause" })).rejects.toThrow("Ricevuta non coerente");
    expect((await journal()).entries[0]?.state).toBe("prepared");
    expect((await getBook(remote.id))?.status).toBe("running");
    expect(await (await getDb()).get("meta", replicaKey(remote.id))).toMatchObject({ revision: 1, nextSequence: 1 });
  });
  it("scollegamento durante il readback conserva il comando e impedisce l'ACK da una vecchia connessione", async () => {
    await connectedReplica();
    const readback = deferred<void>(), released = deferred<void>();
    onApi = async (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        nextSequence++; revision++; return answer(receiptFor(JSON.parse(init.body as string)));
      }
      if (url.pathname.endsWith("/snapshot")) { readback.resolve(); await released.promise; }
    };
    const pending = sendServerCommand(remote.id, { type: "pause" });
    const rejected = expect(pending).rejects.toThrow("connessione superata");
    await readback.promise; await disconnectPersonalServer(); released.resolve(); await rejected;
    expect((await journal()).entries).toHaveLength(1);
    expect(await (await getDb()).get("meta", replicaKey(remote.id))).toMatchObject({ revision: 1 });
  });
  it("un errore completato non viene presentato come successo e un esito incerto non viene ripetuto", async () => {
    await connectedReplica();
    let count = 0;
    onApi = (url, init) => {
      if (url.pathname.endsWith("/commands") && init.method === "POST") {
        nextSequence++; revision++; count++;
        return answer(receiptFor(JSON.parse(init.body as string), count === 1 ? "completed" : "uncertain",
          { ok: false, code: "operation_not_completed" }));
      }
    };
    await expect(sendServerCommand(remote.id, { type: "start" })).rejects.toThrow("non completato");
    expect((await journal()).entries).toEqual([]);
    await expect(sendServerCommand(remote.id, { type: "save_github", consentPublic: false })).rejects.toThrow("incerto");
    expect((await journal()).entries[0]?.state).toBe("uncertain");
    expect(requests.filter(r => r.url.endsWith("/commands"))).toHaveLength(2);
  });
  it("una busta oltre 64 KiB è rifiutata prima di prenotare sequenza o inviare dati", async () => {
    await connectedReplica();
    const before = requests.length;
    await expect(sendServerCommand(remote.id, { type: "edit_memory", memoryId: "state", expectedStamp: "x", text: "è".repeat(40_000) }))
      .rejects.toMatchObject({ status: 413 });
    expect((await journal()).entries).toEqual([]);
    expect(requests).toHaveLength(before);
  });
});

describe("Deadline del trasporto server", () => {
  it("interrompe un fetch che ignora AbortSignal e cancella una risposta arrivata dopo la scadenza", async () => {
    vi.useFakeTimers();
    const later = deferred<Response>(), cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => later.promise));
    const result = expect(probePersonalServer("https://server.example.org")).rejects.toThrow("non confermata");
    await vi.advanceTimersByTimeAsync(20_000); await result;
    later.resolve(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("la stessa deadline comprende anche una lettura del corpo bloccata", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }),
      { headers: { "Content-Type": "application/json" } })));
    const result = expect(probePersonalServer("https://server.example.org")).rejects.toThrow("non confermata");
    await vi.advanceTimersByTimeAsync(20_000); await result;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
