import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import * as fs from "node:fs/promises";
import { z, serverScopeSchema, type ServerScope } from "@engine/index";
import { atomicJson, readJson, FileBookStore } from "./files";
import { Vault } from "./vault";
import { ApiError } from "./errors";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const constantMatch = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MAX_CLIENTS = 100;
const clientSchema = z.object({
  id: z.string().uuid(), label: z.string().min(1).max(80), hash: z.string().length(64),
  scopes: z.array(serverScopeSchema).min(1).max(4), createdAt: z.number(), revoked: z.boolean(),
}).strict();
const pairingSchema = z.object({
  id: z.string().uuid(), hash: z.string().length(64), expiresAt: z.number(), attempts: z.number().int().min(0).max(5),
  requestHash: z.string().length(64).optional(), label: z.string().max(80).optional(),
  scopes: z.array(serverScopeSchema).max(4),
  issued: z.object({ iv: z.string(), data: z.string() }).optional(),
}).strict();
const authSchema = z.object({
  version: z.literal(1), bootstrapHash: z.string().length(64), clients: z.array(clientSchema).max(MAX_CLIENTS),
  pairing: pairingSchema.optional(), failureWindow: z.number(), failures: z.number().int().min(0),
}).strict();
type AuthState = z.infer<typeof authSchema>;
export type Client = z.infer<typeof clientSchema>;

/** Recover the durable bootstrap if the process stopped before writing authorization.json. */
async function bootstrapCode(path: string): Promise<string> {
  try {
    const info = await fs.lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 44 ||
        process.platform !== "win32" && (info.mode & 0o077) !== 0)
      throw new Error("File di bootstrap locale non valido o non privato: nessuna rigenerazione automatica.");
    const text = await fs.readFile(path, "utf8");
    if (!/^[A-Za-z0-9_-]{43}\n$/.test(text)) throw new Error("Codice di bootstrap locale non valido.");
    return text.slice(0, -1);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const code = secret();
    await fs.writeFile(path, code + "\n", { flag: "wx", mode: 0o600, flush: true });
    return code;
  }
}
function appendClient(state: AuthState, client: Client): void {
  if (state.clients.length >= MAX_CLIENTS) {
    const revoked = state.clients.findIndex(item => item.revoked);
    if (revoked === -1) throw new ApiError(409, "client_limit", "Troppi client attivi: revoca un token prima di generarne un altro.");
    state.clients.splice(revoked, 1);
  }
  state.clients.push(client);
}

export class Auth {
  private sessions = new Map<string, { csrf: string; until: number }>();
  private constructor(private store: FileBookStore, private vault: Vault, private path: string, private state: AuthState) {}
  static async open(store: FileBookStore, vault: Vault): Promise<Auth> {
    const path = join(store.root, "private", "authorization.json");
    const stored = await readJson(path, 1024 * 1024);
    let state: AuthState;
    if (stored === undefined) {
      // This file is shown only by a local administrator, never returned by the API or logged.
      const code = await bootstrapCode(join(store.root, "private", "admin-bootstrap.txt"));
      state = { version: 1, bootstrapHash: hash(code), clients: [], failureWindow: Date.now(), failures: 0 };
      await atomicJson(path, state);
    } else state = authSchema.parse(stored);
    return new Auth(store, vault, path, state);
  }
  private async change<T>(action: (state: AuthState) => T | Promise<T>): Promise<T> {
    return this.store.serial("$auth", async () => {
      const next = structuredClone(this.state);
      const result = await action(next);
      authSchema.parse(next); await atomicJson(this.path, next); this.state = next; return result;
    });
  }
  async rotateBootstrap(): Promise<string> {
    const path = join(this.store.root, "private", "admin-bootstrap.txt");
    const old = await fs.readFile(path, "utf8");
    const code = secret();
    const temporary = path + ".new-" + randomUUID();
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(code + "\n"); await handle.sync(); await handle.close();
      await fs.rename(temporary, path);
    } catch (error) { await handle.close().catch(() => undefined); await fs.unlink(temporary).catch(() => undefined); throw error; }
    try {
      await this.change(state => { state.bootstrapHash = hash(code); state.failures = 0; state.failureWindow = Date.now(); });
      this.sessions.clear();
      return code;
    } catch (error) {
      // Restore the former code if the durable auth hash could not be updated.
      const rollback = path + ".rollback-" + randomUUID();
      const file = await fs.open(rollback, "wx", 0o600);
      try { await file.writeFile(old); await file.sync(); await file.close(); await fs.rename(rollback, path); }
      finally { await file.close().catch(() => undefined); await fs.unlink(rollback).catch(() => undefined); }
      throw error;
    }
  }
  authenticate(token: string | undefined, scope?: ServerScope): Client {
    if (!token || token.length > 200) throw new ApiError(401, "unauthorized", "Token del server assente o non valido.");
    const digest = hash(token);
    const client = this.state.clients.find(c => !c.revoked && constantMatch(c.hash, digest));
    if (!client) throw new ApiError(401, "unauthorized", "Token del server assente o revocato.");
    if (scope && !client.scopes.includes(scope)) throw new ApiError(403, "scope", "Il token non ha il permesso richiesto.");
    return structuredClone(client);
  }
  isCurrent(client: Client): boolean {
    return this.state.clients.some(c => c.id === client.id && c.hash === client.hash && !c.revoked);
  }
  async login(code: string): Promise<{ cookie: string; csrf: string }> {
    const accepted = await this.change(state => {
      if (Date.now() - state.failureWindow > 300_000) { state.failureWindow = Date.now(); state.failures = 0; }
      if (state.failures >= 20) return false;
      state.failures++;
      return constantMatch(state.bootstrapHash, hash(code));
    });
    if (!accepted) throw new ApiError(401, "admin_login", "Accesso locale non riuscito o temporaneamente limitato.");
    const cookie = secret(), csrf = secret();
    if (this.sessions.size >= 20) this.sessions.clear();
    this.sessions.set(cookie, { csrf, until: Date.now() + 30 * 60_000 });
    return { cookie, csrf };
  }
  adminSession(cookie: string | undefined, csrf?: string): void {
    const session = cookie && this.sessions.get(cookie);
    if (!session || session.until < Date.now()) throw new ApiError(401, "admin_session", "Accedi al pannello locale.");
    if (csrf !== undefined && !constantMatch(session.csrf, csrf)) throw new ApiError(403, "csrf", "Richiesta locale non autorizzata.");
  }
  list() {
    return { clients: this.state.clients.map(({ hash: _hash, ...c }) => c),
      pairing: this.state.pairing ? { id: this.state.pairing.id, label: this.state.pairing.label,
        expiresAt: this.state.pairing.expiresAt, requested: !!this.state.pairing.requestHash } : null };
  }
  async issue(label: string, scopes: ServerScope[], replaceId?: string): Promise<{ token: string; clientId: string }> {
    return this.change(state => {
      if (new Set(scopes).size !== scopes.length) throw new ApiError(422, "scopes", "Permessi duplicati.");
      const index = replaceId ? state.clients.findIndex(c => c.id === replaceId) : -1;
      if (replaceId && index === -1) throw new ApiError(404, "client_missing", "Client non trovato.");
      const token = secret(), clientId = replaceId ?? randomUUID();
      const client = clientSchema.parse({ id: clientId, label, scopes, hash: hash(token), revoked: false, createdAt: Date.now() });
      // Rotate the secret, not the command/creation identity. The old hash stops working.
      if (index >= 0) state.clients[index] = client;
      else appendClient(state, client);
      return { token, clientId };
    });
  }
  async revoke(id: string): Promise<void> {
    await this.change(state => { const client = state.clients.find(c => c.id === id); if (client) client.revoked = true; });
  }
  async pairing(scopes: ServerScope[]): Promise<{ code: string; expiresAt: number }> {
    if (scopes.includes("update")) throw new ApiError(403, "pairing_update", "Il pairing normale non concede aggiornamenti.");
    return this.change(state => {
      const code = String(randomInt(100_000_000, 1_000_000_000));
      state.pairing = { id: randomUUID(), hash: hash(code), expiresAt: Date.now() + 300_000, attempts: 0, scopes };
      return { code, expiresAt: state.pairing.expiresAt };
    });
  }
  async requestPairing(code: string, nonce: string, label: string): Promise<{ id: string }> {
    const id = await this.change(state => {
      if (Date.now() - state.failureWindow > 300_000) { state.failureWindow = Date.now(); state.failures = 0; }
      if (state.failures >= 20) return undefined;
      state.failures++;
      const pairing = state.pairing;
      if (!pairing || pairing.expiresAt < Date.now() || pairing.attempts >= 5 || pairing.requestHash) return undefined;
      pairing.attempts++;
      if (!constantMatch(pairing.hash, hash(code))) return undefined;
      pairing.requestHash = hash(nonce); pairing.label = label; return pairing.id;
    });
    if (!id) throw new ApiError(401, "pairing_invalid", "Codice non valido, scaduto, già usato o troppi tentativi.");
    return { id };
  }
  async approvePairing(id: string): Promise<void> {
    await this.change(async state => {
      const p = state.pairing;
      if (!p || p.id !== id || p.expiresAt < Date.now() || !p.requestHash || !p.label || p.issued)
        throw new ApiError(409, "pairing_state", "Abbinamento non più approvabile.");
      const token = secret();
      appendClient(state, clientSchema.parse({ id: randomUUID(), label: p.label,
        hash: hash(token), scopes: p.scopes, revoked: false, createdAt: Date.now() }));
      p.issued = await this.vault.encrypt(token);
    });
  }
  async pollPairing(id: string, nonce: string): Promise<{ pending: true } | { token: string }> {
    return this.change(async state => {
      const p = state.pairing;
      if (!p || p.id !== id || p.expiresAt < Date.now() || !p.requestHash || !constantMatch(p.requestHash, hash(nonce)))
        throw new ApiError(401, "pairing_invalid", "Abbinamento non valido o scaduto.");
      if (!p.issued) return { pending: true as const };
      const token = await this.vault.decrypt(p.issued);
      delete state.pairing;
      return { token };
    });
  }
}
