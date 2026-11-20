import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import type { ServerScope } from "@engine/domain/personal-server";

const SCOPES = new Set<ServerScope>(["read", "write", "run", "update"]);
export async function readBootstrapCodeFile(path: string): Promise<string> {
  const info = await fs.lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 32 || info.size > 201 ||
      process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw new Error("Il file del nuovo codice deve essere regolare, privato (0600), senza link e contenere 32–200 caratteri.");
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("Il file del codice è cambiato durante la lettura.");
    const text = await handle.readFile("utf8");
    const code = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (code.length < 32 || code.length > 200 || code !== code.trim() || /[\u0000-\u001f\u007f]/u.test(code))
      throw new Error("Il nuovo codice deve avere 32–200 caratteri visibili, senza ritorni a capo o spazi iniziali/finali.");
    return code;
  } finally { await handle.close(); }
}
export async function readAdminBootstrap(dataRoot: string): Promise<string> {
  const path = join(resolve(dataRoot), "private", "admin-bootstrap.txt");
  const info = await fs.lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 33 || info.size > 201 ||
      process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw new Error("Codice amministratore non leggibile, non regolare o non privato (richiesto 0600). ");
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("Codice amministratore cambiato durante la lettura.");
    const code = (await handle.readFile("utf8")).trim();
    if (!code || /[\r\n\0]/.test(code)) throw new Error("Codice amministratore non valido.");
    return code;
  } finally { await handle.close(); }
}
export interface LocalClientTokenOptions {
  dataRoot: string; label: string; scopes: string[]; adminOrigin?: string;
  fetchImpl?: typeof fetch;
}
export async function requestLocalClientToken(options: LocalClientTokenOptions): Promise<{ token: string; clientId: string }> {
  const label = options.label.trim();
  if (!label || label.length > 80) throw new Error("Nome del client non valido.");
  const scopes = options.scopes.map(scope => scope.trim());
  if (!scopes.length || scopes.length > 4 || new Set(scopes).size !== scopes.length || scopes.some(scope => !SCOPES.has(scope as ServerScope)))
    throw new Error("Permessi non validi: usa read,write,run e, solo se necessario, update.");
  const code = await readAdminBootstrap(options.dataRoot);
  const origin = options.adminOrigin ?? "http://127.0.0.1:24105";
  const base = new URL(origin);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.search || base.hash || base.pathname !== "/")
    throw new Error("La creazione del token è ammessa solo sull'admin loopback; non usare un hostname Cloudflare per il codice bootstrap.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const login = await fetchImpl(origin + "/admin/api/login", { method: "POST", redirect: "error", credentials: "omit",
    headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  if (!login.ok) throw new Error("Accesso amministratore non riuscito. Controlla il codice e che il server sia avviato su 24105.");
  const session = await login.json() as { csrf?: unknown };
  if (typeof session.csrf !== "string") throw new Error("Sessione amministratore non valida.");
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Cookie amministratore assente.");
  const issued = await fetchImpl(origin + "/admin/api/token", { method: "POST", redirect: "error", credentials: "omit",
    headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": session.csrf },
    body: JSON.stringify({ label, scopes }) });
  if (!issued.ok) throw new Error("Il token client non è stato creato. Controlla permessi e sessione locale.");
  const result = await issued.json() as { token?: unknown; clientId?: unknown };
  if (typeof result.token !== "string" || typeof result.clientId !== "string") throw new Error("Risposta token client non valida.");
  return { token: result.token, clientId: result.clientId };
}

async function localAdminSession(options: LocalClientTokenOptions): Promise<{ origin: string; csrf: string; cookie: string }> {
  const code = await readAdminBootstrap(options.dataRoot);
  const origin = options.adminOrigin ?? "http://127.0.0.1:24105";
  const base = new URL(origin);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.search || base.hash || base.pathname !== "/")
    throw new Error("Operazione amministrativa ammessa solo sul loopback; non usare un hostname Cloudflare per il codice bootstrap.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const login = await fetchImpl(origin + "/admin/api/login", { method: "POST", redirect: "error", credentials: "omit",
    headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  if (!login.ok) throw new Error("Accesso amministratore non riuscito. Controlla il codice e che il server sia avviato su 24105.");
  const session = await login.json() as { csrf?: unknown };
  if (typeof session.csrf !== "string") throw new Error("Sessione amministratore non valida.");
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Cookie amministratore assente.");
  return { origin, csrf: session.csrf, cookie };
}
/** Rotates the static bootstrap only after a valid local login. The old code stops being accepted. */
export async function rotateLocalAdminBootstrap(options: Omit<LocalClientTokenOptions, "label" | "scopes">): Promise<string> {
  const session = await localAdminSession({ ...options, dataRoot: options.dataRoot, label: "", scopes: [] });
  const response = await (options.fetchImpl ?? fetch)(session.origin + "/admin/api/bootstrap/rotate", {
    method: "POST", redirect: "error", credentials: "omit", headers: { Origin: session.origin,
      "Content-Type": "application/json", Cookie: session.cookie, "X-CSRF-Token": session.csrf }, body: "{}",
  });
  if (!response.ok) throw new Error("Il codice amministratore non è stato ruotato.");
  const result = await response.json() as { code?: unknown };
  if (typeof result.code !== "string") throw new Error("Nuovo codice amministratore non valido.");
  return result.code;
}

export async function setLocalAdminBootstrap(options: Omit<LocalClientTokenOptions, "label" | "scopes"> & { code: string }): Promise<void> {
  const { code } = options;
  if (code.length < 32 || code.length > 200 || code !== code.trim() || /[\u0000-\u001f\u007f]/u.test(code))
    throw new Error("Il nuovo codice deve avere 32–200 caratteri visibili, senza ritorni a capo o spazi iniziali/finali.");
  const session = await localAdminSession({ ...options, dataRoot: options.dataRoot, label: "", scopes: [] });
  const response = await (options.fetchImpl ?? fetch)(session.origin + "/admin/api/bootstrap/set", {
    method: "POST", redirect: "error", credentials: "omit", headers: { Origin: session.origin,
      "Content-Type": "application/json", Cookie: session.cookie, "X-CSRF-Token": session.csrf }, body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error("Il codice amministratore non è stato impostato.");
}
