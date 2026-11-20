import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, posix, win32 } from "node:path";
import { trustedNpmReleaseMetadata } from "./npm-release";

export const PACKAGE_NAME = "bookwriter-personal-server" as const;
export const MINIMUM_NODE: readonly [number, number, number] = [22, 14, 0];
const MAX_CONTROL_FILE_BYTES = 16 * 1024;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_MESSAGES = {
  completed: "Aggiornamento completato.",
  failed: "Aggiornamento non riuscito. La versione attiva precedente resta disponibile.",
  limited: "Limite di tre aggiornamenti supervisionati all'ora raggiunto. La versione attiva resta disponibile; riavvia il supervisore quando possibile.",
  stopping: "Il server non si è arrestato in modo ordinato. La versione attiva non è stata sostituita.",
} as const;

export interface UpdateRequest {
  schemaVersion: 1;
  packageName: typeof PACKAGE_NAME;
  version: string;
  requestedAt: string;
  requestId: string;
  source: "client";
}
export interface UpdateResult {
  schemaVersion: 1;
  requestId: string;
  state: "completed" | "failed";
  version: string;
  fromVersion: string;
  at: string;
  message: string;
}
export interface InstallerState {
  schemaVersion: 1;
  packageName: typeof PACKAGE_NAME;
  channel: "latest";
  activeVersion: string;
  installedAt: string;
}
export interface ActiveRuntime {
  schemaVersion: 1;
  packageName: typeof PACKAGE_NAME;
  version: string;
  activatedAt: string;
  packageRoot: string;
  serverPath: string;
}
export interface CommandResult { code: number; stdout: string; stderr: string }
export interface CommandOptions { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }
export type CommandRunner = (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
export interface RuntimeInstallerOptions {
  dataRoot: string;
  npmBinary?: string;
  runner?: CommandRunner;
  now?: () => Date;
  uuid?: () => string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validIso(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
function parseVersionTuple(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}
function tupleAtLeast(current: readonly [number, number, number], minimum: readonly [number, number, number]): boolean {
  for (let index = 0; index < 3; index++) {
    if (current[index] !== minimum[index]) return current[index]! > minimum[index]!;
  }
  return true;
}
export function assertExactSemver(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 100 || !SEMVER.test(value)) throw new Error("Versione non valida: è richiesta una versione semver esatta.");
  const match = SEMVER.exec(value)!;
  if (match[4]?.split(".").some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0")))
    throw new Error("Versione prerelease semver non valida.");
}
export function assertSupportedNode(version = process.versions.node): void {
  const parsed = parseVersionTuple(version);
  if (!parsed || !tupleAtLeast(parsed, MINIMUM_NODE))
    throw new Error(`Node.js ${MINIMUM_NODE.join(".")} o successivo è richiesto.`);
}
export function defaultDataRoot(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const path = platform === "win32" ? win32 : posix;
  if (env.BOOKWRITER_DATA_ROOT) return path.resolve(env.BOOKWRITER_DATA_ROOT);
  if (platform === "win32") {
    const base = env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
    return path.resolve(base, "BookWriter", "data");
  }
  if (platform === "darwin") return path.resolve(env.HOME ?? homedir(), "Library", "Application Support", "BookWriter");
  const xdg = env.XDG_DATA_HOME;
  return path.resolve(xdg && xdg.startsWith("/") ? xdg : path.join(env.HOME ?? homedir(), ".local", "share"), "bookwriter");
}
export function sanitizedNpmEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const names = [
    "PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME",
    "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  ];
  const env: NodeJS.ProcessEnv = { NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  for (const name of names) if (source[name] !== undefined) env[name] = source[name];
  return env;
}
export function parseUpdateRequest(value: unknown): UpdateRequest {
  if (!isPlainObject(value) || !exactKeys(value, ["schemaVersion", "packageName", "version", "requestedAt", "requestId", "source"]))
    throw new Error("Richiesta di aggiornamento non valida.");
  assertExactSemver(value.version);
  if (value.schemaVersion !== 1 || value.packageName !== PACKAGE_NAME || value.source !== "client" ||
      !validIso(value.requestedAt) || typeof value.requestId !== "string" || !UUID.test(value.requestId))
    throw new Error("Schema della richiesta di aggiornamento non valido.");
  return value as unknown as UpdateRequest;
}
export function parseUpdateResult(value: unknown): UpdateResult {
  if (!isPlainObject(value) || !exactKeys(value, ["schemaVersion", "requestId", "state", "version", "fromVersion", "at", "message"]))
    throw new Error("Risultato di aggiornamento non valido.");
  assertExactSemver(value.version); assertExactSemver(value.fromVersion);
  const safeMessage = value.state === "completed"
    ? value.message === SAFE_MESSAGES.completed
    : value.state === "failed" && [SAFE_MESSAGES.failed, SAFE_MESSAGES.limited, SAFE_MESSAGES.stopping].includes(value.message as typeof SAFE_MESSAGES.failed);
  if (value.schemaVersion !== 1 || typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
      (value.state !== "completed" && value.state !== "failed") || !validIso(value.at) ||
      typeof value.message !== "string" || value.message.length > 300 || !safeMessage)
    throw new Error("Schema del risultato di aggiornamento non valido.");
  return value as unknown as UpdateResult;
}
export const UPDATE_REQUEST_SCHEMA = {
  path: "private/update-request.json",
  maxBytes: MAX_CONTROL_FILE_BYTES,
  parse: parseUpdateRequest,
} as const;
export const UPDATE_RESULT_SCHEMA = {
  path: "private/update-result.json",
  maxBytes: MAX_CONTROL_FILE_BYTES,
  parse: parseUpdateResult,
} as const;

async function readBoundedJson(path: string, maxBytes = MAX_CONTROL_FILE_BYTES): Promise<unknown | undefined> {
  let handle: fs.FileHandle;
  try {
    const info = await fs.lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > maxBytes)
      throw new Error("File di controllo non regolare o troppo grande.");
    handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size > maxBytes)
      throw new Error("File di controllo cambiato durante la lettura.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const bytes = await handle.readFile({ encoding: null });
    if (bytes.byteLength > maxBytes) throw new Error("File di controllo oltre il limite.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 12 || process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
      await new Promise(done => setTimeout(done, 15 * (attempt + 1)));
    }
  }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const parent = resolve(path, "..");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(parent, 0o700);
  const data = Buffer.from(JSON.stringify(value) + "\n");
  if (data.byteLength > MAX_CONTROL_FILE_BYTES) throw new Error("File di controllo oltre il limite.");
  const temp = `${path}.new-${randomUUID()}`;
  const file = await fs.open(temp, "wx", 0o600);
  try {
    await file.writeFile(data); await file.sync(); await file.close();
    await renameWithRetry(temp, path);
  } finally { await file.close().catch(() => undefined); await fs.unlink(temp).catch(() => undefined); }
}
async function regularFile(path: string): Promise<boolean> {
  try { const stat = await fs.lstat(path); return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function ensureDataRoot(dataRoot: string): Promise<string> {
  const root = resolve(dataRoot);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("La directory dati non è una directory regolare.");
  if (process.platform !== "win32") await fs.chmod(root, 0o700);
  const privateDir = join(root, "private");
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  const privateStat = await fs.lstat(privateDir);
  if (!privateStat.isDirectory() || privateStat.isSymbolicLink()) throw new Error("Directory privata del server non sicura.");
  if (process.platform !== "win32") await fs.chmod(privateDir, 0o700);
  return root;
}
function spawnCommand(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((accept, reject) => {
    const limits = { stdout: 1024 * 1024, stderr: 64 * 1024 };
    let stdout = ""; let stderr = ""; let settled = false;
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : undefined;
    const finish = (action: () => void) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); action(); };
    child.once("error", () => finish(() => reject(new Error("Impossibile avviare il comando richiesto."))));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunk.byteLength > limits.stdout) { child.kill("SIGKILL"); return; }
      stdout += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) + chunk.byteLength > limits.stderr) return;
      stderr += chunk.subarray(0, limits.stderr - Buffer.byteLength(stderr)).toString("utf8");
    });
    child.once("close", code => finish(() => accept({ code: code ?? 1, stdout, stderr })));
  });
}
function npmBinary(): string { return process.platform === "win32" ? "npm.cmd" : "npm"; }

export class RuntimeInstaller {
  readonly dataRoot: string;
  readonly runtimeRoot: string;
  private readonly runner: CommandRunner;
  private readonly npm: string;
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(options: RuntimeInstallerOptions) {
    this.dataRoot = resolve(options.dataRoot);
    this.runtimeRoot = join(this.dataRoot, "private", "npm-runtime");
    this.runner = options.runner ?? spawnCommand;
    this.npm = options.npmBinary ?? npmBinary();
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? randomUUID;
  }
  private async runNpm(args: readonly string[]): Promise<CommandResult> {
    const result = await this.runner(this.npm, [ ...args, "--registry=https://registry.npmjs.org" ], {
      cwd: this.dataRoot, env: sanitizedNpmEnvironment(), timeoutMs: 10 * 60_000,
    });
    if (result.code !== 0) throw new Error("Operazione npm non riuscita.");
    return result;
  }
  async latestVersion(): Promise<string> {
    await ensureDataRoot(this.dataRoot);
    const result = await this.runNpm(["view", PACKAGE_NAME, "version", "--json"]);
    let version: unknown;
    try { version = JSON.parse(result.stdout.trim()); } catch { throw new Error("Catalogo npm non valido."); }
    assertExactSemver(version); return version;
  }
  private async assertTrustedRelease(version: string): Promise<void> {
    const result = await this.runNpm(["view", `${PACKAGE_NAME}@${version}`, "--json"]);
    let metadata: unknown;
    try { metadata = JSON.parse(result.stdout); } catch { throw new Error("Metadati npm non validi."); }
    trustedNpmReleaseMetadata(metadata, version);
  }
    async installVersion(requested: string | "latest" = "latest"): Promise<ActiveRuntime> {
    assertSupportedNode();
    await ensureDataRoot(this.dataRoot);
    const version = requested === "latest" ? await this.latestVersion() : requested;
    assertExactSemver(version);
    await this.assertTrustedRelease(version);
    await fs.mkdir(join(this.runtimeRoot, "versions"), { recursive: true, mode: 0o700 });
    const staging = join(this.runtimeRoot, `staging-${this.uuid()}`);
    const destination = join(this.runtimeRoot, "versions", version);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      await this.runNpm(["install", "--prefix", staging, "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "--package-lock=true", `${PACKAGE_NAME}@${version}`]);
      await this.runNpm(["audit", "signatures", "--prefix", staging]);
      const stagedPackage = join(staging, "node_modules", PACKAGE_NAME);
      await this.validateInstalledPackage(stagedPackage, version);
      if (await regularFile(join(destination, "package.json"))) {
        await this.validateInstalledPackage(destination, version);
        if (await this.packageDigest(destination) !== await this.packageDigest(stagedPackage))
          throw new Error("Runtime già installato ma diverso dal pacchetto npm appena verificato.");
      } else await renameWithRetry(stagedPackage, destination);
      await this.activate(version);
      const active = await this.activeRuntime();
      if (!active) throw new Error("Runtime attivato non leggibile.");
      return active;
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  private async packageDigest(root: string): Promise<string> {
    const hash = createHash("sha256");
    let files = 0, bytes = 0;
    const walk = async (directory: string, relative = "") => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Pacchetto npm con collegamenti non ammesso.");
        if (entry.isDirectory()) { await walk(path, name); continue; }
        if (!entry.isFile()) throw new Error("Pacchetto npm non regolare.");
        const stat = await fs.lstat(path);
        files++; bytes += stat.size;
        if (stat.size > 20 * 1024 * 1024 || files > 5000 || bytes > 50 * 1024 * 1024)
          throw new Error("Pacchetto npm oltre i limiti di sicurezza.");
        hash.update(JSON.stringify(name)); hash.update("\0"); hash.update(await fs.readFile(path)); hash.update("\0");
      }
    };
    await walk(root); return hash.digest("hex");
  }
  private async validateInstalledPackage(root: string, expectedVersion: string): Promise<void> {
    const value = await readBoundedJson(join(root, "package.json"));
    if (!isPlainObject(value) || value.name !== PACKAGE_NAME || value.version !== expectedVersion)
      throw new Error("Pacchetto npm installato non corrispondente.");
    if (!await regularFile(join(root, "dist", "cli.mjs")) || !await regularFile(join(root, "dist", "server.mjs")))
      throw new Error("Pacchetto npm incompleto: runtime mancante.");
  }
  private async activate(version: string): Promise<void> {
    const at = this.now().toISOString();
    await this.validateInstalledPackage(join(this.runtimeRoot, "versions", version), version);
    await atomicJson(join(this.runtimeRoot, "active.json"), { schemaVersion: 1, packageName: PACKAGE_NAME, version, activatedAt: at });
    const state: InstallerState = { schemaVersion: 1, packageName: PACKAGE_NAME, channel: "latest", activeVersion: version, installedAt: at };
    await atomicJson(join(this.dataRoot, "private", "npm-install.json"), state);
  }
  async activeRuntime(): Promise<ActiveRuntime | undefined> {
    const value = await readBoundedJson(join(this.runtimeRoot, "active.json"));
    if (value === undefined) return undefined;
    if (!isPlainObject(value) || !exactKeys(value, ["schemaVersion", "packageName", "version", "activatedAt"]) ||
        value.schemaVersion !== 1 || value.packageName !== PACKAGE_NAME || !validIso(value.activatedAt))
      throw new Error("Stato runtime non valido.");
    assertExactSemver(value.version);
    const packageRoot = join(this.runtimeRoot, "versions", value.version);
    await this.validateInstalledPackage(packageRoot, value.version);
    return { ...(value as unknown as Omit<ActiveRuntime, "packageRoot" | "serverPath">), packageRoot, serverPath: join(packageRoot, "dist", "server.mjs") };
  }
  async installerState(): Promise<InstallerState | undefined> {
    const value = await readBoundedJson(join(this.dataRoot, "private", "npm-install.json"));
    if (value === undefined) return undefined;
    if (!isPlainObject(value) || !exactKeys(value, ["schemaVersion", "packageName", "channel", "activeVersion", "installedAt"]) ||
        value.schemaVersion !== 1 || value.packageName !== PACKAGE_NAME || value.channel !== "latest" || !validIso(value.installedAt))
      throw new Error("Stato installazione non valido.");
    assertExactSemver(value.activeVersion);
    return value as unknown as InstallerState;
  }
  async writeUpdateRequest(request: UpdateRequest): Promise<void> {
    const validated = parseUpdateRequest(request);
    await atomicJson(join(this.dataRoot, UPDATE_REQUEST_SCHEMA.path), validated);
  }
  async writeUpdateResult(result: UpdateResult): Promise<void> {
    const validated = parseUpdateResult(result);
    await atomicJson(join(this.dataRoot, UPDATE_RESULT_SCHEMA.path), validated);
  }
  async readUpdateRequest(): Promise<UpdateRequest | undefined> {
    const value = await readBoundedJson(join(this.dataRoot, UPDATE_REQUEST_SCHEMA.path));
    return value === undefined ? undefined : parseUpdateRequest(value);
  }
  async readUpdateResult(): Promise<UpdateResult | undefined> {
    const value = await readBoundedJson(join(this.dataRoot, UPDATE_RESULT_SCHEMA.path));
    return value === undefined ? undefined : parseUpdateResult(value);
  }
  async deleteMatchingUpdateRequest(expected: UpdateRequest): Promise<boolean> {
    const current = await this.readUpdateRequest();
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return false;
    await fs.unlink(join(this.dataRoot, UPDATE_REQUEST_SCHEMA.path));
    return true;
  }
}

export interface ChildExit { code: number | null; signal: NodeJS.Signals | null }
export interface ServerChildHandle { kill(signal: NodeJS.Signals): boolean; exited: Promise<ChildExit> }
export interface SupervisorOptions {
  installer: RuntimeInstaller;
  currentVersion: string;
  spawnChild?: (serverPath: string, dataRoot: string) => ServerChildHandle;
  pollMs?: number;
  stopTimeoutMs?: number;
  hourMs?: number;
  forwardSignals?: boolean;
}
function childHandle(child: ChildProcess): ServerChildHandle {
  return {
    kill: signal => child.kill(signal),
    exited: new Promise(accept => {
      let finished = false;
      const done = (code: number | null, signal: NodeJS.Signals | null) => { if (!finished) { finished = true; accept({ code, signal }); } };
      child.once("error", () => done(1, null));
      child.once("exit", done);
    }),
  };
}
export function supervisedChildEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const names = ["PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "SystemRoot", "WINDIR", "ComSpec",
    "PATHEXT", "TEMP", "TMP", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY",
    "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"];
  const clean: NodeJS.ProcessEnv = { BOOKWRITER_SUPERVISED: "1", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  for (const name of names) if (environment[name] !== undefined) clean[name] = environment[name];
  return clean;
}
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function defaultChild(serverPath: string, dataRoot: string): ServerChildHandle {
  return childHandle(spawn(process.execPath, [serverPath, "--data-root", dataRoot], {
    shell: false, windowsHide: false, stdio: "inherit", env: supervisedChildEnvironment(),
  } satisfies SpawnOptions));
}
/**
 * Supervises the one server process owned by this CLI. A valid, bounded update-request is the only
 * trigger that can replace the active runtime. The supervisor never executes arbitrary arguments and
 * never stops another process.
 */
export async function superviseServer(options: SupervisorOptions): Promise<ChildExit> {
  assertSupportedNode();
  const installer = options.installer;
  const pollMs = options.pollMs ?? 500;
  const stopTimeoutMs = options.stopTimeoutMs ?? 30_000;
  const hourMs = options.hourMs ?? 60 * 60_000;
  const spawnChild = options.spawnChild ?? defaultChild;
  const updateRestarts: number[] = [];
  const ignoredRequests = new Set<string>();
  let stopping = false;
  let currentChild: ServerChildHandle | undefined;
  const onSigint = () => { stopping = true; currentChild?.kill("SIGINT"); };
  const onSigterm = () => { stopping = true; currentChild?.kill("SIGTERM"); };
  if (options.forwardSignals !== false) {
    process.once("SIGINT", onSigint); process.once("SIGTERM", onSigterm);
  }
  try {
    if (!await installer.activeRuntime()) await installer.installVersion(options.currentVersion);
    for (;;) {
      const active = await installer.activeRuntime();
      if (!active) throw new Error("Runtime attivo non disponibile.");
      currentChild = spawnChild(active.serverPath, installer.dataRoot);
      let updateRequest: UpdateRequest | undefined;
      for (;;) {
        const exited = await withTimeout(currentChild.exited, pollMs);
        if (exited !== undefined) {
          try { updateRequest = await installer.readUpdateRequest(); } catch { updateRequest = undefined; }
          if (stopping || !updateRequest || ignoredRequests.has(updateRequest.requestId)) return exited;
          break;
        }
        try {
          const request = await installer.readUpdateRequest();
          if (!request || ignoredRequests.has(request.requestId)) continue;
          updateRequest = request;
          const cutoff = Date.now() - hourMs;
          while (updateRestarts[0] !== undefined && updateRestarts[0]! < cutoff) updateRestarts.shift();
          if (updateRestarts.length >= 3) {
            await writeUpdateFailure(installer, request, active.version, SAFE_MESSAGES.limited);
            ignoredRequests.add(request.requestId);
            continue;
          }
          currentChild.kill("SIGTERM");
          const childExit = await withTimeout(currentChild.exited, stopTimeoutMs);
          if (!childExit) {
            ignoredRequests.add(request.requestId);
            await writeUpdateFailure(installer, request, active.version, SAFE_MESSAGES.stopping);
            continue;
          }
          break;
        } catch { /* Una richiesta ostile o illeggibile non arresta il server attivo. */ }
      }
      if (!updateRequest || stopping) return await currentChild.exited;
      const cutoff = Date.now() - hourMs;
      while (updateRestarts[0] !== undefined && updateRestarts[0]! < cutoff) updateRestarts.shift();
      if (updateRestarts.length >= 3) {
        await writeUpdateFailure(installer, updateRequest, active.version, SAFE_MESSAGES.limited);
        ignoredRequests.add(updateRequest.requestId);
        // The update child already stopped. Restart the previous active runtime once and leave it in charge.
        return await spawnChild(active.serverPath, installer.dataRoot).exited;
      }
      let installed: ActiveRuntime | undefined;
      try { installed = await installer.installVersion(updateRequest.version); }
      catch {
        await writeUpdateFailure(installer, updateRequest, active.version, SAFE_MESSAGES.failed).catch(() => undefined);
        ignoredRequests.add(updateRequest.requestId);
      }
      if (installed) {
        await installer.writeUpdateResult({
          schemaVersion: 1, requestId: updateRequest.requestId, state: "completed", version: updateRequest.version,
          fromVersion: active.version, at: new Date().toISOString(), message: SAFE_MESSAGES.completed,
        }).catch(() => undefined);
        await installer.deleteMatchingUpdateRequest(updateRequest).catch(() => false);
        updateRestarts.push(Date.now());
      }
      // Restart the newly activated version or the previous one preserved by the failed install.
    }
  } finally {
    if (options.forwardSignals !== false) {
      process.off("SIGINT", onSigint); process.off("SIGTERM", onSigterm);
    }
  }
}
async function writeUpdateFailure(installer: RuntimeInstaller, request: UpdateRequest, fromVersion: string, message: string): Promise<void> {
  await installer.writeUpdateResult({
    schemaVersion: 1, requestId: request.requestId, state: "failed", version: request.version,
    fromVersion, at: new Date().toISOString(), message,
  });
}
