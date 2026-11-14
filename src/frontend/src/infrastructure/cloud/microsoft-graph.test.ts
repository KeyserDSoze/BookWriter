import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_LIBRARY_FILE, CLOUD_PROFILE_FILE, type CloudFileName } from "../../domain/cloud-profile";
import {
  assertMicrosoftConfig, buildAuthorizeUrl, connectMicrosoft, createGraphStore, describeMicrosoftAccount,
  MICROSOFT_SCOPES, pkceChallenge, refreshMicrosoft, OAUTH_CHANNEL,
} from "./microsoft-graph";

const CLIENT = "11111111-2222-4333-8444-555555555555";
const CONFIG = { clientId: CLIENT, tenant: "common" };
const ORIGIN = "https://ghostwriting.ws";
const ACCESS = "EwB-ACCESS-TOKEN-SEGRETO";
const REFRESH = "0.REFRESH-TOKEN-SEGRETO";
const b64u = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ID_TOKEN = "h." + b64u({ oid: "oid-1", tid: "tid-1", email: "autore@outlook.com", name: "Autore" }) + ".s";

describe("PKCE e URL di autorizzazione", () => {
  it("la sfida S256 coincide con il vettore di prova della RFC 7636", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("chiede code+PKCE S256 in query, con gli scope minimi e senza client secret", () => {
    const url = new URL(buildAuthorizeUrl({ config: CONFIG, redirectUri: ORIGIN + "/oauth/microsoft.html",
      state: "stato", challenge: "sfida", loginHint: "autore@outlook.com" }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("response_mode")).toBe("query");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("redirect_uri")).toBe(ORIGIN + "/oauth/microsoft.html");
    expect(q.get("login_hint")).toBe("autore@outlook.com");
    expect(q.get("scope")!.split(" ")).toEqual(MICROSOFT_SCOPES);
    expect(MICROSOFT_SCOPES).toContain("https://graph.microsoft.com/Files.ReadWrite.AppFolder");
    expect(MICROSOFT_SCOPES).toContain("offline_access");
    expect(MICROSOFT_SCOPES.some(scope => /Files\.ReadWrite(\.All)?$|Files\.Read\.All/.test(scope))).toBe(false);
    expect(url.toString()).not.toMatch(/secret/i);
  });
  it("valida Client ID e tenant", () => {
    expect(() => assertMicrosoftConfig(CONFIG)).not.toThrow();
    for (const tenant of ["consumers", "organizations", "99999999-8888-4777-8666-555555555555"])
      expect(() => assertMicrosoftConfig({ ...CONFIG, tenant })).not.toThrow();
    expect(() => assertMicrosoftConfig({ clientId: "abc", tenant: "common" })).toThrow(/client\) ID/);
    expect(() => assertMicrosoftConfig({ ...CONFIG, tenant: "evil.com/x" })).toThrow(/Tenant/);
  });
  it("l'account si ricava dall'id token solo per mostrarlo", () => {
    expect(describeMicrosoftAccount(ID_TOKEN)).toEqual({ accountId: "tid-1:oid-1", label: "autore@outlook.com" });
    expect(() => describeMicrosoftAccount(undefined)).toThrow(/non ha identificato/);
    expect(() => describeMicrosoftAccount("a.b.c")).toThrow(/non ha identificato/);
  });
});

describe("accesso con finestra popup", () => {
  type Handler = (event: { origin: string; source: unknown; data: unknown }) => void;
  let handlers: Map<string, Handler>;
  let popup: { closed: boolean; location: { href: string }; close: () => void };
  let tokenCalls: Array<{ url: string; body: URLSearchParams; init: RequestInit }>;

  beforeEach(() => {
    handlers = new Map();
    popup = { closed: false, location: { href: "" }, close() { this.closed = true; } };
    tokenCalls = [];
    vi.stubGlobal("window", {
      location: { origin: ORIGIN }, open: vi.fn(() => popup),
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      removeEventListener: (type: string) => handlers.delete(type),
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      tokenCalls.push({ url, body: new URLSearchParams(String(init.body)), init });
      return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, id_token: ID_TOKEN, expires_in: 3599 }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const stateOf = () => new URL(popup.location.href).searchParams.get("state")!;
  const deliver = (search: string, extra: Partial<{ origin: string; source: unknown }> = {}) =>
    handlers.get("message")!({ origin: ORIGIN, source: popup, data: { type: "bookwriter-oauth", provider: "microsoft", search }, ...extra });

  it("completa l'accesso: scambia il codice con il verifier giusto, senza segreti", async () => {
    const pending = connectMicrosoft(CONFIG);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    expect((window.open as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(""); // opened empty, inside the click
    deliver("?code=CODICE-1&state=" + stateOf());
    const result = await pending;
    const [call] = tokenCalls;
    expect(call!.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(call!.body.get("grant_type")).toBe("authorization_code");
    expect(call!.body.get("code")).toBe("CODICE-1");
    expect(call!.body.get("client_id")).toBe(CLIENT);
    expect(call!.body.get("redirect_uri")).toBe(ORIGIN + "/oauth/microsoft.html");
    expect(call!.body.has("client_secret")).toBe(false);
    const challenge = new URL(popup.location.href).searchParams.get("code_challenge");
    expect(await pkceChallenge(call!.body.get("code_verifier")!)).toBe(challenge);
    expect(call!.init.credentials).toBe("omit");
    expect(result.session).toMatchObject({ provider: "microsoft", accountId: "tid-1:oid-1", accountLabel: "autore@outlook.com" });
    expect(result.tokens.refreshToken).toBe(REFRESH);
    expect(popup.closed).toBe(true);
    expect(handlers.size).toBe(0);
  });
  it("ignora messaggi con state errato, da un'altra origine o da un'altra finestra", async () => {
    const pending = connectMicrosoft(CONFIG);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    deliver("?code=FALSO&state=indovinato");
    deliver("?code=FALSO&state=" + stateOf(), { origin: "https://evil.example" });
    deliver("?code=FALSO&state=" + stateOf(), { source: {} });
    expect(tokenCalls).toHaveLength(0);
    deliver("?code=VERO&state=" + stateOf());
    await pending;
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.body.get("code")).toBe("VERO");
  });
  it("accetta il canale BroadcastChannel quando la finestra ha perso il collegamento con l'opener", async () => {
    const pending = connectMicrosoft(CONFIG);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    channel.postMessage({ type: "bookwriter-oauth", provider: "microsoft", search: "?code=DAL-CANALE&state=" + stateOf() });
    await pending;
    channel.close();
    expect(tokenCalls[0]!.body.get("code")).toBe("DAL-CANALE");
  });
  it.each([
    ["?error=access_denied&state=", "cancelled", /annullato/], ["?error=invalid_scope&state=", "auth", /rifiutato/],
  ])("errore %s dal provider", async (search, kind, message) => {
    const pending = connectMicrosoft(CONFIG).catch((e: unknown) => e);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    deliver(search + stateOf());
    expect(await pending).toMatchObject({ kind, message: expect.stringMatching(message) });
    expect(tokenCalls).toHaveLength(0);
  });
  it("popup bloccato dal browser: nessun accesso e istruzioni", async () => {
    (window.open as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    await expect(connectMicrosoft(CONFIG)).rejects.toMatchObject({ kind: "cancelled", message: expect.stringMatching(/popup/) });
  });
  it("finestra chiusa senza completare: annullato", async () => {
    const pending = connectMicrosoft(CONFIG).catch((e: unknown) => e);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    popup.closed = true;
    expect(await pending).toMatchObject({ kind: "cancelled" });
  });
  it("codice rifiutato dal token endpoint: errore di accesso senza dettagli", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "AADSTS70008 " + REFRESH }), { status: 400 })));
    const pending = connectMicrosoft(CONFIG).catch((e: unknown) => e);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    deliver("?code=X&state=" + stateOf());
    const error = await pending as Error;
    expect(error.message).toMatch(/riconnetti/);
    expect(error.message).not.toContain("AADSTS");
    expect(error.message).not.toContain(REFRESH);
  });
  it("rinnova l'accesso con il refresh token e gestisce la scadenza dopo 24 ore", async () => {
    const tokens = await refreshMicrosoft(CONFIG, REFRESH);
    expect(tokenCalls[0]!.body.get("grant_type")).toBe("refresh_token");
    expect(tokenCalls[0]!.body.get("refresh_token")).toBe(REFRESH);
    expect(tokenCalls[0]!.body.has("client_secret")).toBe(false);
    expect(tokens.accessToken).toBe(ACCESS);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await expect(refreshMicrosoft(CONFIG, REFRESH)).rejects.toMatchObject({ kind: "auth" });
  });
});

interface Item { text: string; etag: number }
function fakeGraph() {
  const items = new Map<CloudFileName, Item>();
  const calls: Array<{ url: URL; method: string; init: RequestInit }> = [];
  const hooks: { noDownloadUrl?: boolean; downloadUrl?: string; status?: number } = {};
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input)), method = init.method ?? "GET";
    calls.push({ url, method, init });
    if (hooks.status) return new Response("{}", { status: hooks.status });
    if (url.origin === "https://download.example") return new Response(items.get(CLOUD_PROFILE_FILE)?.text ?? "", { status: 200 });
    const name = /approot:\/([^:?]+)/.exec(url.pathname)?.[1] as CloudFileName;
    const item = items.get(name);
    if (method === "GET") return item
      ? new Response(JSON.stringify({ id: "id-" + name, eTag: `"{${item.etag}}"`,
        ...(hooks.noDownloadUrl ? {} : { "@microsoft.graph.downloadUrl": hooks.downloadUrl ?? "https://download.example/f?tempauth=1" }) }), { status: 200 })
        : new Response("{}", { status: 404 });
    if (method === "PUT") {
      const exists = !!item;
      if (url.searchParams.get("@microsoft.graph.conflictBehavior") === "fail" && exists) return new Response("{}", { status: 409 });
      const next = { text: String(init.body), etag: (item?.etag ?? 0) + 1 };
      items.set(name, next);
      return new Response(JSON.stringify({ id: "id-" + name, eTag: `"{${next.etag}}"` }), { status: exists ? 200 : 201 });
    }
    if (method === "DELETE") { const had = items.delete(name); return new Response(null, { status: had ? 204 : 404 }); }
    return new Response("{}", { status: 400 });
  });
  return { items, calls, hooks, fetchMock };
}

describe("OneDrive approot (Microsoft Graph)", () => {
  let graph: ReturnType<typeof fakeGraph>;
  beforeEach(() => { graph = fakeGraph(); vi.stubGlobal("fetch", graph.fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("crea, legge, aggiorna e cancella solo nella cartella dell'app", async () => {
    const store = createGraphStore(ACCESS);
    expect(await store.read(CLOUD_PROFILE_FILE)).toBeNull();
    const created = await store.write(CLOUD_PROFILE_FILE, "UNO", null);
    expect(await store.read(CLOUD_PROFILE_FILE)).toEqual({ text: "UNO", version: created.version });
    const updated = await store.write(CLOUD_PROFILE_FILE, "DUE", created.version);
    expect(updated.version).not.toBe(created.version);
    await store.remove(CLOUD_PROFILE_FILE);
    expect(await store.read(CLOUD_PROFILE_FILE)).toBeNull();
    await store.remove(CLOUD_PROFILE_FILE);
    for (const call of graph.calls.filter(c => c.url.origin === "https://graph.microsoft.com"))
      expect(call.url.pathname).toMatch(/^\/v1\.0\/me\/drive\/special\/approot:\/bookwriter-profile\.json/);
  });
  it("il token d'accesso va solo a Graph: mai al link di download pre-autenticato", async () => {
    const store = createGraphStore(ACCESS);
    await store.write(CLOUD_PROFILE_FILE, "X", null);
    await store.read(CLOUD_PROFILE_FILE);
    const download = graph.calls.find(call => call.url.origin === "https://download.example")!;
    expect(new Headers(download.init.headers).has("authorization")).toBe(false);
    for (const call of graph.calls) {
      expect(call.init.credentials).toBe("omit");
      expect(call.init.redirect).toBe("error");
      expect(call.url.toString()).not.toContain(ACCESS);
    }
    expect(graph.calls.filter(call => call.url.origin === "https://graph.microsoft.com")
      .every(call => new Headers(call.init.headers).get("authorization") === "Bearer " + ACCESS)).toBe(true);
  });
  it("rifiuta un link di download non HTTPS e un file senza link", async () => {
    const store = createGraphStore(ACCESS);
    await store.write(CLOUD_PROFILE_FILE, "X", null);
    graph.hooks.downloadUrl = "http://download.example/f";
    await expect(store.read(CLOUD_PROFILE_FILE)).rejects.toMatchObject({ kind: "config" });
    graph.hooks.downloadUrl = undefined; graph.hooks.noDownloadUrl = true;
    await expect(store.read(CLOUD_PROFILE_FILE)).rejects.toMatchObject({ kind: "invalid" });
  });
  it("creazione su file esistente: conflitto; versione obsoleta o file cancellato: conflitto", async () => {
    const store = createGraphStore(ACCESS);
    const first = await store.write(CLOUD_PROFILE_FILE, "A", null);
    await expect(store.write(CLOUD_PROFILE_FILE, "B", null)).rejects.toMatchObject({ kind: "conflict" });
    await store.write(CLOUD_PROFILE_FILE, "B-altro", first.version);
    await expect(store.write(CLOUD_PROFILE_FILE, "C-mia", first.version)).rejects.toMatchObject({ kind: "conflict" });
    expect(graph.items.get(CLOUD_PROFILE_FILE)!.text).toBe("B-altro");
    graph.items.clear();
    await expect(store.write(CLOUD_PROFILE_FILE, "D", `"{2}"`)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("nomi di file fuori elenco rifiutati prima di ogni richiesta", async () => {
    const store = createGraphStore(ACCESS);
    await expect(store.read("../x.json" as unknown as CloudFileName)).rejects.toMatchObject({ kind: "config" });
    await expect(store.write("x" as unknown as CloudFileName, "{}", null)).rejects.toMatchObject({ kind: "config" });
    expect(graph.fetchMock).not.toHaveBeenCalled();
    await store.write(CLOUD_LIBRARY_FILE, "{}", null);
  });
  it.each([[401, "auth"], [403, "forbidden"], [429, "rate"], [500, "server"]])("HTTP %i → errore leggibile senza token", async (status, kind) => {
    graph.hooks.status = status;
    const error = await createGraphStore(ACCESS).read(CLOUD_PROFILE_FILE).catch((e: unknown) => e) as Error & { kind: string };
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain(ACCESS);
  });
});
