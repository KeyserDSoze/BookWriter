import { z } from "zod";
import { CLOUD_FILE_NAMES, type CloudFileName } from "@engine/domain/cloud-profile";
import { cloudFetch, cloudHttpError, type CloudResponse } from "./cloud-http";
import { CloudError, type CloudFileRead, type CloudSession, type CloudStore } from "./types";

/** Google Drive appDataFolder: a hidden folder only this OAuth client can open.
 * Pure-browser OAuth (no backend, no client secret) means the Google Identity
 * Services *token* model: popup only, ~1 hour access token, no refresh token. */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_SCOPES = ["openid", "email", "profile", GOOGLE_DRIVE_SCOPE].join(" ");
export const GOOGLE_GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const API_ORIGIN = "https://www.googleapis.com";
const ORIGINS = [API_ORIGIN] as const;
const FILES = API_ORIGIN + "/drive/v3/files";
const UPLOAD = API_ORIGIN + "/upload/drive/v3/files";

interface GoogleTokenResponse {
  access_token?: string; expires_in?: number | string; scope?: string; error?: string;
}
interface GoogleTokenClient { requestAccessToken(overrides?: { prompt?: string; hint?: string }): void }
interface GoogleOauth {
  initTokenClient(config: {
    client_id: string; scope: string; prompt?: string; hint?: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): GoogleTokenClient;
  hasGrantedAllScopes(response: GoogleTokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}
declare global { interface Window { google?: { accounts?: { oauth2?: GoogleOauth } } } }

let scriptLoading: Promise<GoogleOauth> | undefined;
/** Loaded only after an explicit click on «Accedi con Google», never at startup. */
export function loadGoogleIdentity(timeoutMs = 15_000): Promise<GoogleOauth> {
  const ready = window.google?.accounts?.oauth2;
  if (ready) return Promise.resolve(ready);
  scriptLoading ??= new Promise<GoogleOauth>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => { scriptLoading = undefined; script.remove(); reject(new CloudError("network",
      "Impossibile caricare Google Identity Services. Controlla la rete o i blocchi del browser.")); };
    const timer = setTimeout(fail, timeoutMs);
    script.src = GOOGLE_GIS_SCRIPT; script.async = true; script.referrerPolicy = "no-referrer";
    script.onload = () => {
      clearTimeout(timer);
      const loaded = window.google?.accounts?.oauth2;
      if (loaded) resolve(loaded); else fail();
    };
    script.onerror = () => { clearTimeout(timer); fail(); };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

export interface GoogleToken { accessToken: string; expiresAt: number }
export async function requestGoogleToken(
  clientId: string, options: { hint?: string; prompt?: string } = {},
): Promise<GoogleToken> {
  if (!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new CloudError("config", "Client ID Google non valido: controlla il valore nelle impostazioni cloud.");
  const oauth = await loadGoogleIdentity();
  return new Promise<GoogleToken>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId, scope: GOOGLE_SCOPES, prompt: options.prompt ?? "", hint: options.hint,
      callback: response => {
        if (response.error || !response.access_token)
          return reject(new CloudError(response.error === "access_denied" ? "cancelled" : "auth",
            response.error === "access_denied" ? "Accesso Google negato." : "Google non ha concesso l'accesso."));
        if (!oauth.hasGrantedAllScopes(response, GOOGLE_DRIVE_SCOPE))
          return reject(new CloudError("forbidden",
            "Per sincronizzare devi concedere l'accesso alla cartella dati dell'app (drive.appdata)."));
        const seconds = Number(response.expires_in);
        resolve({
          accessToken: response.access_token,
          expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 60 ? seconds : 3_600) * 1_000,
        });
      },
      error_callback: error => reject(new CloudError("cancelled", error.type === "popup_failed_to_open"
        ? "Il browser ha bloccato la finestra di accesso Google: consenti i popup per questo sito."
        : "Accesso Google annullato.")),
    });
    client.requestAccessToken();
  });
}

const userInfoSchema = z.object({ sub: z.string().min(1).max(100), email: z.string().max(320).optional(),
  name: z.string().max(200).optional() }).passthrough();
const listSchema = z.object({ files: z.array(z.object({
  id: z.string().min(1).max(200), version: z.string().max(40).optional(),
}).passthrough()).max(20) }).passthrough();
const writeSchema = z.object({ id: z.string().min(1).max(200).optional(), version: z.string().min(1).max(40) }).passthrough();

function assertName(name: string): asserts name is CloudFileName {
  if (!(CLOUD_FILE_NAMES as readonly string[]).includes(name)) throw new CloudError("config", "Nome file cloud non ammesso.");
}
function parse<T>(response: CloudResponse, schema: z.ZodType<T>): T {
  if (response.status < 200 || response.status > 299)
    throw cloudHttpError(response.status, response.headers.get("retry-after"));
  let raw: unknown;
  try { raw = JSON.parse(response.text); } catch { throw new CloudError("invalid", "Risposta Google Drive non valida."); }
  const result = schema.safeParse(raw);
  if (!result.success) throw new CloudError("invalid", "Risposta Google Drive non valida.");
  return result.data;
}

export function createGoogleDriveStore(accessToken: string): CloudStore {
  const auth = { Authorization: "Bearer " + accessToken };
  async function find(name: CloudFileName, signal?: AbortSignal) {
    const query = encodeURIComponent(`name = '${name}' and trashed = false`);
    const response = await cloudFetch(
      `${FILES}?spaces=appDataFolder&q=${query}&orderBy=createdTime&pageSize=10&fields=${encodeURIComponent("files(id,version)")}`,
      { headers: auth, signal }, ORIGINS);
    return parse(response, listSchema).files;
  }
  async function version(id: string, signal?: AbortSignal): Promise<string> {
    const response = await cloudFetch(`${FILES}/${encodeURIComponent(id)}?fields=version`,
      { headers: auth, signal }, ORIGINS);
    return parse(response, writeSchema).version;
  }
  return {
    provider: "google",
    async read(name, signal): Promise<CloudFileRead | null> {
      assertName(name);
      for (let attempt = 0; attempt < 3; attempt++) {
        const file = (await find(name, signal))[0];
        if (!file) return null;
        const before = file.version ?? await version(file.id, signal);
        const content = await cloudFetch(`${FILES}/${encodeURIComponent(file.id)}?alt=media`,
          { headers: auth, signal }, ORIGINS);
        if (content.status < 200 || content.status > 299)
          throw cloudHttpError(content.status, content.headers.get("retry-after"));
        // A write between the two requests would pair old text with a new version.
        if (await version(file.id, signal) === before) return { text: content.text, version: before };
      }
      throw new CloudError("conflict", "Il file cloud cambia continuamente: riprova tra poco.");
    },
    async write(name, text, expectedVersion, signal) {
      assertName(name);
      if (expectedVersion === null) {
        if ((await find(name, signal)).length) throw new CloudError("conflict", "Il file cloud esiste già: un altro dispositivo lo ha creato.");
        const boundary = "bookwriter-" + crypto.randomUUID();
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify({ name, parents: ["appDataFolder"], mimeType: "application/json" }) +
          `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
        const created = parse(await cloudFetch(`${UPLOAD}?uploadType=multipart&fields=${encodeURIComponent("id,version")}`,
          { method: "POST", headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal },
          ORIGINS), writeSchema);
        // Two devices creating at once leave two files: the oldest one wins, ours is removed.
        const all = await find(name, signal);
        if (all.length > 1 && all[0]?.id !== created.id) {
          if (created.id) await cloudFetch(`${FILES}/${encodeURIComponent(created.id)}`, { method: "DELETE", headers: auth, signal }, ORIGINS);
          throw new CloudError("conflict", "Un altro dispositivo ha creato il file nello stesso momento.");
        }
        return { version: created.version };
      }
      const file = (await find(name, signal))[0];
      if (!file || (file.version ?? await version(file.id, signal)) !== expectedVersion)
        throw new CloudError("conflict", "Il file cloud è stato modificato da un altro dispositivo.");
      const updated = parse(await cloudFetch(
        `${UPLOAD}/${encodeURIComponent(file.id)}?uploadType=media&fields=version`,
        { method: "PATCH", headers: { ...auth, "Content-Type": "application/json; charset=UTF-8" }, body: text, signal },
        ORIGINS), writeSchema);
      return { version: updated.version };
    },
    async remove(name, signal) {
      assertName(name);
      for (const file of await find(name, signal)) {
        const response = await cloudFetch(`${FILES}/${encodeURIComponent(file.id)}`, { method: "DELETE", headers: auth, signal }, ORIGINS);
        if (response.status !== 404 && (response.status < 200 || response.status > 299)) throw cloudHttpError(response.status);
      }
    },
  };
}

export async function googleSession(token: GoogleToken, signal?: AbortSignal): Promise<CloudSession> {
  const response = await cloudFetch(API_ORIGIN + "/oauth2/v3/userinfo",
    { headers: { Authorization: "Bearer " + token.accessToken }, signal }, ORIGINS);
  const info = parse(response, userInfoSchema);
  return {
    provider: "google", accountId: info.sub, accountLabel: info.email ?? info.name ?? "Account Google",
    expiresAt: token.expiresAt, store: createGoogleDriveStore(token.accessToken),
  };
}

/** Interactive sign-in: must run inside a click handler or the popup is blocked. */
export async function connectGoogle(
  clientId: string, options: { hint?: string; prompt?: string; signal?: AbortSignal } = {},
): Promise<{ session: CloudSession; accessToken: string }> {
  const token = await requestGoogleToken(clientId, options);
  return { session: await googleSession(token, options.signal), accessToken: token.accessToken };
}

export async function revokeGoogle(accessToken: string): Promise<void> {
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) return;
  await new Promise<void>(resolve => { oauth.revoke(accessToken, () => resolve()); setTimeout(resolve, 5_000); });
}
