import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { generateKeyPairSync, createPrivateKey, createHash, sign, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import {
  z, serverScopeSchema, cloudSettingsSchema, normalizeServerUrl, SERVER_API_VERSION,
  handoffRequestSchema, githubHandoffRequestSchema, handoffResolveSchema, serverBookCreationInputSchema,
  serverUpdateRequestSchema, installHostRuntime, type HostBookRecord, type BookProject,
  readGitHubExecutionAuthority, subscribeLiveAi, currentLiveAi,
} from "@engine/index";
import frontendPackage from "../../frontend/package.json";
import serverPackage from "../package.json";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";
import { normalizeEndpoint } from "@engine/infrastructure/ai";
import { FileBookStore, atomicJson, readJson, unsafeKeys, MAX_FILE_BYTES } from "./files";
import { Vault } from "./vault";
import { createRuntime } from "./runtime";
import { GitWorkspaces, type GitWorkspaceOptions } from "./git";
import { Controller, bookEtag } from "./controller";
import { Auth, type Client } from "./auth";
import { ApiError, badRequest } from "./errors";
import { CloudflareTunnelManager } from "./tunnel";
import { RuntimeInstaller } from "./runtime-install";
import { checkNpmServerRelease } from "./npm-release";
import { ADMIN_HTML, ADMIN_JS, ADMIN_CSS } from "./ui";

const installationSchema = z.object({
  version: z.literal(1), serverId: z.string().uuid(), publicKey: z.string().max(256),
  privateKey: z.object({ iv: z.string(), data: z.string() }).strict(),
  allowedAiBases: z.array(z.string().max(500)).max(50),
  origins: z.array(z.string().max(500)).max(20),
  publicUrl: z.string().max(500).optional(),
  adminPublicUrl: z.string().max(500).optional(),
  /** Remote admin is expected through a separately routed Cloudflare hostname; loopback remains available. */
  allowRemoteAdmin: z.boolean().optional().default(true),
}).strict();
const uuid = z.string().uuid();
const secretText = z.string().min(1).max(4096);
const tunnelToken = z.string().min(1).max(4096).refine(value => !/[\r\n\0]/.test(value), "Token non valido.");
const tunnelHostname = z.string().max(500).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, "Hostname HTTPS non valido.");
const tunnelConfigureSchema = z.object({ token: tunnelToken, hostname: tunnelHostname.optional() }).strict();
const createSchema = z.strictObject({ commandId: uuid, ...serverBookCreationInputSchema.shape });
const provisionSchema = z.object({
  consent: z.literal(true), settings: cloudSettingsSchema,
  endpointKeys: z.record(z.string().max(100), secretText.nullable()).refine(v => Object.keys(v).length <= 50),
  bookId: uuid.optional(), githubToken: z.string().min(1).max(600).nullable().optional(),
}).strict();

export interface ServerOptions {
  root: string; adminPort?: number; apiPort?: number;
  /** Git working copies for GitHub (default: used when git ≥ 2.32 is installed, otherwise the REST API). `false` forces REST. */
  git?: false | Pick<GitWorkspaceOptions, "binary" | "urlFor" | "allowFileProtocol">;
}
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}
async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) throw badRequest();
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw badRequest();
  const length = req.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > max)) throw new ApiError(413, "size", "Richiesta oltre il limite.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  const timer = setTimeout(() => req.destroy(), max > 1024 * 1024 ? 120_000 : 20_000);
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > max) throw new ApiError(413, "size", "Richiesta oltre il limite.");
      chunks.push(chunk);
    }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (unsafeKeys(raw)) throw badRequest();
    return raw;
  } catch (error) { if (error instanceof ApiError) throw error; throw badRequest(); }
  finally { clearTimeout(timer); }
}
const header = (req: IncomingMessage, key: string): string | undefined => {
  const value = req.headers[key]; return typeof value === "string" ? value : undefined;
};
function addressPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta non confermata.");
  return address.port;
}
async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((accept, reject) => {
    server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); accept(); });
  });
  return addressPort(server);
}

/** The executable acquires the OS root lock BEFORE calling this. Tests do the same. */
export async function startPersonalServer(options: ServerOptions) {
  const store = new FileBookStore(options.root);
  const vault = await Vault.open(options.root);
  const installationPath = join(options.root, "installation.json");
  const saved = await readJson(installationPath, 1024 * 1024);
  let installation: z.infer<typeof installationSchema>;
  if (saved === undefined) {
    const keys = generateKeyPairSync("ed25519");
    installation = { version: 1, serverId: crypto.randomUUID(),
      publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"), allowRemoteAdmin: true,
      privateKey: await vault.encrypt(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
      allowedAiBases: [], origins: ["https://ghostwriting.ws"] };
    await atomicJson(installationPath, installation);
  } else installation = installationSchema.parse(saved);
  const fingerprint = createHash("sha256").update(Buffer.from(installation.publicKey, "base64")).digest("hex");
  const privateKey = createPrivateKey(await vault.decrypt(installation.privateKey));
  const auth = await Auth.open(store, vault);
  let workspaces: GitWorkspaces | undefined;
  let gitStatus: { mode: "git" | "rest"; version?: string; reason?: string } = { mode: "rest", reason: "disattivato" };
  if (options.git !== false) {
    try {
      const { version } = await GitWorkspaces.probe(options.git?.binary);
      workspaces = new GitWorkspaces({ root: options.root, ...options.git });
      gitStatus = { mode: "git", version };
    } catch (error) { gitStatus = { mode: "rest", reason: error instanceof Error ? error.message : "git non disponibile" }; }
  }
  // The installed runtime is the only global host; no fake browser database.
  const host = await createRuntime(store, vault, {
    serverId: installation.serverId, ...(workspaces ? { git: workspaces.transport } : {}),
    assertAuthority: async (book, signal) => {
      if (!book.remote) return;
      if (!book.remote.lastSyncedCommit)
        throw new Error("Effettua e conferma il primo salvataggio GitHub prima di avviare AI.");
      const remote = await readGitHubExecutionAuthority(book.remote, signal);
      if (remote.bookId !== book.id || remote.authority.serverId !== installation.serverId ||
          remote.authority.epoch !== book.executionAuthority?.epoch)
        throw new Error("Autorità GitHub non confermata: il server non avvia richieste AI.");
      // A pull-type merge waiting for a decision legitimately has a newer head: the one it was started against.
      const pulling = book.mergeSession?.kind === "pull" && remote.head === book.mergeSession.theirsCommit;
      if (remote.head !== book.remote.lastSyncedCommit && !pulling) {
        // Our autosync may have acknowledged its commit while the proof was being read.
        const latest = (await store.read(book.id))?.book;
        if (latest?.executionAuthority?.serverId !== installation.serverId ||
            latest.executionAuthority.epoch !== remote.authority.epoch || latest.remote?.lastSyncedCommit !== remote.head ||
            latest.remote.owner !== book.remote.owner || latest.remote.repository !== book.remote.repository || latest.remote.branch !== book.remote.branch)
          throw new Error("La baseline GitHub è cambiata o non è confermata: nessuna nuova richiesta AI.");
      }
    },
  });
  const controller = new Controller(store, host.runtime, installation.serverId, client => auth.isCurrent(client),
    { stage: host.stageBookPat, drop: host.dropBookPat, revoke: host.revokeBookPat });
  try { await controller.recover(); } catch (error) { host.dispose(); throw error; }
  const tunnelManager = new CloudflareTunnelManager({ root: options.root });
  // A connector failure is visible in the local admin panel but never prevents the BookWriter server from starting.
  try { await tunnelManager.start(); } catch { /* The manager stores only fixed, public failure messages. */ }
  const streams = new Set<() => void>();
  const commits = new Set<(id: string) => void>();
  store.onCommit = id => { for (const onCommit of commits) onCommit(id); };
  let apiPort = options.apiPort ?? 24106;
  let adminPort = options.adminPort ?? 24105;
  const limits = new Map<string, { window: number; count: number }>();
  const limit = (key: string, max: number) => {
    let state = limits.get(key);
    if (!state || Date.now() - state.window >= 60_000) { state = { window: Date.now(), count: 0 }; limits.set(key, state); }
    if (++state.count > max) throw new ApiError(429, "rate_limit", "Troppe richieste: attendi prima di riprovare.");
  };
  const common = (res: ServerResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  };
  const failure = (res: ServerResponse, error: unknown) => {
    if (res.headersSent) { res.end(); return; }
    const apiError = error instanceof ApiError ? error :
      error instanceof z.ZodError ? badRequest() :
      new ApiError(503, "operation_failed", "Operazione non completata: controlla lo stato prima di riprovare. Nessun dato troncato.");
    // Do not leave a rejected/oversized unread upload on a keep-alive socket.
    res.setHeader("Connection", "close");
    json(res, apiError.status, { code: apiError.code, message: apiError.message });
  };
  const getRecord = async (id: string) => {
    uuid.parse(id);
    const record = await store.read(id);
    if (!record) throw new ApiError(404, "book_missing", "Libro non trovato.");
    return record;
  };
  const api = createServer((req, res) => {
    common(res);
    void (async () => {
      const allowedHosts = [`127.0.0.1:${apiPort}`, `localhost:${apiPort}`,
        ...(installation.publicUrl ? [new URL(installation.publicUrl).host] : [])];
      if (!allowedHosts.includes(req.headers.host ?? "")) throw new ApiError(403, "host", "Host API non autorizzato.");
      const origin = req.headers.origin;
      if (origin && !installation.origins.includes(origin)) throw new ApiError(403, "origin", "Origine non autorizzata.");
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Expose-Headers", "ETag");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Headers": "apikey, Content-Type, If-Match, Last-Event-ID",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "300" }); res.end(); return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/v1/info" && req.method === "GET") {
        limit("info", 600);
        const nonce = z.string().regex(/^[a-f0-9]{64}$/).parse(url.searchParams.get("nonce"));
        const message = nonce + "\n" + installation.serverId + "\n" + installation.publicKey;
        json(res, 200, { apiVersion: SERVER_API_VERSION, serverVersion: serverPackage.version,
          engineVersion: frontendPackage.version, bookFormatVersion: BOOK_FORMAT_VERSION,
          serverId: installation.serverId, publicKey: installation.publicKey, fingerprint,
          nonce, signature: sign(null, Buffer.from(message), privateKey).toString("base64") });
        return;
      }
      if (url.pathname === "/api/v1/pairings" && req.method === "POST") {
        limit("pair", 30);
        const body = z.object({ code: z.string().regex(/^\d{9}$/), nonce: z.string().regex(/^[a-f0-9]{64}$/),
          label: z.string().min(1).max(80) }).strict().parse(await readBody(req, 4096));
        json(res, 200, await auth.requestPairing(body.code, body.nonce, body.label)); return;
      }
      if (/^\/api\/v1\/pairings\/[a-f0-9-]+\/result$/.test(url.pathname) && req.method === "POST") {
        limit("pair_result", 120);
        const id = uuid.parse(url.pathname.split("/")[4]);
        const body = z.object({ nonce: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await readBody(req, 4096));
        json(res, 200, await auth.pollPairing(id, body.nonce)); return;
      }
      const client = auth.authenticate(header(req, "apikey"));
      limit("authenticated", 600);
      const requireScope = (scope: "read" | "write" | "run" | "update") => {
        auth.authenticate(header(req, "apikey"), scope);
        if (!auth.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato.");
      };
      const configurationRevision = () => {
        const expected = /^"config:(\d+)"$/.exec(header(req, "if-match") ?? "");
        if (!expected || !Number.isSafeInteger(Number(expected[1])))
          throw new ApiError(412, "revision", "Versione delle impostazioni richiesta.");
        return Number(expected[1]);
      };
      if (url.pathname === "/api/v1/session" && req.method === "GET") {
        json(res, 200, { clientId: client.id, label: client.label, scopes: client.scopes }); return;
      }
      if (url.pathname === "/api/v1/books" && req.method === "GET") {
        requireScope("read");
        const cursor = url.searchParams.get("cursor");
        if (cursor) uuid.parse(cursor);
        const ids = (await store.ids()).filter(id => !cursor || id > cursor);
        const books = [];
        for (const id of ids.slice(0, 100)) {
          const record = await getRecord(id);
          books.push({ bookId: record.book.id, title: record.book.title,
            status: record.book.status, epoch: record.book.executionAuthority!.epoch, revision: record.revision,
            ...(record.book.executionAuthority!.releasedAt ? { released: true } : {}) });
        }
        requireScope("read");
        json(res, 200, { books, nextCursor: ids.length > 100 ? ids[99] : null }); return;
      }
      if (url.pathname === "/api/v1/books" && req.method === "POST") {
        requireScope("write");
        const body = createSchema.parse(await readBody(req, 1024 * 1024));
        requireScope("write");
        json(res, 201, { bookId: await controller.create(client, body.commandId, body) }); return;
      }
      if (url.pathname === "/api/v1/handoffs/github" && req.method === "POST") {
        requireScope("write");
        const body = githubHandoffRequestSchema.parse(await readBody(req, 16_384));
        requireScope("write");
        json(res, 201, await controller.adoptGitHub(client, body)); return;
      }
      if (url.pathname === "/api/v1/handoffs" && req.method === "POST") {
        requireScope("write");
        const body = handoffRequestSchema.parse(await readBody(req, MAX_FILE_BYTES));
        requireScope("write");
        json(res, 201, { bookId: await controller.adopt(client, body) }); return;
      }
      const handoffRoute = /^\/api\/v1\/handoffs\/([a-f0-9-]+)\/resolve$/.exec(url.pathname);
      if (handoffRoute && req.method === "POST") {
        requireScope("write");
        const body = handoffResolveSchema.parse(await readBody(req, 4096));
        json(res, 200, await controller.cancelHandoff(client, uuid.parse(handoffRoute[1]), body.bookId)); return;
      }
      const bookRoute = /^\/api\/v1\/books\/([a-f0-9-]+)\/(snapshot|commands|branches)(?:\/([a-f0-9-]+)(\/resolve)?)?$/.exec(url.pathname);
      if (bookRoute) {
        const id = uuid.parse(bookRoute[1]);
        if (bookRoute[2] === "branches" && req.method === "GET" && !bookRoute[3]) {
          requireScope("read"); await getRecord(id);
          const list = await controller.branches(id);
          requireScope("read"); json(res, 200, list); return;
        }
        if (bookRoute[2] === "snapshot" && req.method === "GET" && !bookRoute[3]) {
          requireScope("read"); const record = await getRecord(id);
          // The local revocation epoch stays on the server. Keep the v1 snapshot
          // readable by older clients with a strict retry schedule schema.
          const { settingsEpoch: _local, ...retry } = record.retrySchedule ?? {};
          requireScope("read"); res.setHeader("ETag", bookEtag(record));
          json(res, 200, { book: record.book, activities: record.activities, revision: record.revision,
            nextSequence: (record.watermarks?.[client.id] ?? 0) + 1, retrySchedule: record.retrySchedule ? retry : null,
            hasManualPushIntent: !!record.manualPushIntent }); return;
        }
        if (bookRoute[2] === "commands" && req.method === "POST" && !bookRoute[3]) {
          const body = await readBody(req, 64 * 1024);
          if (!auth.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato.");
          json(res, 200, await controller.command(id, client, header(req, "if-match"), body)); return;
        }
        if (bookRoute[2] === "commands" && bookRoute[3] && bookRoute[4] === "/resolve" && req.method === "POST") {
          requireScope("read");
          const body = z.object({ commandId: uuid }).passthrough().parse(await readBody(req, 64 * 1024));
          if (body.commandId !== uuid.parse(bookRoute[3])) throw badRequest();
          json(res, 200, await controller.resolveCommand(id, client, header(req, "if-match"), body)); return;
        }
        if (bookRoute[2] === "commands" && bookRoute[3] && !bookRoute[4] && req.method === "GET") {
          requireScope("read");
          const record = await getRecord(id);
          const receipt = record.commands[uuid.parse(bookRoute[3])];
          if (!receipt || receipt.clientId !== client.id) throw new ApiError(404, "receipt_missing", "Ricevuta non disponibile: riconcilia lo stato, non rieseguire un vecchio comando.");
          requireScope("read");
          json(res, 200, receipt); return;
        }
      }
      if (url.pathname === "/api/v1/settings" && req.method === "GET") {
        requireScope("write");
        const config = host.configuration(); res.setHeader("ETag", `"config:${config.revision}"`); json(res, 200, config); return;
      }
      if (url.pathname === "/api/v1/settings" && req.method === "POST") {
        requireScope("write");
        const expected = configurationRevision();
        const body = provisionSchema.parse(await readBody(req, 1024 * 1024));
        requireScope("write");
        json(res, 200, await controller.configure(() => host.provision(body, expected, installation.allowedAiBases, () => requireScope("write")))); return;
      }
      const patRoute = /^\/api\/v1\/books\/([a-f0-9-]+)\/github-credential$/.exec(url.pathname);
      if (patRoute && req.method === "POST") {
        requireScope("write");
        const expected = configurationRevision();
        const id = uuid.parse(patRoute[1]);
        const { githubToken } = z.strictObject({ consent: z.literal(true), githubToken: z.string().trim().min(1).max(600).nullable() })
          .parse(await readBody(req, 4096));
        requireScope("write");
        json(res, 200, await controller.configure(() => host.setBookPat(id, githubToken, expected, () => requireScope("write")))); return;
      }
      if (url.pathname === "/api/v1/events" && req.method === "GET") {
        requireScope("read");
        if (streams.size >= 20) throw new ApiError(429, "streams", "Troppe connessioni live.");
        res.writeHead(200, { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
        let ended = false;
        const finish = () => {
          if (ended) return; ended = true; clearInterval(timer); unsubscribe();
          commits.delete(changed); streams.delete(finish); res.end();
        };
        const emit = (event: string, data: unknown) => {
          if (!auth.isCurrent(client)) { finish(); return; }
          const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          if (Buffer.byteLength(chunk) > 16_384 || !res.write(chunk)) finish();
        };
        const changed = (id: string) => emit("snapshot-required", { bookId: id });
        const unsubscribe = subscribeLiveAi(() => {
          const live = currentLiveAi();
          if (live) emit("live", { bookId: live.bookId, activityId: live.activityId, stage: live.stage,
            textTail: live.textTail?.slice(-2000) ?? live.textPreview.slice(-2000),
            reasoningTail: live.reasoningTail?.slice(-1000) ?? live.reasoningPreview.slice(-1000),
            textCharacters: live.textCharacters, reasoningCharacters: live.reasoningCharacters });
        });
        const timer = setInterval(() => emit("heartbeat", { at: new Date().toISOString() }), 1000);
        streams.add(finish); commits.add(changed);
        req.once("close", finish);
        emit("snapshot-required", { all: true }); return;
      }
      if (url.pathname === "/api/v1/updates" && req.method === "GET") {
        requireScope("read");
        const installer = new RuntimeInstaller({ dataRoot: options.root });
        const [release, lastUpdate] = await Promise.all([checkNpmServerRelease(serverPackage.version), installer.readUpdateResult().catch(() => undefined)]);
        const supervised = process.env.BOOKWRITER_SUPERVISED === "1";
        const hasUpdateScope = client.scopes.includes("update");
        json(res, 200, {
          ...release,
          canRequest: release.canRequest && supervised && hasUpdateScope,
          ...(release.available && !hasUpdateScope ? { message: "Il token collegato non ha il permesso separato «update». Rilancia l'emissione del token dal pannello locale 24105 oppure usa npx update sul server." } : supervised ? {} : { message: release.available
            ? "Versione npm verificata disponibile. Esegui il server con npx bookwriter-personal-server start: il processo diretto non può eseguire l'aggiornamento supervisionato."
            : release.message }),
          ...(lastUpdate ? { lastUpdate } : {}),
        }); return;
      }
      if (url.pathname === "/api/v1/updates" && req.method === "POST") {
        requireScope("update");
        if (process.env.BOOKWRITER_SUPERVISED !== "1")
          throw new ApiError(409, "no_supervisor", "Aggiornamento remoto non disponibile: avvia il server con npx bookwriter-personal-server start.");
        const body = serverUpdateRequestSchema.parse(await readBody(req, 4096));
        requireScope("update");
        if (body.installedVersion !== serverPackage.version)
          throw new ApiError(412, "version", "La versione del server è cambiata: aggiorna il pannello prima di riprovare.");
        const release = await checkNpmServerRelease(serverPackage.version);
        if (!release.available || !release.signed || !release.latestVersion || release.latestVersion !== body.version)
          throw new ApiError(409, "release", "La versione richiesta non è l'ultima release npm firmata e attestata: nessun aggiornamento avviato.");
        const installer = new RuntimeInstaller({ dataRoot: options.root });
        await controller.requestUpdate(async () => {
          const previous = await installer.readUpdateRequest();
          if (previous && (previous.version !== body.version || previous.source !== "client"))
            throw new ApiError(409, "update_pending", "Esiste già una richiesta di aggiornamento diversa: attendi il supervisore o controlla il risultato.");
          const last = await installer.readUpdateResult().catch(() => undefined);
          const shouldRearm = !!previous && last?.requestId === previous.requestId && last.state === "failed";
          if (!previous || shouldRearm) await installer.writeUpdateRequest({ schemaVersion: 1, packageName: "bookwriter-personal-server",
            version: body.version, requestedAt: new Date().toISOString(), requestId: randomUUID(), source: "client" });
        });
        json(res, 202, { accepted: true, version: body.version,
          message: "Richiesta scritta. Il supervisore npx fermerà ordinatamente il server, verificherà il pacchetto e lo riavvierà solo dopo un'installazione valida." }); return;
      }
      throw new ApiError(404, "route", "Operazione API non disponibile.");
    })().catch(error => failure(res, error));
  });
  const admin = createServer((req, res) => {
    common(res);
    void (async () => {
      const localOrigins = [`http://127.0.0.1:${adminPort}`, `http://localhost:${adminPort}`];
      const publicAdminUrl = installation.allowRemoteAdmin !== false && (installation.adminPublicUrl ?? installation.publicUrl)
        ? normalizeServerUrl(installation.adminPublicUrl ?? installation.publicUrl!) : undefined;
      const publicUrl = publicAdminUrl;
      const allowedOrigins = [...localOrigins, ...(publicUrl ? [publicUrl] : [])];
      const remoteOriginAllowed = !!publicUrl && req.headers.host === new URL(publicUrl).host;
      const localHostAllowed = localOrigins.map(o => new URL(o).host).includes(req.headers.host ?? "");
      const isApiBridge = remoteOriginAllowed && /^\/api\/v1\//.test(req.url ?? "/");
      if ((!localHostAllowed && !remoteOriginAllowed) ||
          req.headers.origin && !isApiBridge && !allowedOrigins.includes(req.headers.origin))
        throw new ApiError(403, "admin_origin", publicUrl
          ? "Origine del pannello amministrativo non autorizzata. Usa l'origine pubblica configurata o il loopback locale."
          : "Pannello amministrativo disponibile solo dall'origine locale: configura prima l'URL pubblico dal pannello 24105.");
      const path = req.url ?? "/";
      // A remote Cloudflare route can point the SAME hostname to the admin listener.
      // Serve the UI on / and bridge /api/v1/* to the API listener, preserving the
      // public Host and Origin so the API still validates the hostname/CORS itself.
      // No arbitrary upstream is accepted: it is always loopback 24106.
      if (remoteOriginAllowed && /^\/api\/v1\//.test(path)) {
        const upstream = httpRequest({
          hostname: "127.0.0.1", port: apiPort, path, method: req.method,
          headers: {
            ...req.headers,
            host: installation.publicUrl ? new URL(installation.publicUrl).host : req.headers.host,
            "x-bookwriter-proxy": "same-origin-admin",
          },
        }, response => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        });
        upstream.on("error", () => failure(res, new ApiError(503, "api_proxy", "API del server personale non raggiungibile.")));
        upstream.setTimeout(130_000, () => upstream.destroy(new Error("timeout")));
        req.pipe(upstream);
        return;
      }
      if (req.method === "GET" && ["/", "/admin.js", "/admin.css"].includes(path)) {
        res.writeHead(200, { "Content-Type": path === "/" ? "text/html; charset=utf-8" :
          path === "/admin.css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
        res.end(path === "/" ? ADMIN_HTML : path === "/admin.css" ? ADMIN_CSS : ADMIN_JS); return;
      }
      if (req.method === "POST" && !allowedOrigins.includes(req.headers.origin ?? ""))
        throw new ApiError(403, "admin_csrf", "Origine amministrativa non autorizzata.");
      if (path === "/admin/api/login" && req.method === "POST") {
        const body = z.object({ code: secretText }).strict().parse(await readBody(req, 4096));
        const session = await auth.login(body.code);
        const secure = req.headers.origin?.startsWith("https://") === true ? "; Secure" : "";
        res.setHeader("Set-Cookie", `bw_admin=${session.cookie}; HttpOnly; SameSite=Strict; Path=/admin/; Max-Age=1800${secure}`);
        json(res, 200, { csrf: session.csrf }); return;
      }
      const cookie = /(?:^|;\s*)bw_admin=([A-Za-z0-9_-]+)/.exec(header(req, "cookie") ?? "")?.[1];
      auth.adminSession(cookie, req.method === "POST" ? header(req, "x-csrf-token") ?? "" : undefined);
      if (path === "/admin/api/status" && req.method === "GET") {
        json(res, 200, { serverId: installation.serverId, fingerprint, apiPort, ...auth.list(),
          allowedAiBases: installation.allowedAiBases, origins: installation.origins,
          publicUrl: installation.publicUrl ?? "", adminPublicUrl: installation.adminPublicUrl ?? installation.publicUrl ?? "",
          allowRemoteAdmin: installation.allowRemoteAdmin !== false,
          busy: controller.busy, git: gitStatus,
          tunnel: tunnelManager.status() }); return;
      }
      if (path === "/admin/api/token" && req.method === "POST") {
        const body = z.object({ label: z.string().min(1).max(80), scopes: z.array(serverScopeSchema).min(1).max(4),
          replaceId: uuid.optional() }).strict().parse(await readBody(req, 4096));
        json(res, 200, await auth.issue(body.label, body.scopes, body.replaceId)); return;
      }
      if (path === "/admin/api/revoke" && req.method === "POST") {
        const body = z.object({ id: uuid }).strict().parse(await readBody(req, 4096));
        await auth.revoke(body.id); json(res, 200, { revoked: true }); return;
      }
      if (path === "/admin/api/pairing" && req.method === "POST") {
        json(res, 200, await auth.pairing(["read", "write", "run"])); return;
      }
      if (path === "/admin/api/approve" && req.method === "POST") {
        const body = z.object({ id: uuid }).strict().parse(await readBody(req, 4096));
        await auth.approvePairing(body.id); json(res, 200, { approved: true }); return;
      }
      if (path === "/admin/api/tunnel/configure" && req.method === "POST") {
        const body = tunnelConfigureSchema.parse(await readBody(req, 8192));
        await tunnelManager.configure(body);
        json(res, 200, await tunnelManager.start()); return;
      }
      if (path === "/admin/api/tunnel/restart" && req.method === "POST") {
        z.object({}).strict().parse(await readBody(req, 8192));
        json(res, 200, await tunnelManager.restart()); return;
      }
      if (path === "/admin/api/tunnel/remove" && req.method === "POST") {
        z.object({}).strict().parse(await readBody(req, 8192));
        json(res, 200, await tunnelManager.remove()); return;
      }
      if (path === "/admin/api/network" && req.method === "POST") {
        const body = z.object({ allowedAiBases: z.array(z.string().max(500)).max(50),
          origins: z.array(z.string().max(500)).max(20), publicUrl: z.string().max(500),
          adminPublicUrl: z.string().max(500).optional(), allowRemoteAdmin: z.boolean().optional() })
          .strict().parse(await readBody(req, 16_384));
        const next = { ...installation, allowedAiBases: body.allowedAiBases.map(base => normalizeEndpoint(base)),
          origins: body.origins.map(origin => normalizeServerUrl(origin)),
          publicUrl: body.publicUrl ? normalizeServerUrl(body.publicUrl) : undefined,
          adminPublicUrl: body.adminPublicUrl ? normalizeServerUrl(body.adminPublicUrl) : undefined,
          allowRemoteAdmin: body.allowRemoteAdmin ?? installation.allowRemoteAdmin ?? true };
        await controller.configure(async () => { await atomicJson(installationPath, next); installation = next; });
        json(res, 200, { saved: true }); return;
      }
      throw new ApiError(404, "route", "Operazione amministrativa non disponibile.");
    })().catch(error => failure(res, error));
  });
  for (const server of [api, admin]) {
    server.requestTimeout = 130_000; server.headersTimeout = 10_000; server.maxHeadersCount = 40;
    server.maxConnections = 128;
    server.keepAliveTimeout = 5000;
  }
  try { adminPort = await listen(admin, adminPort); apiPort = await listen(api, apiPort); }
  catch (error) {
    admin.close(); api.close(); await tunnelManager.close(); host.dispose(); throw error;
  }
  controller.startScheduler();
  return {
    apiPort, adminPort, controller, auth, store, runtime: host.runtime, git: gitStatus,
    get tunnel() { return tunnelManager.status(); },
    allowedBases: () => [...installation.allowedAiBases],
    close: async () => {
      for (const close of streams) close();
      const closing = [api, admin].map(server => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }));
      await controller.close(); await Promise.all(closing); await tunnelManager.close();
      await workspaces?.close(); host.dispose();
    },
  };
}
