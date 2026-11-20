import { spawn, type ChildProcess, type SpawnOptions as NodeSpawnOptions } from "node:child_process";
import * as fs from "node:fs/promises";
import { basename, join } from "node:path";
import { constants } from "node:fs";
import { atomicJson, readJson } from "./files";

export type TunnelProcessState = "stopped" | "running" | "failed";
export interface CloudflareTunnelStatus {
  enabled: boolean;
  configured: boolean;
  process: TunnelProcessState;
  binaryAvailable: boolean;
  otherConnectorDetected: boolean;
  lastError?: string;
  hostname?: string;
}

export interface CloudflareTunnelConfiguration {
  token: string;
  hostname?: string;
}

type SpawnFunction = (command: string, args: readonly string[], options: NodeSpawnOptions) => ChildProcess;
type OtherConnectorDetector = (dedicatedPid?: number) => Promise<number[] | boolean>;

export interface CloudflareTunnelManagerOptions {
  root: string;
  /** Tests and controlled installations may supply a resolved command. No shell is used. */
  findBinary?: () => Promise<string | undefined> | string | undefined;
  /** Tests only; the production default is node:child_process.spawn. */
  spawn?: SpawnFunction;
  /** Tests only; production detection is read-only and never changes another connector. */
  detectOtherConnectors?: OtherConnectorDetector;
}

interface PersistedTunnelState {
  version: 1;
  enabled: boolean;
  hostname?: string;
  pid?: number;
}
interface RunningChild {
  child: ChildProcess;
  pid: number | undefined;
  stopping: boolean;
}

const STATE_FILE = "cloudflare-tunnel.json";
const TOKEN_FILE = "cloudflare-tunnel-token";
const MIN_VERSION: readonly [number, number, number] = [2025, 4, 0];
const MAX_TOKEN_CHARS = 4096;
const MAX_CAPTURE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const FIXED_ERRORS = {
  invalidState: "La configurazione del tunnel Cloudflare dedicato non è valida. Nessun connettore è stato avviato.",
  invalidToken: "Il token del tunnel Cloudflare non è valido o non è protetto. Nessun connettore è stato avviato.",
  missing: "cloudflared non è disponibile. Installa un eseguibile compatibile e riavvia il connettore dedicato.",
  version: "La versione di cloudflared è troppo vecchia: è richiesta almeno la versione 2025.4.0.",
  launch: "Il connettore Cloudflare dedicato non si è avviato. Verifica l'installazione locale e riprova esplicitamente.",
  exited: "Il connettore Cloudflare dedicato si è arrestato. BookWriter non lo riavvia automaticamente.",
  previous: "È ancora attivo un connettore dedicato da un precedente avvio di BookWriter. Arresta prima quel processo; non è stato avviato un duplicato.",
} as const;
const FORWARDED_NETWORK_VARIABLES = [
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH",
] as const;

function validHostname(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}

function parseStoredState(value: unknown): PersistedTunnelState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every(key => ["version", "enabled", "hostname", "pid"].includes(key))) throw new Error("invalid");
  if (record.version !== 1 || typeof record.enabled !== "boolean") throw new Error("invalid");
  if (record.hostname !== undefined && !validHostname(record.hostname)) throw new Error("invalid");
  if (record.pid !== undefined && (!Number.isSafeInteger(record.pid) || (record.pid as number) <= 0)) throw new Error("invalid");
  return {
    version: 1,
    enabled: record.enabled,
    ...(record.hostname !== undefined ? { hostname: record.hostname as string } : {}),
    ...(record.pid !== undefined ? { pid: record.pid as number } : {}),
  };
}

function compareVersion(actual: readonly [number, number, number], minimum: readonly [number, number, number]): number {
  for (let index = 0; index < 3; index++) {
    const difference = actual[index]! - minimum[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export function parseCloudflaredVersion(text: string): readonly [number, number, number] | undefined {
  const match = /(?:^|\s)cloudflared version\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/i.exec(text);
  if (!match) return undefined;
  const parsed = match.slice(1).map(Number) as [number, number, number];
  return parsed.every(Number.isSafeInteger) ? parsed : undefined;
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // EPERM/EACCES means the PID exists but cannot be inspected with this identity.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function buildCloudflaredEnvironment(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  const inherited = process.platform === "win32"
    ? ["PATH", "SystemRoot", "PATHEXT", "TEMP", "TMP", "ComSpec"]
    : ["PATH"];
  for (const name of inherited) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const name of FORWARDED_NETWORK_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const noProxy = [process.env.NO_PROXY, process.env.no_proxy].filter(Boolean).flatMap(value => value!.split(","))
    .map(value => value.trim()).filter(Boolean);
  for (const value of ["127.0.0.1", "localhost"]) if (!noProxy.includes(value)) noProxy.push(value);
  Object.assign(env, {
    HOME: join(root, "private", "cloudflared-home"),
    XDG_CONFIG_HOME: join(root, "private", "cloudflared-home"),
    ...(process.platform === "win32" ? { USERPROFILE: join(root, "private", "cloudflared-home") } : {}),
    NO_PROXY: noProxy.join(","),
    no_proxy: noProxy.join(","),
    LC_ALL: "C",
    LANG: "C",
  });
  return env;
}

async function captureProcess(command: string, args: readonly string[], timeoutMs: number): Promise<string> {
  let child: ChildProcess;
  try { child = spawn(command, [...args], {
    shell: false, windowsHide: true, cwd: undefined, stdio: ["ignore", "pipe", "pipe"],
  }); } catch { return ""; }
  return await new Promise(resolve => {
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (text: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(text);
    };
    child.once("error", () => finish(""));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (bytes >= MAX_CAPTURE_BYTES) return;
      const part = chunk.subarray(0, MAX_CAPTURE_BYTES - bytes);
      bytes += part.length; chunks.push(part);
    });
    child.stderr?.resume();
    child.once("close", () => finish(Buffer.concat(chunks).toString("utf8")));
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(""); }, timeoutMs);
  });
}

async function detectSystemCloudflaredPids(): Promise<number[]> {
  if (process.platform === "linux") {
    const pids: number[] = [];
    let entries: string[] = [];
    try { entries = await fs.readdir("/proc"); } catch { return pids; }
    await Promise.all(entries.filter(entry => /^\d+$/.test(entry)).map(async entry => {
      const pid = Number(entry);
      if (pid === process.pid || !Number.isSafeInteger(pid)) return;
      try {
        const command = (await fs.readFile(join("/proc", entry, "comm"), "utf8")).trim().toLowerCase();
        if (command === "cloudflared" || command === "cloudflared.exe") pids.push(pid);
      } catch { /* A process may exit while /proc is scanned. */ }
    }));
    return pids.sort((a, b) => a - b);
  }
  if (process.platform === "win32") {
    const output = await captureProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name = 'cloudflared.exe'\" | Select-Object -ExpandProperty ProcessId"], 5000);
    return [...new Set(output.split(/\s+/).map(Number).filter(pid => Number.isSafeInteger(pid) && pid > 0))];
  }
  const output = await captureProcess("ps", ["-axo", "pid=,comm=,args="], 5000);
  const pids: number[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.+?)\s+(.+)$/.exec(line);
    if (!match || Number(match[1]) === process.pid) continue;
    const command = basename(match[2]!.trim()).toLowerCase();
    const firstArgument = match[3]!.trim().split(/\s+/)[0] ?? "";
    if (command === "cloudflared" || basename(firstArgument).toLowerCase() === "cloudflared") pids.push(Number(match[1]));
  }
  return pids;
}

/** Manages only a token-file cloudflared child started by BookWriter. It never manages a service or another tunnel. */
export class CloudflareTunnelManager {
  private readonly root: string;
  private readonly privateDir: string;
  private readonly statePath: string;
  private readonly tokenPath: string;
  private readonly findBinary: () => Promise<string | undefined> | string | undefined;
  private readonly spawn: SpawnFunction;
  private readonly detectOtherConnectors: OtherConnectorDetector;
  private persisted: PersistedTunnelState | undefined;
  private child: RunningChild | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private current: CloudflareTunnelStatus = {
    enabled: false, configured: false, process: "stopped", binaryAvailable: false, otherConnectorDetected: false,
  };

  constructor(options: CloudflareTunnelManagerOptions) {
    this.root = options.root;
    this.privateDir = join(this.root, "private");
    this.statePath = join(this.privateDir, STATE_FILE);
    this.tokenPath = join(this.privateDir, TOKEN_FILE);
    this.findBinary = options.findBinary ?? (() => process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
    this.spawn = options.spawn ?? ((command, args, spawnOptions) => spawn(command, [...args], spawnOptions));
    this.detectOtherConnectors = options.detectOtherConnectors ?? (async () => detectSystemCloudflaredPids());
  }

  status(): CloudflareTunnelStatus {
    return { ...this.current };
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(action);
    this.tail = next;
    return next;
  }

  private setError(error: string, enabled = this.current.enabled): void {
    this.current = { ...this.current, enabled, process: "failed", lastError: error };
  }

  private clearError(): void {
    const { lastError: _lastError, ...state } = this.current;
    this.current = state;
  }

  private async loadState(): Promise<boolean> {
    try {
      const value = await readJson(this.statePath, 16 * 1024);
      this.persisted = value === undefined ? undefined : parseStoredState(value);
      this.current = {
        ...this.current,
        enabled: this.persisted?.enabled ?? false,
        process: "stopped",
        ...(this.persisted?.hostname ? { hostname: this.persisted.hostname } : {}),
      };
      if (!this.persisted?.hostname) delete (this.current as Partial<CloudflareTunnelStatus>).hostname;
      this.clearError();
      return true;
    } catch {
      this.persisted = undefined;
      this.current.enabled = false;
      delete this.current.hostname;
      this.setError(FIXED_ERRORS.invalidState, false);
      return false;
    }
  }

  private async tokenConfigured(): Promise<boolean> {
    try {
      const info = await fs.lstat(this.tokenPath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 4 * MAX_TOKEN_CHARS)
        throw new Error("invalid token");
      if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("invalid token mode");
      const handle = await fs.open(this.tokenPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new Error("changed token");
        const token = await handle.readFile();
        const text = new TextDecoder("utf-8", { fatal: true }).decode(token);
        if (text.length < 1 || text.length > MAX_TOKEN_CHARS || /[\r\n\0]/.test(text)) throw new Error("invalid token");
      } finally { await handle.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async persistState(pid?: number): Promise<void> {
    if (!this.persisted) return;
    this.persisted = { ...this.persisted, ...(pid ? { pid } : {}) };
    if (!pid) delete this.persisted.pid;
    await atomicJson(this.statePath, this.persisted);
  }

  private async refreshOtherConnectors(): Promise<void> {
    const dedicatedPid = this.child?.pid ?? this.persisted?.pid;
    try {
      const detected = await this.detectOtherConnectors(dedicatedPid);
      this.current.otherConnectorDetected = typeof detected === "boolean"
        ? detected
        : detected.some(pid => pid > 0 && pid !== dedicatedPid && pid !== this.child?.pid);
    } catch { this.current.otherConnectorDetected = false; }
  }

  private markUnexpectedExit(record: RunningChild): void {
    if (this.child !== record) return;
    this.child = undefined;
    if (!record.stopping) this.setError(FIXED_ERRORS.exited);
    else if (this.current.process === "running") this.current.process = "stopped";
    void this.serial(async () => { if (this.persisted) await this.persistState().catch(() => undefined); });
  }

  private async startInternal(): Promise<CloudflareTunnelStatus> {
    if (this.closed) return this.status();
    if (this.child) { this.current.process = "running"; return this.status(); }
    if (!await this.loadState()) return this.status();
    await this.refreshOtherConnectors();
    let configured = false;
    try { configured = await this.tokenConfigured(); }
    catch { this.current.configured = true; this.setError(FIXED_ERRORS.invalidToken); return this.status(); }
    this.current.configured = configured;
    const enabled = this.persisted?.enabled === true;
    this.current.enabled = enabled;
    if (!enabled) {
      this.current.process = "stopped";
      this.clearError();
    }
    const previousPid = this.persisted?.pid;
    if (enabled && pidAlive(previousPid)) {
      this.current.process = "failed";
      this.current.lastError = FIXED_ERRORS.previous;
      return this.status();
    }
    if (previousPid && !pidAlive(previousPid)) {
      await this.persistState();
    }
    const binary = await this.findBinaryPath();
    const version = binary ? await this.probeVersionFor(binary) : undefined;
    this.current.binaryAvailable = !!version;
    if (!enabled) return this.status();
    if (!configured) { this.setError(FIXED_ERRORS.invalidToken); return this.status(); }
    if (!binary || !version) { this.setError(FIXED_ERRORS.missing); return this.status(); }
    if (compareVersion(version, MIN_VERSION) < 0) { this.setError(FIXED_ERRORS.version); return this.status(); }
    await fs.mkdir(join(this.privateDir, "cloudflared-home"), { recursive: true, mode: 0o700 });
    let child: ChildProcess;
    try {
      child = this.spawn(binary, ["tunnel", "run", "--no-autoupdate", "--token-file", this.tokenPath], {
        cwd: this.root, env: buildCloudflaredEnvironment(this.root), shell: false, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch { this.setError(FIXED_ERRORS.launch); return this.status(); }
    const record: RunningChild = { child, pid: child.pid, stopping: false };
    this.child = record;
    let outputBytes = 0;
    const discard = (chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (outputBytes < MAX_CAPTURE_BYTES) outputBytes = Math.min(MAX_CAPTURE_BYTES, outputBytes + bytes);
    };
    child.stdout?.on("data", discard);
    child.stderr?.on("data", discard);
    child.once("error", () => this.markUnexpectedExit(record));
    child.once("exit", () => this.markUnexpectedExit(record));
    this.current.process = "running";
    this.clearError();
    await this.persistState(child.pid).catch(async () => {
      record.stopping = true;
      child.kill("SIGTERM");
      if (this.child === record) this.child = undefined;
      this.setError(FIXED_ERRORS.launch);
    });
    return this.status();
  }

  private async findBinaryPath(): Promise<string | undefined> {
    try { return await this.findBinary(); } catch { return undefined; }
  }

  private async probeVersionFor(binary: string): Promise<readonly [number, number, number] | undefined> {
    return await new Promise(resolve => {
      let child: ChildProcess;
      try { child = this.spawn(binary, ["--version"], {
        cwd: this.root, env: buildCloudflaredEnvironment(this.root), shell: false, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }); } catch { resolve(undefined); return; }
      let settled = false;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve(code === 0 ? parseCloudflaredVersion(Buffer.concat(chunks).toString("utf8")) : undefined);
      };
      child.once("error", () => finish(-1));
      child.once("exit", code => finish(code));
      child.once("close", code => finish(code));
      child.stderr?.resume();
      child.stdout?.on("data", (chunk: Buffer) => {
        if (bytes >= MAX_CAPTURE_BYTES) return;
        const part = chunk.subarray(0, MAX_CAPTURE_BYTES - bytes);
        bytes += part.length; chunks.push(part);
      });
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(-1); }, PROBE_TIMEOUT_MS);
    });
  }

  async start(): Promise<CloudflareTunnelStatus> {
    try { return await this.serial(() => this.startInternal()); }
    catch { this.setError(FIXED_ERRORS.launch); return this.status(); }
  }

  private async stopInternal(): Promise<void> {
    const record = this.child;
    if (!record) {
      if (this.current.process === "running") this.current.process = "stopped";
      return;
    }
    record.stopping = true;
    const exited = record.child.exitCode !== null;
    if (!exited) {
      await new Promise<void>(done => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true; clearTimeout(timer); record.child.removeListener("exit", finish); record.child.removeListener("close", finish); done();
        };
        record.child.once("exit", finish);
        record.child.once("close", finish);
        try { record.child.kill("SIGTERM"); } catch { finish(); }
        const timer = setTimeout(() => {
          try { record.child.kill("SIGKILL"); } catch { /* The child may have exited between checks. */ }
          setTimeout(finish, 1000).unref();
        }, STOP_TIMEOUT_MS);
      });
    }
    if (this.child === record) this.child = undefined;
    if (this.current.process === "running") this.current.process = "stopped";
    await this.persistState().catch(() => undefined);
  }

  private static validateConfiguration(configuration: CloudflareTunnelConfiguration): { token: string; hostname?: string } {
    const token = configuration.token;
    if (typeof token !== "string" || token.length < 1 || token.length > MAX_TOKEN_CHARS || /[\r\n\0]/.test(token))
      throw new Error("Token Cloudflare non valido.");
    if (Buffer.byteLength(token, "utf8") > 4 * MAX_TOKEN_CHARS) throw new Error("Token Cloudflare non valido.");
    if (configuration.hostname !== undefined && !validHostname(configuration.hostname))
      throw new Error("Hostname Cloudflare non valido: usa un URL HTTPS.");
    return { token, ...(configuration.hostname ? { hostname: configuration.hostname } : {}) };
  }

  private async ensurePrivateDirectory(): Promise<void> {
    await fs.mkdir(this.privateDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.privateDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Directory privata non sicura.");
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) await fs.chmod(this.privateDir, 0o700);
  }

  private async replaceTokenFile(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(from, to); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 12 || process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
        await new Promise(done => setTimeout(done, 15 * (attempt + 1)));
      }
    }
  }

  private async writeToken(token: string): Promise<void> {
    await this.ensurePrivateDirectory();
    try {
      const existing = await fs.lstat(this.tokenPath);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error("Token file non regolare.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = this.tokenPath + ".new-" + crypto.randomUUID();
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(token, "utf8");
      await handle.sync();
      await handle.close();
      await this.replaceTokenFile(temporary, this.tokenPath);
      if (process.platform !== "win32") await fs.chmod(this.tokenPath, 0o600);
    } finally {
      await handle.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  async configure(configuration: CloudflareTunnelConfiguration): Promise<CloudflareTunnelStatus> {
    const validated = CloudflareTunnelManager.validateConfiguration(configuration);
    return this.serial(async () => {
      this.closed = false;
      await this.stopInternal();
      await this.writeToken(validated.token);
      this.persisted = { version: 1, enabled: true, ...(validated.hostname ? { hostname: validated.hostname } : {}) };
      await atomicJson(this.statePath, this.persisted);
      this.current = {
        ...this.current,
        enabled: true, configured: true, process: "stopped",
        ...(validated.hostname ? { hostname: validated.hostname } : {}),
      };
      if (!validated.hostname) delete (this.current as Partial<CloudflareTunnelStatus>).hostname;
      this.clearError();
      return this.status();
    });
  }

  async restart(): Promise<CloudflareTunnelStatus> {
    try {
      return await this.serial(async () => {
        this.closed = false;
        await this.stopInternal();
        return this.startInternal();
      });
    } catch { this.setError(FIXED_ERRORS.launch); return this.status(); }
  }

  async remove(): Promise<CloudflareTunnelStatus> {
    return this.serial(async () => {
      await this.stopInternal();
      await fs.rm(this.tokenPath, { force: true });
      await fs.rm(this.statePath, { force: true });
      this.persisted = undefined;
      this.current = {
        enabled: false, configured: false, process: "stopped", binaryAvailable: this.current.binaryAvailable,
        otherConnectorDetected: this.current.otherConnectorDetected,
      };
      return this.status();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.serial(async () => {
      if (this.closed) return;
      this.closed = true;
      await this.stopInternal();
    });
  }
}
