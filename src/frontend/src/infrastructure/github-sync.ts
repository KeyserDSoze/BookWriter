import { z } from "zod";
import type { Activity, BookProject, GitHubRemote } from "../domain/types";
import { projectBook } from "../domain/narrarium";
import { decryptLocal } from "./crypto";
import { getDb, getBook, listActivities, loadSettings } from "./db";

const BASE = "https://api.github.com";
const MAX_BYTES = 12 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{40}$/i;
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string().uuid(),
  paths: z.array(z.string()).max(20_000),
});

export class RemoteConflict extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RemoteConflict";
  }
}

export function validateRemote(remote: Pick<GitHubRemote, "owner" | "repository" | "branch">): GitHubRemote {
  const owner = remote.owner.trim();
  const repository = remote.repository.trim();
  const branch = remote.branch.trim();
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37})$/.test(owner))
    throw new Error("Proprietario GitHub non valido.");
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(repository) || repository === "." || repository === "..")
    throw new Error("Nome repository GitHub non valido.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,149}$/.test(branch) ||
      branch.includes("..") || branch.includes("//") || branch.endsWith(".") || branch.endsWith("/"))
    throw new Error("Nome branch GitHub non valido.");
  return { owner, repository, branch };
}

function apiPath(remote: GitHubRemote, suffix: string): string {
  return "/repos/" + encodeURIComponent(remote.owner) + "/" + encodeURIComponent(remote.repository) + suffix;
}
function apiError(status: number): Error {
  if (status === 401) return new Error("PAT GitHub non valido o revocato (HTTP 401).");
  if (status === 403) return new Error("Permessi GitHub insufficienti, limite API o repository non autorizzata (HTTP 403).");
  if (status === 404) return new Error("Repository, file o branch non trovato con questo PAT (HTTP 404).");
  if (status === 409 || status === 422) return new RemoteConflict("GitHub ha rifiutato la modifica concorrente (HTTP " + status + "). Nessun force push effettuato.");
  return new Error("GitHub ha risposto con HTTP " + status + ".");
}
async function request<T>(
  token: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  allow404 = false,
): Promise<T | null> {
  const url = new URL(path, BASE);
  if (url.origin !== BASE || !url.pathname.startsWith("/repos/"))
    throw new Error("URL GitHub non autorizzato.");
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      mode: "cors",
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    if (init.signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
    throw new Error("GitHub non raggiungibile. Controlla rete e autorizzazioni del browser.");
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw apiError(response.status);
  const raw = await response.text();
  if (raw.length > MAX_BYTES * 2) throw new Error("Risposta GitHub troppo grande.");
  if (!raw.trim()) return {} as T;
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("GitHub ha restituito una risposta non valida."); }
}

function decodeBase64(text: string): string {
  const normalized = text.replace(/\s/g, "");
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, x => x.charCodeAt(0)));
}
async function tokenFromVault(): Promise<string> {
  const settings = await loadSettings();
  if (!settings.githubToken) throw new Error("Configura prima un PAT GitHub nelle Impostazioni.");
  return decryptLocal(settings.githubToken);
}

export interface RepoInfo { private: boolean; defaultBranch: string; canPush: boolean; fullName: string }
export async function inspectRepository(
  remote: GitHubRemote, signal?: AbortSignal,
): Promise<RepoInfo> {
  const token = await tokenFromVault();
  const info = await request<{
    private: boolean; default_branch: string; full_name: string;
    permissions?: { push?: boolean };
  }>(token, apiPath(remote, ""), { signal });
  if (!info) throw new Error("Repository non disponibile.");
  return {
    private: info.private,
    defaultBranch: info.default_branch,
    fullName: info.full_name,
    canPush: info.permissions?.push ?? false,
  };
}

async function headSha(token: string, remote: GitHubRemote, signal?: AbortSignal): Promise<string> {
  const response = await request<{ object?: { sha?: string } }>(
    token, apiPath(remote, "/git/ref/heads/" + remote.branch.split("/").map(encodeURIComponent).join("/")), { signal },
  );
  const sha = response?.object?.sha;
  if (!sha || !shaPattern.test(sha)) throw new Error("Il branch GitHub non punta a un commit valido.");
  return sha;
}

async function readFile(
  token: string, remote: GitHubRemote, path: string, ref: string, signal?: AbortSignal,
): Promise<string | null> {
  const url = apiPath(remote, "/contents/" + path.split("/").map(encodeURIComponent).join("/")) +
    "?ref=" + encodeURIComponent(ref);
  const result = await request<{
    type?: string; encoding?: string; content?: string; sha?: string;
  }>(token, url, { signal }, true);
  if (!result) return null;
  if (result.type !== "file") throw new Error("Il percorso GitHub non è un file.");
  if (result.encoding === "base64" && result.content) return decodeBase64(result.content);
  if (!result.sha || !shaPattern.test(result.sha)) throw new Error("GitHub non fornisce il blob del file.");
  const blob = await request<{ encoding: string; content: string; size?: number }>(
    token, apiPath(remote, "/git/blobs/" + result.sha), { signal },
  );
  if (!blob || blob.encoding !== "base64" || (blob.size ?? 0) > MAX_BYTES)
    throw new Error("Blob remoto mancante o troppo grande.");
  return decodeBase64(blob.content);
}

function parseJson<T>(text: string, label: string): T {
  if (text.length > MAX_BYTES) throw new Error(label + " supera il limite di 12 MiB.");
  try { return JSON.parse(text) as T; }
  catch { throw new Error(label + " non contiene JSON valido."); }
}
function parseRemoteBook(raw: string): BookProject {
  const data = parseJson<unknown>(raw, "Progetto remoto");
  const parsed = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
    brief: z.string(),
    writingStyle: z.string(),
    audience: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.enum(["idle", "running", "paused", "error", "completed"]),
    phase: z.string(),
    chapters: z.array(z.object({
      id: z.string(), number: z.number().int(), title: z.string(), purpose: z.string(),
      scenes: z.array(z.object({
        id: z.string(), number: z.number().int(),
        title: z.string(), objective: z.string(), text: z.string(),
        status: z.enum(["planned", "draft", "canon"]),
      }).passthrough()),
    }).passthrough()),
    memory: z.object({
      characters: z.record(z.string(), z.string()),
      locations: z.record(z.string(), z.string()),
      factions: z.record(z.string(), z.string()),
      items: z.record(z.string(), z.string()),
      secrets: z.record(z.string(), z.string()),
      timeline: z.array(z.string()),
      currentState: z.string(),
    }),
  }).passthrough().safeParse(data);
  if (!parsed.success) throw new Error("Il progetto remoto non segue lo schema BookWriter.");
  const project = parsed.data as unknown as BookProject;
  return {
    ...project,
    authorConstraints: project.authorConstraints ?? [],
    audienceReviews: project.audienceReviews ?? [],
    status: project.status === "running" ? "paused" : project.status,
    remote: undefined, // Do not trust remote-supplied local sync settings.
  };
}

export async function readGitHubSnapshot(remote: GitHubRemote, signal?: AbortSignal):
  Promise<{ book: BookProject; activities: Activity[]; head: string } | null> {
  const token = await tokenFromVault();
  const ref = await headSha(token, remote, signal);
  const project = await readFile(token, remote, ".bookwriter/project.json", ref, signal);
  if (project === null) return null;
  const book = parseRemoteBook(project);
  const rawActivities = await readFile(token, remote, ".bookwriter/activities.json", ref, signal);
  const unknownActivities = rawActivities ? parseJson<unknown>(rawActivities, "Log remoto") : [];
  const parsedActivities = z.array(z.object({
    id: z.string(), bookId: z.string(), runId: z.string(),
    phase: z.string(), title: z.string(), reason: z.string(),
    nextStep: z.string(), status: z.enum(["running", "succeeded", "cancelled", "failed"]),
    createdAt: z.string(),
  }).passthrough()).max(100_000).safeParse(unknownActivities);
  if (!parsedActivities.success) throw new Error("Formato dei log GitHub non valido.");
  const activities = parsedActivities.data as Activity[];
  if (activities.some(a => a.bookId !== book.id)) throw new Error("Log GitHub riferito a un altro libro.");
  return { book, activities, head: ref };
}

/** Restore only if the book ID does not exist locally. Never overwrite browser data. */
export async function importGitHubBook(remote: GitHubRemote): Promise<BookProject> {
  const source = await readGitHubSnapshot(remote);
  if (!source) throw new Error("Nessun libro BookWriter in questa repository.");
  const db = await getDb();
  const tx = db.transaction(["books", "activities"], "readwrite");
  const existing = await tx.objectStore("books").get(source.book.id);
  if (existing) {
    await tx.done;
    throw new RemoteConflict("Questo libro è già presente in IndexedDB. Esporta un backup e risolvi il conflitto prima di importare.");
  }
  source.book.remote = {
    ...validateRemote(remote),
    lastSyncedCommit: source.head,
    lastSyncedLocalUpdatedAt: source.book.updatedAt,
    lastSyncAt: new Date().toISOString(),
  };
  await tx.objectStore("books").put(source.book, source.book.id);
  for (const activity of source.activities) {
    await tx.objectStore("activities").put(
      activity.status === "running" ? { ...activity, status: "cancelled" } : activity,
      activity.id,
    );
  }
  await tx.done;
  return source.book;
}

export async function pushGitHubBook(
  bookId: string, consentPublic = false,
): Promise<{ commit: string; paths: number; repository: string }> {
  const token = await tokenFromVault();
  const current = await getBook(bookId);
  if (!current?.remote) throw new Error("Collega prima una repository a questo libro.");
  if (current.status === "running") throw new Error("Metti in pausa l'autopilot prima della sincronizzazione GitHub.");
  const remote = validateRemote(current.remote);
  const repo = await request<{
    private: boolean;
    permissions?: { push?: boolean };
    default_branch: string;
  }>(token, apiPath(remote, ""));
  if (!repo) throw new Error("Repository GitHub non accessibile.");
  if (!repo.private && !consentPublic)
    throw new Error("Repository PUBBLICA: devi autorizzare esplicitamente la pubblicazione del libro e dei segreti narrativi.");
  if (!repo.permissions?.push) throw new Error("Il PAT non ha permessi di scrittura su questa repository.");

  const head = await headSha(token, remote);
  if (current.remote.lastSyncedCommit && current.remote.lastSyncedCommit !== head)
    throw new RemoteConflict("Il branch remoto è cambiato dall'ultima sincronizzazione. Importa/controlla le modifiche prima di scrivere.");
  const previousManifestRaw = await readFile(token, remote, ".bookwriter/manifest.json", head);
  let previousPaths: string[] = [];
  if (previousManifestRaw) {
    const manifest = manifestSchema.safeParse(parseJson<unknown>(previousManifestRaw, "Manifest"));
    if (!manifest.success) throw new Error("Manifest GitHub non supportato.");
    if (manifest.data.bookId !== bookId)
      throw new RemoteConflict("Questa repository contiene già un altro libro BookWriter.");
    if (!current.remote.lastSyncedCommit)
      throw new RemoteConflict("Esiste un libro remoto non ancora collegato: importa prima la versione presente.");
    previousPaths = manifest.data.paths;
  } else {
    const preexistingBook = await readFile(token, remote, "book.md", head);
    if (preexistingBook !== null)
      throw new RemoteConflict("La repository contiene già book.md senza manifest BookWriter. Importarla tramite un adapter Narrarium prima di sincronizzare.");
    if (current.remote.lastSyncedCommit)
      throw new RemoteConflict("Il manifest remoto è stato eliminato da un altro dispositivo.");
  }

  const activities = await listActivities(bookId);
  const projection = projectBook(current, activities);
  const removed = previousPaths.filter(p =>
    !projection.files[p] &&
    (p === ".bookwriter/project.json" || p === ".bookwriter/activities.json" ||
     p === ".bookwriter/manifest.json" || p.endsWith(".md")) &&
    !p.includes("..") && !p.startsWith("/"),
  );
  const treeEntries: Array<{
    path: string; mode: "100644"; type: "blob"; content?: string; sha?: null;
  }> = Object.entries(projection.files).map(([path, content]) =>
    ({ path, mode: "100644", type: "blob", content }),
  );
  for (const path of removed) treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  const size = JSON.stringify(treeEntries).length;
  if (size > MAX_BYTES) throw new Error("Il libro supera il limite dell'operazione remota (12 MiB); esegui un backup ZIP locale.");

  const commitData = await request<{ tree?: { sha?: string } }>(
    token, apiPath(remote, "/git/commits/" + head),
  );
  const baseTree = commitData?.tree?.sha;
  if (!baseTree || !shaPattern.test(baseTree)) throw new Error("Impossibile determinare il tree di GitHub.");

  // Check the HEAD immediately before producing new Git objects.
  if (await headSha(token, remote) !== head)
    throw new RemoteConflict("GitHub è cambiato durante la preparazione; ripeti la verifica.");
  const tree = await request<{ sha?: string }>(
    token, apiPath(remote, "/git/trees"),
    { method: "POST", body: { base_tree: baseTree, tree: treeEntries } },
  );
  if (!tree?.sha || !shaPattern.test(tree.sha)) throw new Error("GitHub non ha creato un tree valido.");
  const commit = await request<{ sha?: string }>(
    token, apiPath(remote, "/git/commits"),
    { method: "POST", body: { message: "bookwriter: synchronize narrative checkpoint", tree: tree.sha, parents: [head] } },
  );
  if (!commit?.sha || !shaPattern.test(commit.sha)) throw new Error("GitHub non ha creato un commit valido.");

  // A non-fast-forward update is rejected, NEVER force-push over another device.
  await request(token, apiPath(remote, "/git/refs/heads/" +
    remote.branch.split("/").map(encodeURIComponent).join("/")),
  { method: "PATCH", body: { sha: commit.sha, force: false } });

  const db = await getDb();
  const latest = await db.get("books", bookId) as BookProject | undefined;
  if (latest?.remote &&
      latest.remote.owner === remote.owner &&
      latest.remote.repository === remote.repository &&
      latest.remote.branch === remote.branch) {
    // Retain latest local changes: only the *snapshot* saved above is marked synchronized.
    latest.remote = {
      ...latest.remote,
      lastSyncedCommit: commit.sha,
      lastSyncAt: new Date().toISOString(),
      lastSyncedLocalUpdatedAt: current.updatedAt,
    };
    await db.put("books", latest, bookId);
  }
  return {
    commit: commit.sha,
    paths: treeEntries.length,
    repository: remote.owner + "/" + remote.repository,
  };
}
