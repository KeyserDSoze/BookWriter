import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { bookSchema, activitySchema, retryScheduleSchema, serverCommandReceiptSchema, migrateBook, z, BookNotFound, type HostBookRecord } from "@engine/index";

export const MAX_FILE_BYTES = 80 * 1024 * 1024;
export const MAX_BOOKS = 200;
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function checkBookId(id: string): void { if (!validId.test(id)) throw new Error("ID libro non valido."); }

/** Kernel-owned lock; a PID file or an in-process mutex would not protect another process. */
export async function lockDataRoot(root: string, onLost: () => void = () => { process.exitCode = 1; }): Promise<() => Promise<void>> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("La directory dati non può essere un collegamento.");
  const real = await fs.realpath(root);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    throw new Error("La directory dati deve essere privata (permessi 0700).");
  let child: ChildProcess;
  if (process.platform === "win32") {
    const name = "Global\\BookWriter-" + createHash("sha256").update(real.toLowerCase()).digest("hex");
    const script = `$m = New-Object System.Threading.Mutex($false, '${name}'); try { $ok=$m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ok=$true }; if(-not $ok){exit 73}; [Console]::Out.WriteLine('LOCKED'); [Console]::In.ReadLine() | Out-Null; $m.ReleaseMutex(); $m.Dispose()`;
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  } else if (process.platform === "linux") {
    child = spawn("flock", ["-n", "-E", "73", join(real, ".writer.lock"), process.execPath, "-e",
      "process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],
    { stdio: ["pipe", "pipe", "ignore"] });
  } else throw new Error("Sistema operativo non supportato per il lock del server.");
  let released = false;
  let ready = false;
  child.once("exit", () => { if (ready && !released) onLost(); });
  await new Promise<void>((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Impossibile acquisire il lock del server.")); }, 10_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Lock OS non disponibile: installa flock su Linux o PowerShell su Windows.")); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("La directory dati è già usata da un altro server.")); });
    let received = "";
    child.stdout?.on("data", chunk => {
      if (ready) return;
      received += String(chunk);
      if (!received.includes("\n") && received.length < 100) return;
      clearTimeout(timer);
      if (received.trim() !== "LOCKED") { child.kill(); reject(new Error("Lock OS non confermato.")); }
      else { ready = true; accept(); }
    });
  });
  return async () => {
    released = true;
    if (child.exitCode !== null) return;
    await new Promise<void>(done => { child.once("exit", () => done()); child.stdin?.end(); });
  };
}

export async function readJson(path: string, max = MAX_FILE_BYTES): Promise<unknown | undefined> {
  let handle: fs.FileHandle;
  try {
    const info = await fs.lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > max) throw new Error("File dati non regolare o troppo grande.");
    handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino) {
      await handle.close(); throw new Error("File cambiato durante la lettura.");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    if ((await handle.stat()).size > max) throw new Error("File oltre il limite.");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(65536, max + 1 - total));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > max) throw new Error("File oltre il limite.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const data: unknown = JSON.parse(text);
    if (unsafeKeys(data)) throw new Error("Chiavi dati non ammesse.");
    return data;
  } finally { await handle.close(); }
}

export function unsafeKeys(value: unknown, depth = 0): boolean {
  if (depth > 64) return true;
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) =>
    ["__proto__", "constructor", "prototype"].includes(key) || unsafeKeys(entry, depth + 1));
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("Archivio oltre 80 MiB: nessun dato troncato.");
  const parent = resolve(path, "..");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("Directory dati non sicura.");
  const space = await fs.statfs(parent, { bigint: true });
  if (space.bavail * space.bsize < BigInt(bytes.length) + 1_048_576n)
    throw new Error("Spazio disco insufficiente: nessun dato troncato.");
  try {
    const old = await fs.lstat(path);
    if (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1) throw new Error("Destinazione dati non regolare.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temp = path + ".new-" + randomUUID();
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    await fs.rename(temp, path);
    if (process.platform !== "win32") {
      const directory = await fs.open(parent, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await handle.close().catch(() => undefined); await fs.unlink(temp).catch(() => undefined); }
}

const uuid = z.string().uuid();
const receiptSchema = serverCommandReceiptSchema;
const recordSchema = z.object({
  version: z.literal(1), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  book: bookSchema, activities: z.array(activitySchema).max(50_000),
  commands: z.record(uuid, receiptSchema).refine(v => Object.keys(v).length <= 2000),
  watermarks: z.record(uuid, z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)).optional(),
  runAuthorization: z.object({ commandId: uuid, runId: uuid,
    state: z.enum(["requested", "started", "stopped", "uncertain"]) }).strict().optional(),
  retrySchedule: retryScheduleSchema.optional(),
  outbox: z.object({
    bookId: uuid, operationId: uuid, revision: z.number().int().positive(), requestedAt: z.string().datetime(),
    state: z.enum(["pending", "syncing", "blocked"]), attempts: z.number().int().min(0),
    retryAfter: z.string().datetime().optional(), lastAttemptAt: z.string().datetime().optional(), lastError: z.string().max(500).optional(),
  }).strict().optional(),
  manualPushIntent: z.object({
    bookId: uuid, operationId: uuid, owner: z.string().max(100), repository: z.string().max(100), branch: z.string().max(200),
    baseSha: z.string().regex(/^[a-f0-9]{40}$/).optional(), sourceRevision: z.string().datetime(), preparedAt: z.string().datetime(),
  }).strict().optional(),
  structuralCheckpoints: z.record(uuid, z.unknown()).optional(),
}).strict();
function validateRecord(value: unknown): HostBookRecord {
  if (!value || typeof value !== "object" || unsafeKeys(value)) throw new Error("Archivio libro non valido.");
  if (!recordSchema.safeParse(value).success) throw new Error("Schema del contenitore libro non valido.");
  const r = value as HostBookRecord;
  if (r.version !== 1 || !Number.isSafeInteger(r.revision) || r.revision < 0 ||
      !Array.isArray(r.activities) || r.activities.length > 50_000 || !r.commands || typeof r.commands !== "object")
    throw new Error("Contenitore libro non valido.");
  bookSchema.parse(r.book); checkBookId(r.book.id); migrateBook(r.book);
  for (const activity of r.activities) {
    activitySchema.parse(activity);
    if (activity.bookId !== r.book.id) throw new Error("Attività di un altro libro nell'archivio.");
  }
  if (new Set(r.activities.map(a => a.id)).size !== r.activities.length ||
      r.outbox && r.outbox.bookId !== r.book.id ||
      r.retrySchedule && r.retrySchedule.bookId !== r.book.id ||
      r.manualPushIntent && r.manualPushIntent.bookId !== r.book.id)
    throw new Error("Identità operative divergenti nell'archivio.");
  return r;
}

export class FileBookStore {
  private tails = new Map<string, Promise<unknown>>();
  onCommit?: (id: string) => void;
  constructor(readonly root: string) {}
  private path(id: string): string { checkBookId(id); return join(this.root, id + ".bookwriter.json"); }
  async read(id: string): Promise<HostBookRecord | undefined> {
    const value = await readJson(this.path(id));
    if (value === undefined) return undefined;
    const record = validateRecord(value);
    if (record.book.id !== id) throw new Error("Identità del file libro divergente.");
    return record;
  }
  async list(): Promise<HostBookRecord[]> {
    const records: HostBookRecord[] = [];
    for (const id of await this.ids()) {
      const record = await this.read(id); if (record) records.push(record);
    }
    return records;
  }
  async ids(): Promise<string[]> {
    const names = (await fs.readdir(this.root)).filter(name => name.endsWith(".bookwriter.json"));
    if (names.length > MAX_BOOKS) throw new Error("Archivio oltre il limite di 200 libri: nessun elenco troncato.");
    return names.map(name => { const id = name.slice(0, -".bookwriter.json".length); checkBookId(id); return id; }).sort();
  }
  async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.tails.set(id, next);
    try { return await next; } finally { if (this.tails.get(id) === next) this.tails.delete(id); }
  }
  async create(record: HostBookRecord): Promise<void> {
    await this.serial("$inventory", () => this.serial(record.book.id, async () => {
      const count = (await fs.readdir(this.root)).filter(name => name.endsWith(".bookwriter.json")).length;
      if (count >= MAX_BOOKS) throw new Error("Limite di 200 libri raggiunto.");
      if (await this.read(record.book.id)) throw new Error("Il libro esiste già: nessuna copia sovrascritta.");
      validateRecord(record); await atomicJson(this.path(record.book.id), record);
      this.onCommit?.(record.book.id);
    }));
  }
  async transaction<T>(id: string, change: (record: HostBookRecord) => T | Promise<T>): Promise<T> {
    return this.serial(id, async () => {
      const record = await this.read(id);
      if (!record) throw new BookNotFound();
      const before = JSON.stringify(record);
      const result = await change(record);
      if (JSON.stringify(record) !== before) {
        record.revision++;
        validateRecord(record); await atomicJson(this.path(id), record); this.onCommit?.(id);
      }
      return structuredClone(result);
    });
  }
}
