import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_LIBRARY_FILE, CLOUD_PROFILE_FILE, parseCloudProfile } from "../domain/cloud-profile";
import { DEFAULT_SETTINGS, newBook, type AppSettings, type BookProject } from "../domain/types";
import { decryptLocal, encryptLocal } from "../infrastructure/crypto";
import { getDb, loadSettings, saveBook, saveSettings } from "../infrastructure/db";
import { createCloudLink, getCloudDevice, getCloudLink } from "../infrastructure/cloud/cloud-state";
import { CloudError } from "../infrastructure/cloud/types";
import { memoryCloud } from "./memory-cloud.testing";
import { VaultLockedError, VaultPassphraseError } from "../infrastructure/cloud/vault";
import {
  inspectCloud, loadCloudLibrary, pullProfile, pushProfile, removeFromCloudLibrary, syncLibrary,
} from "./cloud-sync";

const PAT = "github_pat_TOKEN_DI_PROVA_0123456789";
const OPENAI_KEY = "sk-live-CHIAVE-OPENAI-0123456789";
const PASSPHRASE = "la mia frase molto privata";

async function newDevice(): Promise<void> {
  const db = await getDb();
  for (const name of ["settings", "meta", "books", "activities", "outbox", "mergeDrafts"]) await db.clear(name);
}
async function configure(overrides: Partial<AppSettings> = {}): Promise<AppSettings> {
  const settings: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal(PAT), theme: "light",
    endpoints: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1",
      secret: await encryptLocal(OPENAI_KEY), models: ["gpt-x"] }],
    defaultRoute: { endpointId: "openai", modelId: "gpt-x" }, ...overrides,
  };
  await saveSettings(settings);
  return settings;
}
function book(title: string, updatedAt = "2026-11-10T10:00:00.000Z"): BookProject {
  const created = newBook("BRIEF RISERVATO " + title, title, "Sobrio", "Adulti");
  created.updatedAt = updatedAt;
  created.memory.secrets = { Mara: "SEGRETO NARRATIVO " + title };
  created.remote = { owner: "demo", repository: title.toLowerCase().replace(/\W+/g, "-"), branch: "main",
    lastSyncedCommit: "a".repeat(40), lastSyncAt: updatedAt };
  return created;
}

let cloud: ReturnType<typeof memoryCloud>;
beforeEach(async () => {
  vi.stubGlobal("navigator", { platform: "TestOS", locks: { request: async (_n: string, _o: unknown, cb: (lock: object) => unknown) => cb({}) } });
  await newDevice();
  cloud = memoryCloud();
});
afterEach(() => vi.unstubAllGlobals());

describe("profilo: da un PC all'altro", () => {
  it("passphrase: il cloud contiene solo testo cifrato e il secondo PC recupera PAT e chiavi", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "autore@example.com");
    const pushed = await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    expect(pushed).toEqual({ status: "pushed", revision: 1 });
    const stored = cloud.files.get(CLOUD_PROFILE_FILE)!.text;
    for (const forbidden of [PAT, OPENAI_KEY, "github_pat", "sk-live", PASSPHRASE, "light"]) expect(stored).not.toContain(forbidden);
    expect(stored).toContain("https://api.openai.com/v1");

    await newDevice(); // another computer: empty IndexedDB, different device key
    await createCloudLink("google", "acc-1", "autore@example.com");
    await expect(pullProfile(cloud.session)).rejects.toBeInstanceOf(VaultLockedError);
    await expect(pullProfile(cloud.session, { passphrase: "una frase sbagliata ma lunga" })).rejects.toBeInstanceOf(VaultPassphraseError);
    expect((await loadSettings()).githubToken).toBeFalsy();

    const pulled = await pullProfile(cloud.session, { passphrase: PASSPHRASE });
    expect(pulled).toMatchObject({ status: "applied", revision: 1, apiKeys: 1, githubToken: true });
    const local = await loadSettings();
    expect(await decryptLocal(local.githubToken!)).toBe(PAT);
    expect(await decryptLocal(local.endpoints[0]!.secret!)).toBe(OPENAI_KEY);
    expect(local.defaultRoute).toEqual({ endpointId: "openai", modelId: "gpt-x" });
    expect(await getCloudLink()).toMatchObject({ profileRevision: 1, dirtyProfile: false, vaultMode: "passphrase" });
  });
  it("«solo account»: nessuna passphrase, ma il file è leggibile da chi entra nell'account", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "autore@example.com");
    await pushProfile(cloud.session, { protection: "account", rotate: true });
    expect(cloud.files.get(CLOUD_PROFILE_FILE)!.text).toContain(PAT);
    await newDevice();
    await createCloudLink("google", "acc-1", "autore@example.com");
    expect(await pullProfile(cloud.session)).toMatchObject({ status: "applied", githubToken: true });
    expect(await decryptLocal((await loadSettings()).githubToken!)).toBe(PAT);
  });
  it("tema e consenso all'ispezione restano quelli del dispositivo", async () => {
    await configure({ theme: "light", inspectAiRequests: true });
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "account", rotate: true });
    await newDevice();
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), theme: "dark", inspectAiRequests: false });
    await createCloudLink("google", "acc-1", "x");
    await pullProfile(cloud.session);
    expect(await loadSettings()).toMatchObject({ theme: "dark", inspectAiRequests: false });
  });
  it("un profilo cloud senza chiave per un endpoint non cancella la chiave locale", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "account", rotate: true });
    const file = cloud.files.get(CLOUD_PROFILE_FILE)!;
    const profile = JSON.parse(file.text);
    profile.vault.secrets.endpointKeys = {};
    cloud.files.set(CLOUD_PROFILE_FILE, { ...file, text: JSON.stringify(profile) });
    await pullProfile(cloud.session);
    expect(await decryptLocal((await loadSettings()).endpoints[0]!.secret!)).toBe(OPENAI_KEY);
  });
  it("il profilo non contiene PAT/chiavi accanto alle impostazioni in chiaro", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    const parsed = parseCloudProfile(cloud.files.get(CLOUD_PROFILE_FILE)!.text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(parsed.value.settings)).not.toMatch(/secret|token|key/i);
  });
});

describe("profilo: passphrase ricordata e rotazione", () => {
  it("senza passphrase e senza chiave ricordata chiede la passphrase; con «ricorda» non serve più", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    await newDevice();
    await configure({ githubToken: null });
    await createCloudLink("google", "acc-1", "x");
    await pullProfile(cloud.session, { passphrase: PASSPHRASE, remember: true });
    await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "altro" } });
    expect(await pushProfile(cloud.session, { protection: "passphrase" })).toMatchObject({ status: "pushed", revision: 2 });
  });
  it("senza chiave ricordata una modifica non parte e chiede la passphrase", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    expect(await pushProfile(cloud.session, { protection: "passphrase" })).toEqual({ status: "passphrase_required" });
  });
  it("una passphrase diversa non cambia in silenzio la chiave del vault esistente", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    const before = cloud.files.get(CLOUD_PROFILE_FILE)!.text;
    await expect(pushProfile(cloud.session, { protection: "passphrase", passphrase: "un'altra frase lunga e diversa" }))
      .rejects.toBeInstanceOf(VaultPassphraseError);
    expect(cloud.files.get(CLOUD_PROFILE_FILE)!.text).toBe(before);
  });
  it("cambiando passphrase (rotate) il vecchio vault non si apre più con la vecchia frase", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: "frase completamente nuova 2026", rotate: true });
    await newDevice();
    await createCloudLink("google", "acc-1", "x");
    await expect(pullProfile(cloud.session, { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(VaultPassphraseError);
    expect(await pullProfile(cloud.session, { passphrase: "frase completamente nuova 2026" })).toMatchObject({ status: "applied" });
  });
  it("rifiuta passphrase troppo corte alla creazione", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await expect(pushProfile(cloud.session, { protection: "passphrase", passphrase: "corta", rotate: true })).rejects.toThrow(/almeno 12/);
    expect(cloud.files.size).toBe(0);
  });
});

describe("profilo: conflitti tra dispositivi", () => {
  async function twoDevices() {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "account", rotate: true });
    const deviceA = await getCloudDevice();
    await newDevice();
    await createCloudLink("google", "acc-1", "x");
    await pullProfile(cloud.session);
    return deviceA;
  }
  it("l'altro dispositivo ha già cambiato il profilo: nessuna sovrascrittura silenziosa", async () => {
    await twoDevices();
    // Device B edits and pushes revision 2.
    await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "modello-B" } });
    expect(await pushProfile(cloud.session, { protection: "account" })).toMatchObject({ status: "pushed", revision: 2 });
    // Device A is still on revision 1 and has its own edit.
    await newDevice();
    await configure({ defaultRoute: { endpointId: "openai", modelId: "modello-A" } });
    await createCloudLink("google", "acc-1", "x");
    const outcome = await pushProfile(cloud.session, { protection: "account" });
    expect(outcome).toMatchObject({ status: "conflict", remoteRevision: 2, remoteDevice: "TestOS" });
    const remote = JSON.parse(cloud.files.get(CLOUD_PROFILE_FILE)!.text);
    expect(remote.settings.defaultRoute.modelId).toBe("modello-B");
    // The author may choose to replace the cloud profile explicitly.
    expect(await pushProfile(cloud.session, { protection: "account", overwrite: true })).toMatchObject({ status: "pushed", revision: 3 });
    expect(JSON.parse(cloud.files.get(CLOUD_PROFILE_FILE)!.text).settings.defaultRoute.modelId).toBe("modello-A");
  });
  it("una scrittura concorrente tra la nostra lettura e scrittura viene segnalata come conflitto", async () => {
    await twoDevices();
    await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "mia" } });
    cloud.hooks.beforeWrite = name => {
      if (name !== CLOUD_PROFILE_FILE) return;
      const file = cloud.files.get(name)!;
      cloud.files.set(name, { text: file.text.replace('"revision":1', '"revision":2'), version: file.version + 1 });
      cloud.hooks.beforeWrite = undefined;
    };
    expect(await pushProfile(cloud.session, { protection: "account" })).toMatchObject({ status: "conflict" });
  });
  it("modificare le impostazioni segna il profilo da inviare; il solo tema no", async () => {
    await twoDevices();
    expect((await getCloudLink())!.dirtyProfile).toBe(false);
    await saveSettings({ ...await loadSettings(), theme: "dark", inspectAiRequests: true });
    expect((await getCloudLink())!.dirtyProfile).toBe(false);
    await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "nuovo" } });
    expect((await getCloudLink())!.dirtyProfile).toBe(true);
    await pushProfile(cloud.session, { protection: "account" });
    expect((await getCloudLink())!.dirtyProfile).toBe(false);
    const withNewKey = await loadSettings();
    withNewKey.endpoints[0]!.secret = await encryptLocal("sk-nuova-chiave-12345678");
    await saveSettings(withNewKey);
    expect((await getCloudLink())!.dirtyProfile).toBe(true);
  });
  it("senza collegamento cloud salvare le impostazioni non scrive nulla di cloud", async () => {
    await configure();
    expect(await getCloudLink()).toBeNull();
    expect(await (await getDb()).get("meta", "cloud-link:v1")).toBeUndefined();
  });
  it("un profilo illeggibile si sostituisce solo con una scelta esplicita", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    cloud.files.set(CLOUD_PROFILE_FILE, { text: '{"schemaVersion":9}', version: 5 });
    await expect(pushProfile(cloud.session, { protection: "account" })).rejects.toMatchObject({ kind: "invalid" });
    expect(await pushProfile(cloud.session, { protection: "account", overwrite: true })).toMatchObject({ status: "pushed" });
    expect(parseCloudProfile(cloud.files.get(CLOUD_PROFILE_FILE)!.text).ok).toBe(true);
  });
  it("non invia nulla se il dispositivo è collegato a un altro account", async () => {
    await configure();
    await createCloudLink("google", "altro-account", "x");
    await expect(pushProfile(cloud.session, { protection: "account", rotate: true })).rejects.toMatchObject({ kind: "config" });
    expect(cloud.files.size).toBe(0);
  });
});

describe("profilo cloud ostile", () => {
  async function plant(mutate: (profile: Record<string, any>) => void): Promise<string> {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "account", rotate: true });
    const file = cloud.files.get(CLOUD_PROFILE_FILE)!;
    const profile = JSON.parse(file.text);
    mutate(profile);
    cloud.files.set(CLOUD_PROFILE_FILE, { ...file, text: JSON.stringify(profile) });
    await newDevice();
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), theme: "dark" });
    await createCloudLink("google", "acc-1", "x");
    return JSON.stringify(await loadSettings());
  }
  it.each([
    ["endpoint HTTP non locale", (p: Record<string, any>) => { p.settings.endpoints[0].baseUrl = "http://evil.example/v1"; }, /HTTPS/],
    ["senza autenticazione su host remoto", (p: Record<string, any>) => { p.settings.endpoints[0].authMode = "none"; }, /localhost/],
    ["URL con credenziali", (p: Record<string, any>) => { p.settings.endpoints[0].baseUrl = "https://user:pw@api.openai.com/v1"; }, /credenziali/],
    ["timeout fuori limite", (p: Record<string, any>) => { p.settings.endpoints[0].headerTimeoutSeconds = 99999; }, /./],
  ])("%s: nessuna modifica alle impostazioni locali", async (_label, mutate, message) => {
    const before = await plant(mutate);
    await expect(pullProfile(cloud.session)).rejects.toThrow(message);
    expect(JSON.stringify(await loadSettings())).toBe(before);
  });
  it("file alterato o di schema sconosciuto: errore leggibile, impostazioni intatte", async () => {
    const before = await plant(p => { p.schemaVersion = 7; });
    await expect(pullProfile(cloud.session)).rejects.toMatchObject({ kind: "invalid", message: expect.stringMatching(/schema/) });
    expect(JSON.stringify(await loadSettings())).toBe(before);
  });
  it("impostazioni locali cambiate durante l'aggiornamento: nessuna modifica applicata", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "account", rotate: true });
    // The edit lands after the settings were read and before the transaction that writes them.
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    let fired = false;
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
      if (!fired) {
        fired = true;
        await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "cambiato-nel-frattempo" } });
      }
      return original(...args);
    });
    await expect(pullProfile(cloud.session)).rejects.toMatchObject({ kind: "conflict" });
    expect(fired).toBe(true);
    expect((await loadSettings()).defaultRoute.modelId).toBe("cambiato-nel-frattempo");
  });
});

describe("libreria dei libri", () => {
  it("il secondo PC vede titolo, stato e repository, ma nessun contenuto del libro", async () => {
    await saveBook(book("Il faro"), false);
    await saveBook(book("La nebbia"), false);
    await createCloudLink("google", "acc-1", "x");
    const result = await syncLibrary(cloud.session, [await (await getDb()).get("books", (await (await getDb()).getAllKeys("books"))[0]!) as BookProject,
      await (await getDb()).get("books", (await (await getDb()).getAllKeys("books"))[1]!) as BookProject]);
    expect(result).toMatchObject({ written: true, changed: 2 });
    const stored = cloud.files.get(CLOUD_LIBRARY_FILE)!.text;
    for (const forbidden of ["BRIEF RISERVATO", "SEGRETO NARRATIVO", "memory", "text"]) expect(stored).not.toContain(forbidden);
    await newDevice();
    const library = await loadCloudLibrary(cloud.session);
    expect(library!.books.map(entry => entry.title).sort()).toEqual(["Il faro", "La nebbia"]);
    expect(library!.books[0]!.remote).toMatchObject({ owner: "demo", branch: "main" });
  });
  it("senza modifiche non riscrive il file; dopo una modifica scrive una sola voce", async () => {
    const a = book("Il faro");
    await createCloudLink("google", "acc-1", "x");
    await syncLibrary(cloud.session, [a]);
    const version = cloud.files.get(CLOUD_LIBRARY_FILE)!.version;
    expect(await syncLibrary(cloud.session, [a])).toMatchObject({ written: false, changed: 0 });
    expect(cloud.files.get(CLOUD_LIBRARY_FILE)!.version).toBe(version);
    const changed = { ...a, status: "paused" as const, updatedAt: "2026-11-12T10:00:00.000Z" };
    expect(await syncLibrary(cloud.session, [changed])).toMatchObject({ written: true, changed: 1 });
  });
  it("due dispositivi che scrivono insieme: si fondono senza perdere nessun libro", async () => {
    await createCloudLink("google", "acc-1", "x");
    const faro = book("Il faro"), nebbia = book("La nebbia");
    await syncLibrary(cloud.session, [faro]);
    const other = JSON.parse(cloud.files.get(CLOUD_LIBRARY_FILE)!.text);
    cloud.hooks.beforeWrite = name => {
      if (name !== CLOUD_LIBRARY_FILE) return;
      const file = cloud.files.get(name)!;
      const entry = { ...other.books[0], bookId: "99999999-9999-4999-8999-999999999999", title: "Scritto da un altro PC",
        deviceId: "88888888-8888-4888-8888-888888888888", deviceName: "Altro PC" };
      cloud.files.set(name, { text: JSON.stringify({ ...other, revision: other.revision + 1, books: [...other.books, entry] }), version: file.version + 1 });
      cloud.hooks.beforeWrite = undefined;
    };
    const result = await syncLibrary(cloud.session, [faro, nebbia]);
    expect(result.written).toBe(true);
    expect(result.library!.books.map(entry => entry.title).sort()).toEqual(["Il faro", "La nebbia", "Scritto da un altro PC"]);
  });
  it("un libro avanzato da un altro dispositivo non viene fatto regredire", async () => {
    await createCloudLink("google", "acc-1", "x");
    const advanced = book("Il faro", "2026-11-12T10:00:00.000Z");
    await syncLibrary(cloud.session, [advanced]);
    await newDevice();
    await createCloudLink("google", "acc-1", "x");
    const stale = { ...advanced, updatedAt: "2026-11-10T10:00:00.000Z", status: "idle" as const };
    expect(await syncLibrary(cloud.session, [stale])).toMatchObject({ written: false });
    expect((await loadCloudLibrary(cloud.session))!.books[0]!.bookUpdatedAt).toBe("2026-11-12T10:00:00.000Z");
  });
  it("rimozione dall'elenco cloud: il libro scompare dagli altri dispositivi, non i dati su GitHub", async () => {
    await createCloudLink("google", "acc-1", "x");
    const a = book("Il faro");
    await syncLibrary(cloud.session, [a]);
    const library = await removeFromCloudLibrary(cloud.session, a.id);
    expect(library!.books[0]!.removed).toBe(true);
    expect(await syncLibrary(cloud.session, [a])).toMatchObject({ written: false });
  });
  it("una libreria cloud corrotta non viene mai sovrascritta in silenzio", async () => {
    await createCloudLink("google", "acc-1", "x");
    cloud.files.set(CLOUD_LIBRARY_FILE, { text: "{rotto", version: 3 });
    await expect(syncLibrary(cloud.session, [book("Il faro")])).rejects.toMatchObject({ kind: "invalid" });
    expect(cloud.files.get(CLOUD_LIBRARY_FILE)!.text).toBe("{rotto");
  });
  it("continua a fondere fino a 3 tentativi, poi si ferma con un messaggio chiaro", async () => {
    await createCloudLink("google", "acc-1", "x");
    await syncLibrary(cloud.session, [book("Il faro")]);
    cloud.hooks.beforeWrite = () => { throw new CloudError("conflict", "sempre in conflitto"); };
    await expect(syncLibrary(cloud.session, [book("Nuovo")])).rejects.toMatchObject({ kind: "conflict", message: expect.stringMatching(/cambia continuamente/) });
  });
});

describe("ispezione e blocchi", () => {
  it("riassume il cloud senza mostrare segreti", async () => {
    await configure();
    await createCloudLink("google", "acc-1", "x");
    await pushProfile(cloud.session, { protection: "passphrase", passphrase: PASSPHRASE, rotate: true });
    await syncLibrary(cloud.session, [book("Il faro")]);
    const inspection = await inspectCloud(cloud.session);
    expect(inspection).toMatchObject({ profile: { exists: true, revision: 1, vaultMode: "passphrase", sameDevice: true }, library: { exists: true, books: 1 } });
    expect(JSON.stringify(inspection)).not.toMatch(/github_pat|sk-live/);
  });
  it("cloud vuoto: nessun profilo e nessuna libreria", async () => {
    expect(await inspectCloud(cloud.session)).toEqual({ profile: { exists: false }, library: { exists: false } });
  });
  it("senza Web Locks la sincronizzazione cloud non parte", async () => {
    vi.stubGlobal("navigator", {});
    await expect(syncLibrary(cloud.session, [])).rejects.toThrow(/Web Locks/);
    await expect(pullProfile(cloud.session)).rejects.toThrow(/Web Locks/);
  });
  it("una seconda sincronizzazione contemporanea in un'altra scheda viene rifiutata", async () => {
    vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, cb: (lock: null) => unknown) => cb(null) } });
    await expect(syncLibrary(cloud.session, [])).rejects.toMatchObject({ kind: "conflict" });
  });
});
