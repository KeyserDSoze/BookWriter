import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_LIBRARY_FILE, CLOUD_PROFILE_FILE, type CloudFileName } from "@engine/domain/cloud-profile";
import {
  createGoogleDriveStore, googleSession, requestGoogleToken, GOOGLE_DRIVE_SCOPE, GOOGLE_SCOPES,
} from "./google-drive";
import { CloudError } from "./types";

const TOKEN = "ya29.TOKEN-SEGRETO-DI-ACCESSO";
const CLIENT_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";

interface DriveFile { id: string; name: string; version: number; text: string; createdAt: number }
function fakeDrive() {
  const files: DriveFile[] = [];
  const calls: Array<{ url: URL; method: string; init: RequestInit }> = [];
  let counter = 0, clock = 0;
  const hooks: { afterCreate?: () => void; beforeMedia?: () => void; status?: number; retryAfter?: string; bigBody?: boolean } = {};
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input)), method = init.method ?? "GET";
    calls.push({ url, method, init });
    if (hooks.status) return new Response("{}", { status: hooks.status, headers: hooks.retryAfter ? { "retry-after": hooks.retryAfter } : {} });
    if (url.origin !== "https://www.googleapis.com") throw new Error("host non previsto " + url.origin);
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (method === "GET" && url.pathname === "/drive/v3/files") {
      const name = /name = '([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      expect(url.searchParams.get("spaces")).toBe("appDataFolder");
      return json({ files: files.filter(file => file.name === name).sort((a, b) => a.createdAt - b.createdAt)
        .map(file => ({ id: file.id, version: String(file.version) })) });
    }
    if (method === "GET" && url.searchParams.get("alt") === "media") {
      hooks.beforeMedia?.();
      const file = files.find(candidate => candidate.id === id);
      if (hooks.bigBody) return new Response("x", { status: 200, headers: { "content-length": "5000000" } });
      return file ? new Response(file.text, { status: 200 }) : new Response("", { status: 404 });
    }
    if (method === "GET") {
      const file = files.find(candidate => candidate.id === id);
      return file ? json({ id: file.id, version: String(file.version) }) : json({}, 404);
    }
    if (method === "POST" && url.pathname === "/upload/drive/v3/files") {
      const body = String(init.body);
      const name = /"name":"([^"]+)"/.exec(body)?.[1] ?? "";
      expect(body).toContain('"parents":["appDataFolder"]');
      const content = body.split("\r\n\r\n")[2]!.replace(/\r\n--bookwriter-[^]*$/, "");
      const file = { id: "file-" + ++counter, name, version: 1, text: content, createdAt: ++clock };
      files.push(file);
      hooks.afterCreate?.();
      return json({ id: file.id, version: String(file.version) });
    }
    if (method === "PATCH") {
      const file = files.find(candidate => candidate.id === id);
      if (!file) return json({}, 404);
      file.text = String(init.body); file.version++;
      return json({ id: file.id, version: String(file.version) });
    }
    if (method === "DELETE") {
      const at = files.findIndex(candidate => candidate.id === id);
      if (at < 0) return new Response("", { status: 404 });
      files.splice(at, 1);
      return new Response(null, { status: 204 });
    }
    return json({}, 400);
  });
  return { files, calls, hooks, fetchMock };
}

let drive: ReturnType<typeof fakeDrive>;
beforeEach(() => { drive = fakeDrive(); vi.stubGlobal("fetch", drive.fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Google Drive appDataFolder", () => {
  it("crea, legge, aggiorna e cancella un file nella sola cartella dati dell'app", async () => {
    const store = createGoogleDriveStore(TOKEN);
    expect(await store.read(CLOUD_PROFILE_FILE)).toBeNull();
    const created = await store.write(CLOUD_PROFILE_FILE, '{"a":1}', null);
    expect(await store.read(CLOUD_PROFILE_FILE)).toEqual({ text: '{"a":1}', version: created.version });
    const updated = await store.write(CLOUD_PROFILE_FILE, '{"a":2}', created.version);
    expect(updated.version).not.toBe(created.version);
    expect((await store.read(CLOUD_PROFILE_FILE))?.text).toBe('{"a":2}');
    await store.remove(CLOUD_PROFILE_FILE);
    expect(await store.read(CLOUD_PROFILE_FILE)).toBeNull();
    await store.remove(CLOUD_PROFILE_FILE); // deleting a missing file is not an error
  });
  it("ogni richiesta va solo a googleapis.com, senza cookie, redirect o referrer", async () => {
    const store = createGoogleDriveStore(TOKEN);
    const created = await store.write(CLOUD_LIBRARY_FILE, "{}", null);
    await store.read(CLOUD_LIBRARY_FILE);
    await store.write(CLOUD_LIBRARY_FILE, "{}", created.version);
    expect(drive.calls.length).toBeGreaterThan(5);
    for (const call of drive.calls) {
      expect(call.url.origin).toBe("https://www.googleapis.com");
      expect(call.init.credentials).toBe("omit");
      expect(call.init.redirect).toBe("error");
      expect(call.init.referrerPolicy).toBe("no-referrer");
      expect(call.init.cache).toBe("no-store");
      expect(new Headers(call.init.headers).get("authorization")).toBe("Bearer " + TOKEN);
      expect(call.url.toString()).not.toContain(TOKEN);
    }
  });
  it("rifiuta un nome di file fuori dall'elenco consentito, prima di ogni richiesta", async () => {
    const store = createGoogleDriveStore(TOKEN);
    for (const name of ["x.json", "bookwriter-profile.json' or name contains '"] as unknown as CloudFileName[]) {
      await expect(store.read(name)).rejects.toMatchObject({ kind: "config" });
      await expect(store.write(name, "{}", null)).rejects.toMatchObject({ kind: "config" });
    }
    expect(drive.fetchMock).not.toHaveBeenCalled();
  });
  it("scrittura con versione obsoleta: conflitto, il file dell'altro dispositivo resta intatto", async () => {
    const store = createGoogleDriveStore(TOKEN);
    const first = await store.write(CLOUD_PROFILE_FILE, "A", null);
    await store.write(CLOUD_PROFILE_FILE, "B-altro-dispositivo", first.version);
    await expect(store.write(CLOUD_PROFILE_FILE, "C-mia", first.version)).rejects.toMatchObject({ kind: "conflict" });
    expect(drive.files[0]!.text).toBe("B-altro-dispositivo");
  });
  it("scrittura su un file cancellato altrove: conflitto; creazione su file esistente: conflitto", async () => {
    const store = createGoogleDriveStore(TOKEN);
    const first = await store.write(CLOUD_PROFILE_FILE, "A", null);
    await expect(store.write(CLOUD_PROFILE_FILE, "B", null)).rejects.toMatchObject({ kind: "conflict" });
    drive.files.length = 0;
    await expect(store.write(CLOUD_PROFILE_FILE, "B", first.version)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("due dispositivi che creano insieme lo stesso file: vince il più vecchio, il nostro viene rimosso", async () => {
    const store = createGoogleDriveStore(TOKEN);
    drive.hooks.afterCreate = () => {
      // The other device's file was created first (older createdAt) but listed after our POST.
      drive.files.unshift({ id: "file-altro", name: CLOUD_PROFILE_FILE, version: 1, text: "ALTRO", createdAt: 0 });
      drive.hooks.afterCreate = undefined;
    };
    await expect(store.write(CLOUD_PROFILE_FILE, "MIO", null)).rejects.toMatchObject({ kind: "conflict" });
    expect(drive.files.map(file => file.text)).toEqual(["ALTRO"]);
  });
  it("una lettura interrotta da una scrittura non accoppia testo vecchio e versione nuova", async () => {
    const store = createGoogleDriveStore(TOKEN);
    await store.write(CLOUD_PROFILE_FILE, "V1", null);
    let once = true;
    drive.hooks.beforeMedia = () => { if (once) { once = false; drive.files[0]!.version++; drive.files[0]!.text = "V2"; } };
    const read = await store.read(CLOUD_PROFILE_FILE);
    expect(read?.text).toBe("V2");
    expect(read?.version).toBe(String(drive.files[0]!.version));
  });
  it.each([
    [401, "auth", /riconnetti/], [403, "forbidden", /negato/], [404, "notfound", /non trovato/],
    [429, "rate", /riprova tra 30 secondi/], [503, "server", /errore/],
  ])("HTTP %i diventa un errore leggibile e senza dati sensibili", async (status, kind, message) => {
    drive.hooks.status = status; drive.hooks.retryAfter = "30";
    const error = await createGoogleDriveStore(TOKEN).read(CLOUD_PROFILE_FILE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).kind).toBe(kind);
    expect((error as CloudError).message).toMatch(message);
    expect((error as CloudError).message).not.toContain(TOKEN);
    expect((error as CloudError).message).not.toContain("googleapis");
  });
  it("scarta una risposta più grande del limite senza leggerla", async () => {
    const store = createGoogleDriveStore(TOKEN);
    await store.write(CLOUD_PROFILE_FILE, "{}", null);
    drive.hooks.bigBody = true;
    await expect(store.read(CLOUD_PROFILE_FILE)).rejects.toMatchObject({ kind: "invalid", message: expect.stringMatching(/troppo grande/) });
  });
  it("un errore di rete non rivela token né indirizzi", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch https://www.googleapis.com?token=" + TOKEN); }));
    const error = await createGoogleDriveStore(TOKEN).read(CLOUD_PROFILE_FILE).catch((e: unknown) => e) as CloudError;
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(TOKEN);
  });
  it("l'annullamento dell'autore ha la precedenza e non diventa un errore di rete", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
    })));
    const pending = createGoogleDriveStore(TOKEN).read(CLOUD_PROFILE_FILE, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("scade se il servizio non risponde, con un messaggio sul tempo", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
    })));
    const pending = createGoogleDriveStore(TOKEN).read(CLOUD_PROFILE_FILE).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await pending).toMatchObject({ kind: "network", message: expect.stringMatching(/entro 20 secondi/) });
  });
});

describe("accesso Google (Google Identity Services)", () => {
  function stubGis(behavior: (config: { callback: (r: Record<string, unknown>) => void; error_callback: (e: { type: string }) => void }) => void, granted = true) {
    const initTokenClient = vi.fn((config: { callback: (r: Record<string, unknown>) => void; error_callback: (e: { type: string }) => void }) =>
      ({ requestAccessToken: () => behavior(config) }));
    vi.stubGlobal("window", { google: { accounts: { oauth2: {
      initTokenClient, hasGrantedAllScopes: () => granted, revoke: vi.fn(),
    } } } });
    return initTokenClient;
  }
  it("chiede solo il permesso sulla cartella dati dell'app, mai l'intero Drive", () => {
    expect(GOOGLE_SCOPES.split(" ")).toEqual(["openid", "email", "profile", GOOGLE_DRIVE_SCOPE]);
    expect(GOOGLE_DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.appdata");
  });
  it("rifiuta un Client ID malformato senza caricare lo script di Google", async () => {
    const created = vi.fn();
    vi.stubGlobal("document", { createElement: created });
    vi.stubGlobal("window", {});
    await expect(requestGoogleToken("non-un-client-id")).rejects.toMatchObject({ kind: "config" });
    expect(created).not.toHaveBeenCalled();
  });
  it("restituisce il token con scadenza e senza chiedere il client secret", async () => {
    const init = stubGis(config => config.callback({ access_token: TOKEN, expires_in: 3599, scope: GOOGLE_SCOPES }));
    const before = Date.now();
    const token = await requestGoogleToken(CLIENT_ID, { hint: "me@example.com" });
    expect(token.accessToken).toBe(TOKEN);
    expect(token.expiresAt).toBeGreaterThan(before + 3_500_000);
    const config = init.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(config).toMatchObject({ client_id: CLIENT_ID, scope: GOOGLE_SCOPES, hint: "me@example.com" });
    expect(JSON.stringify(config)).not.toMatch(/secret/i);
  });
  it("permesso Drive non concesso: errore chiaro", async () => {
    stubGis(config => config.callback({ access_token: TOKEN, expires_in: 3599 }), false);
    await expect(requestGoogleToken(CLIENT_ID)).rejects.toMatchObject({ kind: "forbidden", message: expect.stringMatching(/drive\.appdata/) });
  });
  it.each([
    ["access_denied", "cancelled"], ["invalid_client", "auth"],
  ])("risposta %s", async (code, kind) => {
    stubGis(config => config.callback({ error: code }));
    await expect(requestGoogleToken(CLIENT_ID)).rejects.toMatchObject({ kind });
  });
  it("finestra bloccata o chiusa dall'autore: annullato con indicazioni", async () => {
    stubGis(config => config.error_callback({ type: "popup_failed_to_open" }));
    await expect(requestGoogleToken(CLIENT_ID)).rejects.toMatchObject({ kind: "cancelled", message: expect.stringMatching(/blocca/) });
    stubGis(config => config.error_callback({ type: "popup_closed" }));
    await expect(requestGoogleToken(CLIENT_ID)).rejects.toMatchObject({ kind: "cancelled" });
  });
  it("la sessione espone account stabile ed etichetta, mai il token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://www.googleapis.com/oauth2/v3/userinfo");
      return new Response(JSON.stringify({ sub: "10987", email: "autore@example.com", name: "Autore" }), { status: 200 });
    }));
    const session = await googleSession({ accessToken: TOKEN, expiresAt: 123 });
    expect(session).toMatchObject({ provider: "google", accountId: "10987", accountLabel: "autore@example.com", expiresAt: 123 });
    expect(JSON.stringify({ ...session, store: undefined })).not.toContain(TOKEN);
  });
});
