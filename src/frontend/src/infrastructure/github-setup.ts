import { z } from "zod";
import type { GitHubRemote } from "../domain/types";
import { decryptLocal } from "./crypto";
import { loadSettings } from "./db";
import { confirmGitHubHead, inspectGitHubDestination, validateRemote } from "./github-sync";

const API = "https://api.github.com";
const MAX_BYTES = 2 * 1024 * 1024;
const repositorySchema = z.object({
  name: z.string().min(1).max(100), owner: z.object({ login: z.string().max(39) }),
  private: z.boolean(), default_branch: z.string().min(1).max(150),
  permissions: z.object({ push: z.boolean() }).optional(),
  archived: z.boolean().optional(), disabled: z.boolean().optional(),
});
export interface GitHubRepository {
  remote: GitHubRemote; private: boolean; canPush: boolean;
}
export type GitHubDestination = GitHubRepository & (
  | { kind: "empty" | "available" | "foreign" }
  | { kind: "book"; bookId: string; title: string }
);

/** Fixed API only, bounded body + total deadline, no remote errors or URLs in messages. */
async function request(path: string, method = "GET", body?: unknown, beforeSend?: () => Promise<void>): Promise<unknown> {
  if (!(path.startsWith("/repos/") || path.startsWith("/user/repos?"))) throw new Error("Destinazione GitHub non autorizzata.");
  const settings = await loadSettings();
  if (!settings.githubToken) throw new Error("Inserisci prima un PAT GitHub.");
  const secret = await decryptLocal(settings.githubToken);
  if (beforeSend) await beforeSend();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(API + path, {
      method, signal: controller.signal, redirect: "error", credentials: "omit",
      referrerPolicy: "no-referrer", cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + secret,
        "X-GitHub-Api-Version": "2026-03-10", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      try { void response.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
      throw new Error(`Configurazione GitHub non riuscita (HTTP ${response.status}). Verifica PAT, Contents: read/write e regole della repository.`);
    }
    if (!response.body) throw new Error("Risposta GitHub mancante.");
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Risposta GitHub troppo grande.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof Error && /^(Configurazione GitHub|Risposta GitHub)/.test(error.message)) throw error;
    throw new Error("Impossibile completare la configurazione GitHub: rete, tempo scaduto o risposta non valida. Nessun tentativo automatico.");
  } finally {
    clearTimeout(timer);
    try { void reader?.cancel().catch(() => undefined); } catch { /* best effort */ }
    try { reader?.releaseLock(); } catch { /* best effort */ }
  }
}

function repository(raw: unknown): GitHubRepository {
  const parsed = repositorySchema.safeParse(raw);
  if (!parsed.success) throw new Error("Metadati della repository GitHub non validi.");
  const info = parsed.data;
  return {
    remote: validateRemote({ owner: info.owner.login, repository: info.name, branch: info.default_branch }),
    private: info.private, canPush: info.permissions?.push === true && !info.archived && !info.disabled,
  };
}
const pathFor = (remote: GitHubRemote) => {
  const valid = validateRemote(remote);
  return "/repos/" + encodeURIComponent(valid.owner) + "/" + encodeURIComponent(valid.repository);
};

/** Metadata only. Never guess a repository from a token's characters or a book title.
 * GitHub's permissions.push describes the account, NOT a certificate of PAT Contents access. */
export async function discoverGitHubRepositories(): Promise<GitHubRepository[]> {
  const found = new Map<string, GitHubRepository>();
  for (let page = 1; page <= 10; page++) {
    const raw = await request(`/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`);
    if (!Array.isArray(raw) || raw.length > 100) throw new Error("Elenco repository GitHub non valido.");
    for (const item of raw) {
      const entry = repository(item);
      const key = (entry.remote.owner + "/" + entry.remote.repository).toLowerCase();
      found.set(key, entry);
    }
    if (raw.length < 100) return [...found.values()];
  }
  throw new Error("L'elenco supera 1.000 repository: usa il collegamento manuale. Nessuna destinazione scelta automaticamente.");
}

export async function inspectGitHubSetup(remote: GitHubRemote): Promise<GitHubDestination> {
  const info = repository(await request(pathFor(remote)));
  // Keep a manually selected branch; discovery uses the server's default branch.
  info.remote = validateRemote(remote);
  const branches = await request(pathFor(remote) + "/branches?per_page=1");
  if (!Array.isArray(branches)) throw new Error("Elenco rami GitHub non valido.");
  if (!branches.length) return { ...info, kind: "empty" };
  return { ...info, ...await inspectGitHubDestination(info.remote) };
}

/** The ONLY setup write: one neutral file, create-only (no sha), after checking
 * that no branch exists. Never sends prose, book IDs, credentials or settings.
 * A lost response is NOT retried: the next explicit setup re-inspects the repo. */
export async function initializeEmptyGitHubRepository(remote: GitHubRemote, consentPublic: boolean,
  isCurrent: () => Promise<void>): Promise<void> {
  const before = await inspectGitHubSetup(remote);
  if (before.kind !== "empty") throw new Error("La repository non è più vuota: ripeti il collegamento.");
  if (!before.canPush) throw new Error("Il PAT necessita di Contents: read/write su questa repository.");
  if (!before.private && !consentPublic) throw new Error("Repository pubblica: serve una conferma esplicita.");
  await isCurrent();
  const result = z.object({ commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) }) }).safeParse(
    await request(pathFor(remote) + "/contents/.bookwriter/initialization.json", "PUT", {
      message: "bookwriter: initialize repository",
      branch: validateRemote(remote).branch,
      content: btoa('{"schemaVersion":1,"purpose":"bookwriter-initialization"}\n'),
    }, isCurrent),
  );
  if (!result.success) throw new Error("Inizializzazione GitHub non confermata: verifica di nuovo la repository.");
  await confirmGitHubHead(remote, result.data.commit.sha);
}
