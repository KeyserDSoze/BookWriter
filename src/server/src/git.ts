import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { GitHubGitCall, GitHubGitTransport } from "@engine/index";

/**
 * Git Data API of GitHub, answered with the real git CLI and one working copy per repository.
 * The engine keeps its logic (read ref → build tree → commit → fast-forward PATCH); this module only
 * speaks the same request shapes. Nothing here forces a push, and the PAT lives in a child environment.
 */

export interface GitWorkspaceOptions {
  /** Contains `git/<owner>__<repo>/` working copies and `git-home/`. */
  root: string;
  /** Tests and code injection only, never from the API. */
  urlFor?: (owner: string, repository: string) => string;
  /** Tests only: allow file:// remotes. */
  allowFileProtocol?: boolean;
  binary?: string;
  /** Per git process; local operations never wait longer than 30 s. */
  timeoutMs?: number;
  /** Pass the server's proxy and CA variables (HTTPS_PROXY, SSL_CERT_FILE…) to network git commands. Default true. */
  forwardNetworkEnvironment?: boolean;
}

const NETWORK_ERROR = "GitHub non raggiungibile. Controlla rete e autorizzazioni del browser.";
const SHA = /^[0-9a-f]{40}$/;
const MAX_BLOB_BYTES = 12 * 1024 * 1024;
const MAX_TREE_ENTRIES = 100_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const NETWORK_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_CHARS = 256 * 1024;
const MIN_GIT: [number, number] = [2, 32];
const IDENTITY = { name: "BookWriter Server", email: "bookwriter-server@users.noreply.github.com" };
const ZERO_SHA = "0".repeat(40);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ---------------------------------------------------------------------------------------------
// Validation shared with the engine (`validateRemote`) and tree path rules
// ---------------------------------------------------------------------------------------------

const validOwner = (owner: string) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37})$/.test(owner);
const validRepository = (name: string) =>
  /^[a-zA-Z0-9_.-]{1,100}$/.test(name) && name !== "." && name !== ".." && !/\.git$/i.test(name);
const validBranch = (branch: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,149}$/.test(branch) &&
  !branch.includes("..") && !branch.includes("//") && !branch.endsWith(".") && !branch.endsWith("/");

function isDotGitComponent(component: string): boolean {
  const plain = component.replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, "").toLowerCase();
  return /^\.git[. ]*(?::|$)/.test(plain) || /^git~\d+[. ]*(?::|$)/.test(plain);
}
/** True when a path must not become a tree entry (traversal, `.git`, control characters…). */
export function invalidTreePath(path: unknown): boolean {
  if (typeof path !== "string" || !path || path.length > 400) return true;
  if (/[\u0000-\u001f\u007f]/.test(path) || path.includes("\\") || LONE_SURROGATE.test(path)) return true;
  if (path.startsWith("/") || path.endsWith("/")) return true;
  return path.split("/").some(part => !part || part === "." || part === ".." || isDotGitComponent(part));
}

// ---------------------------------------------------------------------------------------------
// Process hardening
// ---------------------------------------------------------------------------------------------

export interface GitEnvironmentInput {
  home: string; hooksDir: string; configFile: string; allowFileProtocol: boolean;
  gitDir?: string; workTree?: string;
  /** Only for requests to github.com: sent as an HTTP header through env config, never argv or `.git/config`. */
  token?: string;
  /** Copy the proxy and CA variables of the server process (see FORWARDED_NETWORK_VARIABLES); off unless asked. */
  forwardNetwork?: boolean;
  extra?: Record<string, string>;
}
/** The only variables of the server's own environment that reach git beyond PATH: proxy and CA settings for network commands. */
const FORWARDED_NETWORK_VARIABLES = [
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH",
] as const;
/** Environment built from scratch: nothing of the server's own environment reaches git except PATH (and, for network commands, proxy and CA settings). */
export function buildGitEnvironment(input: GitEnvironmentInput): Record<string, string> {
  const env: Record<string, string> = {};
  const inherited = process.platform === "win32" ? ["PATH", "SystemRoot", "PATHEXT", "TEMP", "TMP", "ComSpec"] : ["PATH"];
  for (const name of inherited) { const value = process.env[name]; if (value !== undefined) env[name] = value; }
  if (input.forwardNetwork) for (const name of FORWARDED_NETWORK_VARIABLES) { const value = process.env[name]; if (value !== undefined) env[name] = value; }
  Object.assign(env, {
    HOME: input.home, XDG_CONFIG_HOME: input.home,
    ...(process.platform === "win32" ? { USERPROFILE: input.home } : {}),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: input.configFile,
    GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "",
    LC_ALL: "C", LANG: "C",
    GIT_ALLOW_PROTOCOL: input.allowFileProtocol ? "https:file" : "https",
    GIT_LITERAL_PATHSPECS: "1", GIT_OPTIONAL_LOCKS: "0",
  });
  if (input.gitDir) env.GIT_DIR = input.gitDir;
  if (input.workTree) env.GIT_WORK_TREE = input.workTree;
  const config: Array<[string, string]> = [
    ["core.hooksPath", input.hooksDir], ["credential.helper", ""], ["http.followRedirects", "false"],
    ["core.symlinks", "false"], ["core.autocrlf", "false"], ["core.fsmonitor", "false"],
    ["core.protectNTFS", "true"], ["core.protectHFS", "true"], ["core.longpaths", "true"],
    ["fetch.fsckObjects", "true"], ["transfer.fsckObjects", "true"],
    ["gc.auto", "0"], ["maintenance.auto", "false"], ["submodule.recurse", "false"],
    ["protocol.version", "2"], ["init.defaultBranch", "main"],
  ];
  if (input.token !== undefined) {
    if (!/^[\x21-\x7e]{1,1024}$/.test(input.token)) throw new Error("Token GitHub non valido.");
    config.push(["http.https://github.com/.extraheader",
      "Authorization: Basic " + Buffer.from("x-access-token:" + input.token, "utf8").toString("base64")]);
  }
  env.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, value], index) => { env["GIT_CONFIG_KEY_" + index] = key; env["GIT_CONFIG_VALUE_" + index] = value; });
  Object.assign(env, input.extra);
  return env;
}

interface Spawned { code: number; stdout: Buffer; stderr: string }
interface SpawnOptions {
  cwd: string; env: Record<string, string>; input?: string | Buffer; timeoutMs: number;
  signal?: AbortSignal; maxStdout?: number;
}
class GitTimeout extends Error {}
const abortError = () => new DOMException("Operazione annullata", "AbortError");

function spawnGit(binary: string, args: string[], options: SpawnOptions): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(abortError()); return; }
    const maxStdout = options.maxStdout ?? MAX_STDOUT_BYTES;
    const out: Buffer[] = []; const err: Buffer[] = [];
    let outSize = 0; let errSize = 0; let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess;
    const onAbort = () => stop(abortError());
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); action();
    };
    // A killed process may still hold a lock for a moment: the next operation waits for its exit.
    const stop = (error: Error) => finish(() => {
      child.kill("SIGKILL");
      const done = () => reject(error);
      child.once("exit", done);
      setTimeout(done, 2000).unref();
    });
    try {
      child = spawn(binary, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch { reject(new Error("Impossibile avviare Git: controlla l'installazione.")); return; }
    child.on("error", () => finish(() => reject(new Error("Impossibile avviare Git: controlla l'installazione e i permessi."))));
    child.stdout!.on("data", (chunk: Buffer) => {
      outSize += chunk.length;
      if (outSize > maxStdout) { stop(new Error("L'output di Git supera il limite consentito.")); return; }
      out.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (errSize >= MAX_STDERR_BYTES) return;
      const part = chunk.subarray(0, MAX_STDERR_BYTES - errSize);
      errSize += part.length; err.push(part);
    });
    child.on("close", code => finish(() => resolve({
      code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8"),
    })));
    child.stdin!.on("error", () => undefined);
    child.stdin!.end(options.input);
    timer = setTimeout(() => stop(new GitTimeout()), options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------------------------
// Request model
// ---------------------------------------------------------------------------------------------

type Out = { status: number; json: unknown };
const ok = (json: unknown, status = 200): Out => ({ status, json });
class Reply extends Error { constructor(readonly status: number, message: string) { super(message); } }
const notFound = () => new Reply(404, "Non trovato.");
const invalid = (message = "Richiesta non valida.") => new Reply(422, message);

interface Workspace {
  owner: string; repository: string; key: string; dir: string; gitDir: string; url: string; authenticated: boolean;
}
interface RunOptions { input?: string | Buffer; network?: boolean; env?: Record<string, string>; maxStdout?: number }
interface Ctx {
  ws: Workspace; signal: AbortSignal | undefined;
  run(args: string[], options?: RunOptions): Promise<Spawned>;
}
type Action = (ctx: Ctx) => Promise<Out>;
type Parsed = { immediate: Out } | { owner: string; repository: string; run: Action };

type Failure = "ref" | "repository" | "unauthorized" | "forbidden" | "rejected" | "network";
function classify(text: string): Failure {
  if (/couldn't find remote ref|not our ref|no such remote ref|unadvertised object/i.test(text)) return "ref";
  if (/\[rejected\]|non-fast-forward|fetch first|stale info/i.test(text)) return "rejected";
  if (/\[remote rejected\]|protected branch|GH0\d\d/i.test(text)) return "forbidden";
  if (/Authentication failed|Bad credentials|Invalid username|could not read (?:Username|Password)|terminal prompts disabled|error: 401\b/i.test(text)) return "unauthorized";
  if (/Permission to .+ denied|error: 403\b|access denied|forbidden/i.test(text)) return "forbidden";
  if (/Repository not found|repository '[^']*' not found|error: 404\b/i.test(text)) return "repository";
  return "network";
}
/** Fixed messages only: git's own text can carry URLs and is never forwarded. */
function raise(failure: Failure): never {
  switch (failure) {
    case "ref": case "repository": throw notFound();
    case "unauthorized": throw new Reply(401, "Credenziali GitHub non valide.");
    case "forbidden": throw new Reply(403, "GitHub ha negato l'accesso o la modifica.");
    case "rejected": throw new Reply(422, "GitHub ha rifiutato la modifica: il ramo è cambiato.");
    default: throw new Error(NETWORK_ERROR);
  }
}

async function must(ctx: Ctx, args: string[], options?: RunOptions): Promise<Spawned> {
  const result = await ctx.run(args, options);
  if (result.code !== 0) throw new Error("Operazione Git locale non riuscita.");
  return result;
}
async function objectType(ctx: Ctx, sha: string): Promise<string | null> {
  const result = await ctx.run(["cat-file", "-t", sha]);
  return result.code === 0 ? result.stdout.toString("utf8").trim() : null;
}
async function unlockRef(ctx: Ctx, branch: string): Promise<void> {
  const parts = branch.split("/");
  for (const file of [join(ctx.ws.gitDir, "refs", "heads", ...parts) + ".lock", join(ctx.ws.gitDir, "refs", "remotes", "origin", ...parts) + ".lock"])
    await fs.rm(file, { force: true }).catch(() => undefined);
}

async function fetchBranch(ctx: Ctx, branch: string): Promise<string | null> {
  await unlockRef(ctx, branch);
  const result = await ctx.run(["fetch", "--no-tags", "--quiet", "origin", "refs/heads/" + branch], { network: true });
  if (result.code !== 0) {
    const failure = classify(result.stderr);
    if (failure === "ref") return null;
    raise(failure);
  }
  const head = (await must(ctx, ["rev-parse", "--verify", "--quiet", "FETCH_HEAD^{commit}"])).stdout.toString("utf8").trim();
  if (!SHA.test(head)) throw new Error("Operazione Git locale non riuscita.");
  await ctx.run(["update-ref", "refs/remotes/origin/" + branch, head]);
  return head;
}
async function fetchObject(ctx: Ctx, sha: string): Promise<void> {
  const result = await ctx.run(["fetch", "--no-tags", "--quiet", "origin", sha], { network: true });
  if (result.code === 0) return;
  const failure = classify(result.stderr);
  if (failure !== "ref") raise(failure);
}
/** A commit (or tree) named by SHA or by branch; objects missing locally are fetched, never guessed. */
async function resolveRef(ctx: Ctx, ref: string, types: string[]): Promise<string | null> {
  const lower = ref.toLowerCase();
  if (SHA.test(lower)) {
    let type = await objectType(ctx, lower);
    if (!type) { await fetchObject(ctx, lower); type = await objectType(ctx, lower); }
    return type && types.includes(type) ? lower : null;
  }
  return validBranch(ref) ? fetchBranch(ctx, ref) : null;
}
async function remoteHeads(ctx: Ctx, pattern?: string): Promise<Map<string, string>> {
  const result = await ctx.run(["ls-remote", "--heads", "origin", ...(pattern ? [pattern] : [])], { network: true });
  if (result.code !== 0) raise(classify(result.stderr));
  const heads = new Map<string, string>();
  for (const line of result.stdout.toString("utf8").split("\n")) {
    const match = /^([0-9a-f]{40})\t(refs\/heads\/.+)$/.exec(line);
    if (match) heads.set(match[2]!, match[1]!);
  }
  return heads;
}
async function pushRef(ctx: Ctx, sha: string, ref: string): Promise<void> {
  // Never `--force`, `+src:dst` or `--force-with-lease`: a remote that moved rejects the update.
  const result = await ctx.run(["push", "--porcelain", "--no-verify", "--no-recurse-submodules", "origin", sha + ":" + ref], { network: true });
  const text = result.stdout.toString("utf8");
  if (result.code === 0 && !/^!\t/m.test(text)) return;
  // A failure git cannot explain may or may not have reached the server: the engine proves it by reading.
  raise(classify(text + "\n" + result.stderr));
}

interface TreeEntry { mode: string; type: string; sha: string; size: number | null; path: string }
function parseTree(raw: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of raw.toString("utf8").split("\0")) {
    if (!record) continue;
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}) +(-|\d+)\t([\s\S]*)$/.exec(record);
    if (!match) throw new Error("Elenco Git non valido.");
    entries.push({ mode: match[1]!, type: match[2]!, sha: match[3]!, size: match[4] === "-" ? null : Number(match[4]), path: match[5]! });
  }
  return entries;
}
const gitHubType = (entry: TreeEntry) => entry.type === "tree" ? "dir" : entry.type === "commit" ? "submodule" : entry.mode === "120000" ? "symlink" : "file";

function paging(query: URLSearchParams): { perPage: number; page: number } {
  const number = (name: string, fallback: number) => {
    const raw = query.get(name);
    if (raw === null) return fallback;
    if (!/^\d{1,6}$/.test(raw)) throw invalid("Parametro di paginazione non valido.");
    return Number(raw);
  };
  return { perPage: Math.min(100, Math.max(1, number("per_page", 30))), page: Math.max(1, number("page", 1)) };
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const onlyQuery = (query: URLSearchParams, keys: string[]) => [...query.keys()].every(key => keys.includes(key));

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

async function getRef(ctx: Ctx, branch: string): Promise<Out> {
  if (!validBranch(branch)) throw notFound();
  const sha = await fetchBranch(ctx, branch);
  if (!sha) throw notFound();
  return ok({ ref: "refs/heads/" + branch, object: { type: "commit", sha } });
}

async function blobBase64(ctx: Ctx, sha: string, size: number | null): Promise<string> {
  if (size !== null && size > MAX_BLOB_BYTES) throw new Reply(413, "Contenuto troppo grande.");
  const blob = await must(ctx, ["cat-file", "blob", sha], { maxStdout: MAX_BLOB_BYTES + 1024 });
  return blob.stdout.toString("base64");
}

async function getContents(ctx: Ctx, path: string, ref: string): Promise<Out> {
  const commit = await resolveRef(ctx, ref, ["commit"]);
  if (!commit || path && invalidTreePath(path)) throw notFound();
  const describe = (entry: TreeEntry, fullPath: string) => ({
    type: gitHubType(entry), name: fullPath.split("/").pop(), path: fullPath, sha: entry.sha, size: entry.size ?? 0,
  });
  if (!path) {
    const root = parseTree((await must(ctx, ["ls-tree", "-z", "-l", "--full-tree", commit])).stdout);
    return ok(root.map(entry => describe(entry, entry.path)));
  }
  const found = parseTree((await must(ctx, ["ls-tree", "-z", "-l", "--full-tree", commit, "--", path])).stdout)
    .find(entry => entry.path === path);
  if (!found) throw notFound();
  if (found.type === "tree") {
    const children = parseTree((await must(ctx, ["ls-tree", "-z", "-l", found.sha])).stdout);
    return ok(children.map(entry => describe(entry, path + "/" + entry.path)));
  }
  if (gitHubType(found) !== "file") return ok(describe(found, path));
  return ok({ ...describe(found, path), encoding: "base64", content: await blobBase64(ctx, found.sha, found.size) });
}

function parseCommit(sha: string, raw: Buffer): unknown {
  const split = raw.indexOf("\n\n");
  const header = raw.subarray(0, split < 0 ? raw.length : split).toString("utf8");
  const message = split < 0 ? "" : raw.subarray(split + 2).toString("utf8");
  let tree = ""; const parents: Array<{ sha: string }> = [];
  const people: Record<string, unknown> = {};
  for (const line of header.split("\n")) {
    if (line.startsWith("tree ")) tree = line.slice(5).trim();
    else if (line.startsWith("parent ")) parents.push({ sha: line.slice(7).trim() });
    else {
      const person = /^(author|committer) (.*) <(.*)> (\d+) [+-]\d{4}$/.exec(line);
      if (person) people[person[1]!] = { name: person[2], email: person[3], date: new Date(Number(person[4]) * 1000).toISOString().replace(".000Z", "Z") };
    }
  }
  if (!SHA.test(tree) || parents.some(parent => !SHA.test(parent.sha))) throw new Error("Commit Git non valido.");
  return { sha, message, tree: { sha: tree }, parents, ...people };
}
async function getCommit(ctx: Ctx, ref: string): Promise<Out> {
  const sha = SHA.test(ref.toLowerCase()) ? await resolveRef(ctx, ref, ["commit"]) : null;
  if (!sha) throw notFound();
  return ok(parseCommit(sha, (await must(ctx, ["cat-file", "commit", sha])).stdout));
}

async function getCommits(ctx: Ctx, ref: string, query: URLSearchParams): Promise<Out> {
  const { perPage, page } = paging(query);
  const sha = await resolveRef(ctx, ref, ["commit"]);
  if (!sha) throw notFound();
  const listed = await must(ctx, ["rev-list", "--skip=" + (page - 1) * perPage, "--max-count=" + perPage, sha, "--"]);
  return ok(listed.stdout.toString("utf8").split("\n").filter(line => SHA.test(line)).map(line => ({ sha: line })));
}

async function getTree(ctx: Ctx, ref: string, recursive: boolean): Promise<Out> {
  const resolved = await resolveRef(ctx, ref, ["commit", "tree"]);
  if (!resolved) throw notFound();
  const treeSha = (await must(ctx, ["rev-parse", "--verify", resolved + "^{tree}"])).stdout.toString("utf8").trim();
  const listed = parseTree((await must(ctx, ["ls-tree", "-z", "-l", ...(recursive ? ["-r", "-t"] : []), "--full-tree", treeSha])).stdout);
  const truncated = listed.length > MAX_TREE_ENTRIES;
  return ok({
    sha: treeSha, truncated,
    tree: listed.slice(0, MAX_TREE_ENTRIES).map(entry => ({
      path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha, ...(entry.type === "blob" && entry.size !== null ? { size: entry.size } : {}),
    })),
  });
}

async function getBlob(ctx: Ctx, ref: string): Promise<Out> {
  const sha = ref.toLowerCase();
  if (!SHA.test(sha) || await objectType(ctx, sha) !== "blob") throw notFound();
  const size = Number((await must(ctx, ["cat-file", "-s", sha])).stdout.toString("utf8").trim());
  return ok({ sha, encoding: "base64", size, content: await blobBase64(ctx, sha, size) });
}

async function postTree(ctx: Ctx, body: unknown): Promise<Out> {
  if (!isRecord(body) || !onlyKeys(body, ["base_tree", "tree"]) || !Array.isArray(body.tree) || body.tree.length > 50_000)
    throw invalid("Albero non valido.");
  let size: number;
  try { size = JSON.stringify(body.tree).length; } catch { throw invalid("Albero non valido."); }
  if (size > MAX_BLOB_BYTES) throw new Reply(413, "L'operazione supera il limite di 12 MiB.");
  const baseRaw = body.base_tree;
  if (baseRaw !== undefined && baseRaw !== null && (typeof baseRaw !== "string" || !SHA.test(baseRaw.toLowerCase())))
    throw invalid("Albero di base non valido.");
  const entries: Array<{ path: string; content: string | null }> = [];
  const seen = new Set<string>();
  for (const raw of body.tree) {
    if (!isRecord(raw) || !onlyKeys(raw, ["path", "mode", "type", "content", "sha"]) || raw.mode !== "100644" || raw.type !== "blob")
      throw invalid("Voce dell'albero non valida.");
    const hasContent = typeof raw.content === "string";
    if (!(hasContent && raw.sha === undefined) && !(raw.content === undefined && raw.sha === null)) throw invalid("Voce dell'albero non valida.");
    const path = raw.path;
    if (invalidTreePath(path)) throw invalid("Percorso non valido.");
    if (hasContent && LONE_SURROGATE.test(raw.content as string)) throw invalid("Contenuto non valido.");
    if (seen.has(path as string)) throw invalid("Percorso duplicato.");
    seen.add(path as string);
    entries.push({ path: path as string, content: hasContent ? raw.content as string : null });
  }
  for (const path of seen)
    for (let slash = path.indexOf("/"); slash > 0; slash = path.indexOf("/", slash + 1))
      if (seen.has(path.slice(0, slash))) throw invalid("Percorso in conflitto.");
  let base: string | undefined;
  if (typeof baseRaw === "string") {
    base = baseRaw.toLowerCase();
    const type = await objectType(ctx, base);
    if (type !== "tree" && type !== "commit") throw invalid("Albero di base sconosciuto.");
  }
  const suffix = randomBytes(8).toString("hex");
  const work = join(ctx.ws.gitDir, "bw-" + suffix);
  const index = join(ctx.ws.gitDir, "bw-index-" + suffix);
  const env = { GIT_INDEX_FILE: index };
  try {
    await fs.mkdir(work, { mode: 0o700 });
    const written = entries.filter(entry => entry.content !== null);
    const files: string[] = [];
    for (const [number, entry] of written.entries()) {
      const file = join(work, number + ".blob");
      await fs.writeFile(file, Buffer.from(entry.content!, "utf8"), { mode: 0o600 });
      files.push(file);
    }
    const hashes = written.length
      ? (await must(ctx, ["hash-object", "-w", "--no-filters", "--stdin-paths"], { input: files.join("\n") + "\n" })).stdout.toString("utf8").split("\n").filter(Boolean)
      : [];
    if (hashes.length !== written.length || hashes.some(hash => !SHA.test(hash))) throw new Error("Operazione Git locale non riuscita.");
    if (base) await must(ctx, ["read-tree", base], { env });
    let cursor = 0;
    const info = entries.map(entry => entry.content === null
      ? "0 " + ZERO_SHA + "\t" + entry.path + "\0"
      : "100644 " + hashes[cursor++] + "\t" + entry.path + "\0").join("");
    if (info) {
      const update = await ctx.run(["update-index", "-z", "--index-info"], { input: info, env });
      if (update.code !== 0) throw invalid("Percorso non accettato.");
    }
    const tree = (await must(ctx, ["write-tree"], { env })).stdout.toString("utf8").trim();
    if (!SHA.test(tree)) throw new Error("Operazione Git locale non riuscita.");
    return ok({ sha: tree }, 201);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(index, { force: true }).catch(() => undefined);
    await fs.rm(index + ".lock", { force: true }).catch(() => undefined);
  }
}

async function postCommit(ctx: Ctx, body: unknown): Promise<Out> {
  if (!isRecord(body) || !onlyKeys(body, ["message", "tree", "parents"]) || typeof body.message !== "string" ||
      typeof body.tree !== "string" || !Array.isArray(body.parents) || body.parents.length > 16)
    throw invalid("Commit non valido.");
  const message = body.message;
  if (message.length > MAX_MESSAGE_CHARS || message.includes("\0") || LONE_SURROGATE.test(message)) throw invalid("Messaggio non valido.");
  const tree = body.tree.toLowerCase();
  if (!SHA.test(tree) || await objectType(ctx, tree) !== "tree") throw invalid("Albero sconosciuto.");
  const parents: string[] = [];
  for (const raw of body.parents) {
    const parent = typeof raw === "string" ? raw.toLowerCase() : "";
    if (!SHA.test(parent) || parents.includes(parent) || await objectType(ctx, parent) !== "commit") throw invalid("Commit padre sconosciuto.");
    parents.push(parent);
  }
  const created = await must(ctx, ["commit-tree", tree, ...parents.flatMap(parent => ["-p", parent]), "-F", "-"], {
    input: Buffer.from(message, "utf8"),
    env: { GIT_AUTHOR_NAME: IDENTITY.name, GIT_AUTHOR_EMAIL: IDENTITY.email, GIT_COMMITTER_NAME: IDENTITY.name, GIT_COMMITTER_EMAIL: IDENTITY.email },
  });
  const sha = created.stdout.toString("utf8").trim();
  if (!SHA.test(sha)) throw new Error("Operazione Git locale non riuscita.");
  return ok({ sha }, 201);
}

async function localCommit(ctx: Ctx, raw: unknown): Promise<string> {
  const sha = typeof raw === "string" ? raw.toLowerCase() : "";
  if (!SHA.test(sha) || await objectType(ctx, sha) !== "commit") throw invalid("Commit sconosciuto.");
  return sha;
}
async function patchRef(ctx: Ctx, branch: string, body: unknown): Promise<Out> {
  if (!validBranch(branch)) throw invalid("Nome del ramo non valido.");
  if (!isRecord(body) || !onlyKeys(body, ["sha", "force"]) || body.force !== false) throw invalid("Il force push non è consentito.");
  const sha = await localCommit(ctx, body.sha);
  const ref = "refs/heads/" + branch;
  await unlockRef(ctx, branch);
  if (!(await remoteHeads(ctx, ref)).has(ref)) throw invalid("Il ramo non esiste.");
  await pushRef(ctx, sha, ref);
  // The push is what counts: a working folder that cannot be refreshed never turns it into a failure.
  try {
    await ctx.run(["update-ref", "refs/remotes/origin/" + branch, sha]);
    await ctx.run(["checkout", "-f", "-B", branch, sha, "--"]);
    await ctx.run(["clean", "-ffdx"]);
  } catch { /* best effort */ }
  return ok({ ref, object: { type: "commit", sha } });
}
/** Delete a branch: the only deletion the engine asks for, after it proved the branch is merged. Lease branches are never touched. */
async function deleteRef(ctx: Ctx, branch: string): Promise<Out> {
  if (!validBranch(branch) || branch.startsWith("bookwriter-lock/")) throw invalid("Nome del ramo non valido.");
  const ref = "refs/heads/" + branch;
  await unlockRef(ctx, branch);
  if (!(await remoteHeads(ctx, ref)).has(ref)) throw invalid("Il ramo non esiste.");
  const result = await ctx.run(["push", "--porcelain", "--no-verify", "--no-recurse-submodules", "origin", ":" + ref], { network: true });
  if (result.code !== 0 || /^!\t/m.test(result.stdout.toString("utf8"))) raise(classify(result.stdout.toString("utf8") + "\n" + result.stderr));
  await ctx.run(["update-ref", "-d", "refs/remotes/origin/" + branch]);
  return ok({}, 204);
}
async function postRef(ctx: Ctx, body: unknown): Promise<Out> {
  if (!isRecord(body) || !onlyKeys(body, ["ref", "sha"]) || typeof body.ref !== "string" ||
      !body.ref.startsWith("refs/heads/") || !validBranch(body.ref.slice(11)))
    throw invalid("Riferimento non valido.");
  const sha = await localCommit(ctx, body.sha);
  const ref = body.ref;
  await unlockRef(ctx, ref.slice(11));
  if ((await remoteHeads(ctx, ref)).has(ref)) throw invalid("Il ramo esiste già.");
  await pushRef(ctx, sha, ref);
  await ctx.run(["update-ref", "refs/remotes/origin/" + ref.slice(11), sha]);
  return ok({ ref, object: { type: "commit", sha } }, 201);
}

async function getBranches(ctx: Ctx, query: URLSearchParams): Promise<Out> {
  const { perPage, page } = paging(query);
  const names = [...await remoteHeads(ctx)].map(([ref, sha]) => ({ name: ref.slice(11), commit: { sha } }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return ok(names.slice((page - 1) * perPage, page * perPage));
}

async function getCompare(ctx: Ctx, spec: string): Promise<Out> {
  const at = spec.indexOf("...");
  if (at <= 0 || at + 3 >= spec.length || spec.indexOf("...", at + 3) >= 0) throw invalid("Confronto non valido.");
  const a = await resolveRef(ctx, spec.slice(0, at), ["commit"]);
  const b = a && await resolveRef(ctx, spec.slice(at + 3), ["commit"]);
  if (!a || !b) throw notFound();
  const count = async (range: string) => Number((await must(ctx, ["rev-list", "--count", range, "--"])).stdout.toString("utf8").trim());
  const [ahead, behind] = [await count(a + ".." + b), await count(b + ".." + a)];
  const base = await ctx.run(["merge-base", a, b]);
  const baseSha = base.code === 0 ? base.stdout.toString("utf8").trim() : "";
  if (base.code > 1) throw new Error("Operazione Git locale non riuscita.");
  return ok({
    status: ahead === 0 && behind === 0 ? "identical" : behind === 0 ? "ahead" : ahead === 0 ? "behind" : "diverged",
    ahead_by: ahead, behind_by: behind, merge_base_commit: SHA.test(baseSha) ? { sha: baseSha } : null,
  });
}

// ---------------------------------------------------------------------------------------------
// Routing: only the Git Data subset the engine uses; everything else returns undefined (HTTPS)
// ---------------------------------------------------------------------------------------------

function match(method: string, p: string[], query: URLSearchParams, body: unknown): Action | undefined {
  if (method === "GET") {
    if (p[0] === "git" && p[1] === "ref" && p[2] === "heads" && p.length >= 4 && onlyQuery(query, []))
      return ctx => getRef(ctx, p.slice(3).join("/"));
    if (p[0] === "git" && p[1] === "commits" && p.length === 3 && onlyQuery(query, []))
      return ctx => getCommit(ctx, p[2]!);
    if (p[0] === "git" && p[1] === "trees" && p.length >= 3 && onlyQuery(query, ["recursive"]))
      return ctx => getTree(ctx, p.slice(2).join("/"), query.get("recursive") === "1" || query.get("recursive") === "true");
    if (p[0] === "git" && p[1] === "blobs" && p.length === 3 && onlyQuery(query, []))
      return ctx => getBlob(ctx, p[2]!);
    if (p[0] === "contents" && query.get("ref") && onlyQuery(query, ["ref"]))
      return ctx => getContents(ctx, p.slice(1).join("/"), query.get("ref")!);
    if (p[0] === "commits" && p.length === 1 && query.get("sha") && onlyQuery(query, ["sha", "per_page", "page"]))
      return ctx => getCommits(ctx, query.get("sha")!, query);
    if (p[0] === "branches" && p.length === 1 && onlyQuery(query, ["per_page", "page"]))
      return ctx => getBranches(ctx, query);
    if (p[0] === "compare" && p.length >= 2 && onlyQuery(query, ["per_page", "page"]))
      return ctx => getCompare(ctx, p.slice(1).join("/"));
  } else if (method === "POST") {
    if (p[0] === "git" && p.length === 2 && onlyQuery(query, [])) {
      if (p[1] === "trees") return ctx => postTree(ctx, body);
      if (p[1] === "commits") return ctx => postCommit(ctx, body);
      if (p[1] === "refs") return ctx => postRef(ctx, body);
    }
  } else if (method === "PATCH") {
    if (p[0] === "git" && p[1] === "refs" && p[2] === "heads" && p.length >= 4 && onlyQuery(query, []))
      return ctx => patchRef(ctx, p.slice(3).join("/"), body);
  } else if (method === "DELETE") {
    if (p[0] === "git" && p[1] === "refs" && p[2] === "heads" && p.length >= 4 && onlyQuery(query, []))
      return ctx => deleteRef(ctx, p.slice(3).join("/"));
  }
  return undefined;
}

function parse(call: GitHubGitCall): Parsed | undefined {
  let url: URL;
  try { url = new URL(call.path, "https://api.github.com"); } catch { return undefined; }
  const parts = url.pathname.split("/");
  if (parts[0] !== "" || parts[1] !== "repos" || parts.length < 5) return undefined;
  let decoded: string[];
  try { decoded = parts.slice(2).map(decodeURIComponent); } catch { return undefined; }
  if (decoded.length > 3 && decoded[decoded.length - 1] === "") decoded.pop();
  const [owner = "", repository = "", ...rest] = decoded;
  const run = match(call.method.toUpperCase(), rest, url.searchParams, call.body);
  if (!run) return undefined;
  if (!validOwner(owner) || !validRepository(repository) || decoded.some(part => /[/\\\0]/.test(part)))
    return { immediate: { status: 422, json: { message: "Percorso non valido." } } };
  return { owner, repository, run };
}

// ---------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------

const exists = (path: string) => fs.stat(path).then(() => true, () => false);

export class GitWorkspaces {
  readonly transport: GitHubGitTransport = { handle: call => this.handle(call) };
  private readonly root: string;
  private readonly home: string;
  private readonly hooksDir: string;
  private readonly configFile: string;
  private readonly urlFor: (owner: string, repository: string) => string;
  private readonly allowFile: boolean;
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly forwardNetwork: boolean;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly ready = new Set<string>();
  private homeReady: Promise<void> | undefined;
  private closed = false;

  constructor(options: GitWorkspaceOptions) {
    this.root = options.root;
    this.home = join(options.root, "git-home");
    this.hooksDir = join(this.home, "hooks-empty");
    this.configFile = join(this.home, "gitconfig");
    this.urlFor = options.urlFor ?? ((owner, repository) => `https://github.com/${owner}/${repository}.git`);
    this.allowFile = options.allowFileProtocol === true;
    this.binary = options.binary ?? "git";
    this.timeoutMs = options.timeoutMs ?? NETWORK_TIMEOUT_MS;
    this.forwardNetwork = options.forwardNetworkEnvironment !== false;
  }

  static async probe(binary = "git"): Promise<{ version: string }> {
    const env: Record<string, string> = {};
    for (const name of process.platform === "win32" ? ["PATH", "SystemRoot", "PATHEXT", "TEMP", "TMP", "ComSpec"] : ["PATH"]) {
      const value = process.env[name]; if (value !== undefined) env[name] = value;
    }
    let result: Spawned;
    try { result = await spawnGit(binary, ["--version"], { cwd: process.cwd(), env, timeoutMs: 10_000 }); }
    catch { throw new Error("Git non trovato: installa Git " + MIN_GIT.join(".") + " o successivo e riavvia il server."); }
    const found = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(result.stdout.toString("utf8"));
    if (result.code !== 0 || !found) throw new Error("Git non risponde come previsto: controlla l'installazione.");
    const [major, minor] = [Number(found[1]), Number(found[2])];
    const version = found.slice(1).filter(Boolean).join(".");
    if (major < MIN_GIT[0] || major === MIN_GIT[0] && minor < MIN_GIT[1])
      throw new Error(`Git ${version} è troppo vecchio: serve la versione ${MIN_GIT.join(".")} o successiva.`);
    return { version };
  }

  workspacePath(owner: string, repository: string): string {
    if (!validOwner(owner) || !validRepository(repository)) throw new Error("Repository GitHub non valida.");
    return this.workspace(owner, repository).dir;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.queues.values()]);
  }

  private workspace(owner: string, repository: string): Workspace {
    const lower = [owner.toLowerCase(), repository.toLowerCase()] as const;
    // The owner has no underscore, so `owner__repository` is unique; a trailing dot would vanish on Windows.
    const key = lower.join("__") + (lower[1].endsWith(".") ? "~" : "");
    const raw = this.urlFor(lower[0], lower[1]);
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw new Error("URL della repository non valido."); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash ||
        parsed.protocol !== "https:" && !(parsed.protocol === "file:" && this.allowFile))
      throw new Error("URL della repository non consentito.");
    const dir = join(this.root, "git", key);
    return {
      owner, repository, key, dir, gitDir: join(dir, ".git"), url: raw,
      authenticated: parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.port === "",
    };
  }

  private ensureHome(): Promise<void> {
    this.homeReady ??= (async () => {
      await fs.mkdir(this.home, { recursive: true, mode: 0o700 });
      await fs.mkdir(this.hooksDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(this.configFile, "", { flag: "a", mode: 0o600 });
    })().catch(error => { this.homeReady = undefined; throw error; });
    return this.homeReady;
  }

  private async spawn(ws: Workspace, token: string, signal: AbortSignal | undefined, args: string[], options: RunOptions & { init?: boolean } = {}): Promise<Spawned> {
    const network = options.network === true;
    const env = buildGitEnvironment({
      home: this.home, hooksDir: this.hooksDir, configFile: this.configFile, allowFileProtocol: this.allowFile,
      ...options.init ? {} : { gitDir: ws.gitDir, workTree: ws.dir },
      ...network && ws.authenticated ? { token } : {}, ...network && this.forwardNetwork ? { forwardNetwork: true } : {}, extra: options.env,
    });
    try {
      return await spawnGit(this.binary, args, {
        cwd: ws.dir, env, input: options.input, signal, maxStdout: options.maxStdout,
        timeoutMs: network ? this.timeoutMs : Math.min(LOCAL_TIMEOUT_MS, this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof GitTimeout) throw new Error(network ? NETWORK_ERROR : "Operazione Git locale scaduta.");
      throw error;
    }
  }

  private async prepare(ws: Workspace, token: string, signal: AbortSignal | undefined): Promise<void> {
    await this.ensureHome();
    await fs.mkdir(join(this.root, "git"), { recursive: true, mode: 0o700 });
    if (!await exists(ws.gitDir)) {
      if (await exists(ws.dir) && (await fs.readdir(ws.dir)).length)
        throw new Error("La cartella di lavoro Git esiste ma non è un repository: non viene riutilizzata.");
      await fs.mkdir(ws.dir, { recursive: true, mode: 0o700 });
    }
    const step = async (args: string[], init = false) => {
      const result = await this.spawn(ws, token, signal, args, { init });
      if (result.code !== 0) throw new Error("Preparazione della cartella di lavoro Git non riuscita.");
    };
    await step(["init", "-q", "--template="], true);
    const origin = await this.spawn(ws, token, signal, ["config", "--get", "remote.origin.url"]);
    if (origin.code === 0) {
      if (origin.stdout.toString("utf8").trim() !== ws.url)
        throw new Error("La cartella di lavoro Git esistente punta a un'altra origine: non viene riutilizzata.");
    } else if (origin.code === 1) await step(["remote", "add", "origin", ws.url]);
    else throw new Error("Preparazione della cartella di lavoro Git non riuscita.");
    for (const name of await fs.readdir(ws.gitDir).catch(() => [] as string[]))
      if (name.startsWith("bw-")) await fs.rm(join(ws.gitDir, name), { recursive: true, force: true }).catch(() => undefined);
  }

  private async execute(owner: string, repository: string, run: Action, call: GitHubGitCall): Promise<Out> {
    const ws = this.workspace(owner, repository);
    if (ws.authenticated && !/^[\x21-\x7e]{1,1024}$/.test(call.token))
      return { status: 401, json: { message: "Credenziali GitHub non valide." } };
    if (call.signal?.aborted) throw abortError();
    if (!this.ready.has(ws.key)) { await this.prepare(ws, call.token, call.signal); this.ready.add(ws.key); }
    // The process is the only writer of this folder: a lock left by a crash is stale by definition.
    for (const name of ["index.lock", "shallow.lock", "HEAD.lock", "packed-refs.lock"])
      await fs.rm(join(ws.gitDir, name), { force: true }).catch(() => undefined);
    const ctx: Ctx = { ws, signal: call.signal, run: (args, options) => this.spawn(ws, call.token, call.signal, args, options) };
    try { return await run(ctx); }
    catch (error) {
      if (error instanceof Reply) return { status: error.status, json: { message: error.message } };
      throw error;
    }
  }

  private async handle(call: GitHubGitCall): Promise<Out | undefined> {
    if (this.closed) throw new Error("Il trasporto Git è chiuso.");
    const parsed = parse(call);
    if (!parsed) return undefined;
    if ("immediate" in parsed) return parsed.immediate;
    const key = this.workspace(parsed.owner, parsed.repository).key;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const task = previous.then(() => this.execute(parsed.owner, parsed.repository, parsed.run, call));
    const tail = task.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.then(() => { if (this.queues.get(key) === tail) this.queues.delete(key); });
    return task;
  }
}
