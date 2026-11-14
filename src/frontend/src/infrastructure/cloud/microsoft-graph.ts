import { z } from "zod";
import { CLOUD_FILE_NAMES, type CloudFileName } from "../../domain/cloud-profile";
import { cloudFetch, cloudHttpError, type CloudResponse } from "./cloud-http";
import { CloudError, type CloudFileRead, type CloudSession, type CloudStore } from "./types";

/** OneDrive approot (Apps/<app name>) through Microsoft Graph, signed in with
 * OAuth 2.0 authorization code + PKCE. A public SPA client: no secret, ever.
 * SPA refresh tokens last 24 hours, so a new popup sign-in is needed daily. */
export const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com";
export const GRAPH_ORIGIN = "https://graph.microsoft.com";
export const MICROSOFT_CALLBACK_PATH = "/oauth/microsoft.html";
export const MICROSOFT_SCOPES = [
  "openid", "profile", "email", "offline_access", GRAPH_ORIGIN + "/Files.ReadWrite.AppFolder",
];
export const OAUTH_CHANNEL = "bookwriter-oauth";

export interface MicrosoftConfig { clientId: string; tenant: string }
export function assertMicrosoftConfig(config: MicrosoftConfig): void {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(config.clientId))
    throw new CloudError("config", "Application (client) ID Microsoft non valido: controlla il valore nelle impostazioni cloud.");
  if (!["common", "consumers", "organizations"].includes(config.tenant) && !guid.test(config.tenant))
    throw new CloudError("config", "Tenant Microsoft non valido: usa common, consumers, organizations o un Directory (tenant) ID.");
}

const base64Url = (bytes: Uint8Array): string => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const randomUrlSafe = (bytes = 48): string => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
/** RFC 7636 S256 challenge. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function buildAuthorizeUrl(parameters: {
  config: MicrosoftConfig; redirectUri: string; state: string; challenge: string;
  loginHint?: string; prompt?: "select_account" | "none" | "login" | "consent";
}): string {
  const url = new URL(`${MICROSOFT_AUTHORITY}/${parameters.config.tenant}/oauth2/v2.0/authorize`);
  const query = url.searchParams;
  query.set("client_id", parameters.config.clientId);
  query.set("response_type", "code");
  query.set("redirect_uri", parameters.redirectUri);
  query.set("response_mode", "query");
  query.set("scope", MICROSOFT_SCOPES.join(" "));
  query.set("state", parameters.state);
  query.set("code_challenge", parameters.challenge);
  query.set("code_challenge_method", "S256");
  if (parameters.loginHint) query.set("login_hint", parameters.loginHint);
  if (parameters.prompt) query.set("prompt", parameters.prompt);
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(1).max(20_000),
  expires_in: z.number().finite().min(1),
  refresh_token: z.string().min(1).max(20_000).optional(),
  id_token: z.string().min(1).max(20_000).optional(),
}).passthrough();
export interface MicrosoftTokens { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number }

async function tokenRequest(
  config: MicrosoftConfig, form: Record<string, string>, signal?: AbortSignal,
): Promise<MicrosoftTokens> {
  const response = await cloudFetch(`${MICROSOFT_AUTHORITY}/${config.tenant}/oauth2/v2.0/token`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, scope: MICROSOFT_SCOPES.join(" "), ...form }).toString(),
  }, [MICROSOFT_AUTHORITY]);
  // A refused grant (expired code or refresh token) is an auth problem, whatever the body says.
  if (response.status === 400 || response.status === 401)
    throw new CloudError("auth", "Accesso Microsoft scaduto o rifiutato: riconnetti l'account.", response.status);
  if (response.status < 200 || response.status > 299) throw cloudHttpError(response.status, response.headers.get("retry-after"));
  let raw: unknown;
  try { raw = JSON.parse(response.text); } catch { throw new CloudError("invalid", "Risposta Microsoft non valida."); }
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) throw new CloudError("invalid", "Risposta Microsoft non valida.");
  return {
    accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token,
    idToken: parsed.data.id_token, expiresAt: Date.now() + parsed.data.expires_in * 1_000,
  };
}
export const refreshMicrosoft = (config: MicrosoftConfig, refreshToken: string, signal?: AbortSignal) =>
  tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, signal);

const claimsSchema = z.object({
  oid: z.string().max(100).optional(), sub: z.string().max(200).optional(), tid: z.string().max(100).optional(),
  name: z.string().max(200).optional(), email: z.string().max(320).optional(),
  preferred_username: z.string().max(320).optional(),
}).passthrough();
/** Display only: the id token is never used to authorise anything. */
export function describeMicrosoftAccount(idToken: string | undefined): { accountId: string; label: string } {
  try {
    const payload = idToken?.split(".")[1];
    if (!payload) throw new Error("no token");
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = claimsSchema.parse(JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(padded), char => char.charCodeAt(0)))));
    const id = claims.oid ?? claims.sub;
    if (!id) throw new Error("no subject");
    return { accountId: (claims.tid ?? "tenant") + ":" + id,
      label: claims.email ?? claims.preferred_username ?? claims.name ?? "Account Microsoft" };
  } catch { throw new CloudError("invalid", "Microsoft non ha identificato l'account: riprova l'accesso."); }
}

interface CallbackMessage { type?: unknown; provider?: unknown; search?: unknown }
/** Opens the popup and waits for the redirect page. The state value is a secret
 * known only to this tab: a message without it is ignored, so a page of another
 * origin (or another tab) cannot inject an authorization code. */
function waitForAuthorizationCode(
  popup: Window, state: string, signal?: AbortSignal, timeoutMs = 300_000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(OAUTH_CHANNEL);
    let closedAt = 0;
    const finish = (error: CloudError | DOMException | null, code?: string) => {
      window.removeEventListener("message", onMessage);
      channel?.close(); clearInterval(poll); clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try { popup.close(); } catch { /* already closed */ }
      if (error) reject(error); else resolve(code!);
    };
    const handle = (data: CallbackMessage | undefined) => {
      if (!data || data.type !== "bookwriter-oauth" || data.provider !== "microsoft" || typeof data.search !== "string") return false;
      const query = new URLSearchParams(data.search);
      if (query.get("state") !== state) return false;
      const error = query.get("error");
      if (error) finish(new CloudError(error === "access_denied" ? "cancelled" : "auth",
        error === "access_denied" ? "Accesso Microsoft annullato." : "Microsoft ha rifiutato l'accesso."));
      else if (query.get("code")) finish(null, query.get("code")!);
      else finish(new CloudError("auth", "Microsoft non ha restituito il codice di accesso."));
      return true;
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === popup) handle(event.data as CallbackMessage);
    };
    const onAbort = () => finish(new DOMException("Operazione annullata", "AbortError"));
    window.addEventListener("message", onMessage);
    if (channel) channel.onmessage = event => { handle(event.data as CallbackMessage); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => finish(new CloudError("cancelled", "Accesso Microsoft scaduto: riprova.")), timeoutMs);
    // A closed window with no message is a cancelled sign-in, after a short grace for a late message.
    const poll = setInterval(() => {
      if (!popup.closed) return;
      closedAt ||= Date.now();
      if (Date.now() - closedAt > 700) finish(new CloudError("cancelled", "Accesso Microsoft annullato."));
    }, 250);
  });
}

export interface MicrosoftSignIn { session: CloudSession; tokens: MicrosoftTokens }

/** Interactive sign-in: must run inside a click handler or the popup is blocked. */
export async function connectMicrosoft(
  config: MicrosoftConfig, options: { loginHint?: string; prompt?: "select_account" | "none" | "login" | "consent"; signal?: AbortSignal } = {},
): Promise<MicrosoftSignIn> {
  assertMicrosoftConfig(config);
  const redirectUri = window.location.origin + MICROSOFT_CALLBACK_PATH;
  const verifier = randomUrlSafe(64), state = randomUrlSafe(24);
  // Open the window NOW, inside the click: browsers block popups opened after an await.
  const popup = window.open("", "bookwriter-microsoft", "popup,width=520,height=720");
  if (!popup) throw new CloudError("cancelled",
    "Il browser ha bloccato la finestra di accesso Microsoft: consenti i popup per questo sito.");
  try {
    const url = buildAuthorizeUrl({ config, redirectUri, state, challenge: await pkceChallenge(verifier),
      loginHint: options.loginHint, prompt: options.prompt ?? (options.loginHint ? undefined : "select_account") });
    popup.location.href = url;
  } catch (error) { try { popup.close(); } catch { /* already closed */ } throw error; }
  const code = await waitForAuthorizationCode(popup, state, options.signal);
  const tokens = await tokenRequest(config, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier,
  }, options.signal);
  return { session: microsoftSession(tokens), tokens };
}

export function microsoftSession(tokens: MicrosoftTokens, known?: { accountId: string; label: string }): CloudSession {
  const account = known ?? describeMicrosoftAccount(tokens.idToken);
  return {
    provider: "microsoft", accountId: account.accountId, accountLabel: account.label,
    expiresAt: tokens.expiresAt, store: createGraphStore(tokens.accessToken),
  };
}

const itemSchema = z.object({
  id: z.string().min(1).max(200), eTag: z.string().min(1).max(200),
  "@microsoft.graph.downloadUrl": z.string().max(4_000).optional(),
}).passthrough();
function assertName(name: string): asserts name is CloudFileName {
  if (!(CLOUD_FILE_NAMES as readonly string[]).includes(name)) throw new CloudError("config", "Nome file cloud non ammesso.");
}
function item(response: CloudResponse): z.infer<typeof itemSchema> {
  if (response.status < 200 || response.status > 299)
    throw cloudHttpError(response.status, response.headers.get("retry-after"));
  let raw: unknown;
  try { raw = JSON.parse(response.text); } catch { throw new CloudError("invalid", "Risposta OneDrive non valida."); }
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) throw new CloudError("invalid", "Risposta OneDrive non valida.");
  return parsed.data;
}

export function createGraphStore(accessToken: string): CloudStore {
  const auth = { Authorization: "Bearer " + accessToken };
  const path = (name: CloudFileName) => `${GRAPH_ORIGIN}/v1.0/me/drive/special/approot:/${name}`;
  const origins = [GRAPH_ORIGIN] as const;
  async function metadata(name: CloudFileName, signal?: AbortSignal) {
    const response = await cloudFetch(path(name), { headers: auth, signal }, origins);
    return response.status === 404 ? null : item(response);
  }
  return {
    provider: "microsoft",
    async read(name, signal): Promise<CloudFileRead | null> {
      assertName(name);
      const meta = await metadata(name, signal);
      if (!meta) return null;
      const downloadUrl = meta["@microsoft.graph.downloadUrl"];
      if (!downloadUrl) throw new CloudError("invalid", "OneDrive non ha fornito il contenuto del file.");
      // The pre-authenticated link needs no (and must not receive) the access token.
      const content = await cloudFetch(downloadUrl, { signal }, "any-https");
      if (content.status < 200 || content.status > 299) throw cloudHttpError(content.status, content.headers.get("retry-after"));
      return { text: content.text, version: meta.eTag };
    },
    async write(name, text, expectedVersion, signal) {
      assertName(name);
      const headers = { ...auth, "Content-Type": "application/json; charset=UTF-8" };
      if (expectedVersion === null) {
        const created = await cloudFetch(`${path(name)}:/content?@microsoft.graph.conflictBehavior=fail`,
          { method: "PUT", headers, body: text, signal }, origins);
        return { version: item(created).eTag };
      }
      // Graph's upload takes no portable precondition: compare the version first, then
      // let the caller's read-back detect the narrow window that remains.
      const current = await metadata(name, signal);
      if (!current || current.eTag !== expectedVersion)
        throw new CloudError("conflict", "Il file cloud è stato modificato da un altro dispositivo.");
      const updated = await cloudFetch(`${path(name)}:/content`, { method: "PUT", headers, body: text, signal }, origins);
      return { version: item(updated).eTag };
    },
    async remove(name, signal) {
      assertName(name);
      const response = await cloudFetch(path(name), { method: "DELETE", headers: auth, signal }, origins);
      if (response.status !== 404 && (response.status < 200 || response.status > 299)) throw cloudHttpError(response.status);
    },
  };
}
