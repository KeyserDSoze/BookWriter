import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_LIBRARY_FILE, CLOUD_PROFILE_FILE } from "../domain/cloud-profile";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "../domain/types";
import { encryptLocal } from "../infrastructure/crypto";
import { getDb, loadSettings, saveSettings } from "../infrastructure/db";
import { clearCloudLink, getCloudLink, saveMicrosoftSession } from "../infrastructure/cloud/cloud-state";
import { CloudError } from "../infrastructure/cloud/types";
import { memoryCloud } from "./memory-cloud.testing";

const { connectGoogle, revokeGoogle, connectMicrosoft, refreshMicrosoft, microsoftSession } = vi.hoisted(() => ({
  connectGoogle: vi.fn(), revokeGoogle: vi.fn(async () => undefined),
  connectMicrosoft: vi.fn(), refreshMicrosoft: vi.fn(), microsoftSession: vi.fn(),
}));
vi.mock("../infrastructure/cloud/google-drive", () => ({ connectGoogle, revokeGoogle }));
vi.mock("../infrastructure/cloud/microsoft-graph", () => ({ connectMicrosoft, refreshMicrosoft, microsoftSession }));
import { CloudController } from "./cloud-controller";

const GOOGLE_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
const MS_ID = "11111111-2222-4333-8444-555555555555";

function book(title: string): BookProject {
  const created = newBook("brief " + title, title, "Sobrio", "Adulti");
  created.remote = { owner: "demo", repository: "r", branch: "main", lastSyncedCommit: "a".repeat(40), lastSyncAt: created.updatedAt };
  return created;
}
async function configured() {
  const db = await getDb();
  for (const name of ["settings", "meta", "books", "activities", "outbox"]) await db.clear(name);
  await db.put("meta", { googleClientId: GOOGLE_ID, microsoftClientId: MS_ID }, "cloud-config:v1");
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), githubToken: await encryptLocal("github_pat_XXXXXXXXXXXXXXXXXXXX") });
}

let cloud: ReturnType<typeof memoryCloud>;
beforeEach(async () => {
  vi.stubGlobal("navigator", { platform: "TestOS", locks: { request: async (_n: string, _o: unknown, cb: (lock: object) => unknown) => cb({}) } });
  cloud = memoryCloud();
  connectGoogle.mockReset(); connectMicrosoft.mockReset(); refreshMicrosoft.mockReset(); microsoftSession.mockReset();
  revokeGoogle.mockClear();
  connectGoogle.mockImplementation(async () => ({ session: cloud.session, accessToken: "ya29.token" }));
  await configured();
});
afterEach(() => vi.unstubAllGlobals());

async function connected(): Promise<CloudController> {
  const controller = new CloudController();
  await controller.init();
  controller.setBooks([book("Il faro")]);
  expect(await controller.connect("google")).toBe(true);
  return controller;
}

describe("controller del cloud", () => {
  it("al primo avvio non c'è nessun collegamento: nessuna richiesta di rete", async () => {
    const controller = new CloudController();
    await controller.init();
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", link: null, session: null });
    expect(controller.getSnapshot().device!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(controller.getSnapshot().config).toMatchObject({ googleClientId: GOOGLE_ID, microsoftTenant: "common" });
    expect(cloud.stats.reads).toBe(0);
  });
  it("apre l'accesso subito, nel gesto dell'utente, prima di qualsiasi attesa", async () => {
    const controller = new CloudController();
    await controller.init();
    const pending = controller.connect("google");
    expect(connectGoogle).toHaveBeenCalledTimes(1); // synchronously, before awaiting anything
    expect(connectGoogle.mock.calls[0]![0]).toBe(GOOGLE_ID);
    await pending;
  });
  it("Microsoft: stessa apertura immediata e tenant dalla configurazione", async () => {
    connectMicrosoft.mockImplementation(async () => ({ session: { ...cloud.session, provider: "microsoft" }, tokens: { refreshToken: "0.REFRESH" } }));
    const controller = new CloudController();
    await controller.init();
    const pending = controller.connect("microsoft");
    expect(connectMicrosoft).toHaveBeenCalledTimes(1);
    expect(connectMicrosoft.mock.calls[0]![0]).toEqual({ clientId: MS_ID, tenant: "common" });
    expect(await pending).toBe(true);
    const stored = await (await getDb()).get("meta", "cloud-session:v1") as { refreshToken: { data: string } };
    expect(JSON.stringify(stored)).not.toContain("0.REFRESH"); // stored encrypted
  });
  it("accesso riuscito: collegamento creato, cloud ispezionato, libreria sincronizzata, senza token nello stato", async () => {
    const controller = await connected();
    const snap = controller.getSnapshot();
    expect(snap).toMatchObject({ phase: "connected", busy: false, error: "" });
    expect(snap.link).toMatchObject({ provider: "google", accountId: "acc-1", profileRevision: 0, dirtyProfile: false, autoSync: true });
    expect(snap.inspection).toMatchObject({ profile: { exists: false }, library: { exists: true } });
    expect(snap.library!.books.map(entry => entry.title)).toEqual(["Il faro"]);
    expect(JSON.stringify(snap)).not.toMatch(/ya29|token/i);
    expect(cloud.files.has(CLOUD_LIBRARY_FILE)).toBe(true);
    expect(cloud.files.has(CLOUD_PROFILE_FILE)).toBe(false); // the profile is never uploaded without a choice
  });
  it("accesso annullato o rifiutato: nessun collegamento e messaggio chiaro", async () => {
    connectGoogle.mockRejectedValue(new CloudError("cancelled", "Accesso Google annullato."));
    const controller = new CloudController();
    await controller.init();
    expect(await controller.connect("google")).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", link: null, error: "Accesso Google annullato.", busy: false });
    expect(await getCloudLink()).toBeNull();
  });
  it("Client ID mancante: errore di configurazione, nessuna finestra", async () => {
    connectGoogle.mockRejectedValue(new CloudError("config", "Client ID Google non valido"));
    const controller = new CloudController();
    await controller.init();
    await controller.connect("google");
    expect(controller.getSnapshot().error).toMatch(/Client ID/);
  });
  it("cambiando account il vecchio collegamento e la chiave ricordata vengono azzerati", async () => {
    const controller = await connected();
    await (await getDb()).put("meta", { key: {}, salt: "s", iterations: 1 }, "cloud-vault-key:v1:google:acc-1");
    const second = memoryCloud("google", "acc-2");
    connectGoogle.mockImplementation(async () => ({ session: second.session, accessToken: "t2" }));
    await controller.connect("google");
    expect((await getCloudLink())!.accountId).toBe("acc-2");
    expect((await getCloudLink())!.profileRevision).toBe(0);
  });
  it("le operazioni si accodano: nessuna sovrapposizione nella stessa scheda", async () => {
    const controller = await connected();
    cloud.stats.maxActive = 0;
    await Promise.all([controller.syncLibraryNow(), controller.inspect(), controller.syncLibraryNow()]);
    expect(cloud.stats.maxActive).toBeLessThanOrEqual(2); // inspect reads two files at once, nothing overlaps with another job
  });

  describe("sincronizzazione periodica", () => {
    it("invia le impostazioni modificate e aggiorna l'elenco una sola volta per cambiamento", async () => {
      const controller = await connected();
      await controller.pushProfile({ protection: "account", rotate: true });
      expect((await getCloudLink())!.dirtyProfile).toBe(false);
      await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "nuovo" } });
      expect((await getCloudLink())!.dirtyProfile).toBe(true);
      const writes = cloud.stats.writes;
      controller.tick(); await controller.idle();
      expect(cloud.stats.writes).toBe(writes + 1);
      expect((await getCloudLink())!.dirtyProfile).toBe(false);
      expect(JSON.parse(cloud.files.get(CLOUD_PROFILE_FILE)!.text).revision).toBe(2);
      controller.tick(); await controller.idle();
      expect(cloud.stats.writes).toBe(writes + 1); // nothing new: nothing written
      controller.setBooks([book("Il faro"), book("La nebbia")]);
      controller.tick(); await controller.idle();
      expect(cloud.stats.writes).toBe(writes + 2);
      expect(controller.getSnapshot().library!.books).toHaveLength(3);
    });
    it("conflitto sul profilo: si ferma e chiede una scelta, senza riprovare a ogni giro", async () => {
      const controller = await connected();
      await controller.pushProfile({ protection: "account", rotate: true });
      const file = cloud.files.get(CLOUD_PROFILE_FILE)!;
      cloud.files.set(CLOUD_PROFILE_FILE, { version: file.version + 1, text: file.text.replace('"revision":1', '"revision":2') });
      await saveSettings({ ...await loadSettings(), defaultRoute: { endpointId: "openai", modelId: "locale" } });
      controller.tick(); await controller.idle();
      expect(controller.getSnapshot().conflict).toMatchObject({ remoteRevision: 2 });
      const writes = cloud.stats.writes, reads = cloud.stats.reads;
      controller.tick(); await controller.idle();
      expect(cloud.stats.writes).toBe(writes);
      expect(JSON.parse(cloud.files.get(CLOUD_PROFILE_FILE)!.text).revision).toBe(2);
      expect(cloud.stats.reads).toBeLessThanOrEqual(reads + 2); // only the cheap library check runs
    });
    it("vault con passphrase non ricordata: non invia e chiede la passphrase", async () => {
      const controller = await connected();
      await controller.pushProfile({ protection: "passphrase", passphrase: "una frase privata molto lunga", rotate: true });
      await saveSettings({ ...await loadSettings(), githubToken: await encryptLocal("github_pat_NUOVO_NUOVO_NUOVO_1234") });
      controller.tick(); await controller.idle();
      expect(controller.getSnapshot()).toMatchObject({ needsPassphrase: true });
      expect(controller.getSnapshot().error).toMatch(/passphrase/);
      expect((await getCloudLink())!.dirtyProfile).toBe(true);
    });
    it("un giro periodico senza lavoro da fare non accende mai lo stato «occupato»", async () => {
      const controller = await connected();
      const busy: boolean[] = [];
      controller.subscribe(() => busy.push(controller.getSnapshot().busy));
      controller.tick(); await controller.idle();
      controller.tick(); await controller.idle();
      expect(busy.every(value => value === false)).toBe(true);
    });
    it("con la sincronizzazione automatica spenta non parte nulla", async () => {
      const controller = await connected();
      await controller.setAutoSync(false);
      const before = cloud.stats.writes;
      controller.setBooks([book("Altro")]);
      controller.tick(); await controller.idle();
      expect(cloud.stats.writes).toBe(before);
    });
    it("la sessione Google scade (circa un'ora, senza refresh token): niente richieste, si chiede di riconnettere", async () => {
      const controller = await connected();
      cloud.session.expiresAt = Date.now() - 1_000;
      const reads = cloud.stats.reads;
      controller.tick(); await controller.idle();
      expect(controller.getSnapshot()).toMatchObject({ phase: "needs_reconnect", session: null });
      expect(controller.getSnapshot().message).toMatch(/Riconnetti/);
      expect(cloud.stats.reads).toBe(reads);
      controller.tick(); await controller.idle();
      expect(cloud.stats.reads).toBe(reads);
    });
    it("una risposta 401 del cloud fa decadere la sessione senza perdere le impostazioni", async () => {
      const controller = await connected();
      cloud.store.read = async () => { throw new CloudError("auth", "Sessione cloud scaduta o revocata: riconnetti l'account.", 401); };
      await controller.syncLibraryNow();
      expect(controller.getSnapshot()).toMatchObject({ phase: "needs_reconnect", error: expect.stringMatching(/riconnetti/) });
      expect((await loadSettings()).githubToken).toBeTruthy();
    });
  });

  describe("Microsoft: ripresa dopo un ricaricamento", () => {
    it("rinnova l'accesso con il refresh token salvato senza aprire finestre", async () => {
      const msCloud = memoryCloud("microsoft", "tid:oid");
      await (await getDb()).put("meta", { provider: "microsoft", accountId: "tid:oid", accountLabel: "a@outlook.com", profileRevision: 0, dirtyProfile: false,
        linkedAt: new Date().toISOString(), autoSync: true }, "cloud-link:v1");
      await saveMicrosoftSession("tid:oid", "a@outlook.com", "0.REFRESH-OLD");
      refreshMicrosoft.mockResolvedValue({ accessToken: "a", refreshToken: "0.REFRESH-NEW", expiresAt: Date.now() + 3_600_000 });
      microsoftSession.mockReturnValue(msCloud.session);
      const controller = new CloudController();
      await controller.init(); await controller.idle();
      expect(refreshMicrosoft).toHaveBeenCalledWith({ clientId: MS_ID, tenant: "common" }, "0.REFRESH-OLD");
      expect(controller.getSnapshot().phase).toBe("connected");
      expect(connectMicrosoft).not.toHaveBeenCalled();
      const stored = await (await getDb()).get("meta", "cloud-session:v1") as { savedAt: string };
      expect(stored.savedAt).toBeTruthy(); // the 24 h clock of the first sign-in is kept
    });
    it("init chiamato due volte (React in sviluppo) rinnova il refresh token una volta sola", async () => {
      const msCloud = memoryCloud("microsoft", "tid:oid");
      await (await getDb()).put("meta", { provider: "microsoft", accountId: "tid:oid", accountLabel: "a@outlook.com", profileRevision: 0, dirtyProfile: false,
        linkedAt: new Date().toISOString(), autoSync: true }, "cloud-link:v1");
      await saveMicrosoftSession("tid:oid", "a@outlook.com", "0.REFRESH-OLD");
      refreshMicrosoft.mockResolvedValue({ accessToken: "a", refreshToken: "0.REFRESH-NEW", expiresAt: Date.now() + 3_600_000 });
      microsoftSession.mockReturnValue(msCloud.session);
      const controller = new CloudController();
      await Promise.all([controller.init(), controller.init()]);
      await controller.idle();
      expect(refreshMicrosoft).toHaveBeenCalledTimes(1);
    });
    it("refresh token scaduto o rifiutato: resta «da riconnettere», senza finestre", async () => {
      await (await getDb()).put("meta", { provider: "microsoft", accountId: "tid:oid", accountLabel: "a@outlook.com", profileRevision: 0, dirtyProfile: false,
        linkedAt: new Date().toISOString(), autoSync: true }, "cloud-link:v1");
      await saveMicrosoftSession("tid:oid", "a@outlook.com", "0.REFRESH-OLD", new Date(Date.now() - 25 * 3_600_000).toISOString());
      const controller = new CloudController();
      await controller.init();
      expect(refreshMicrosoft).not.toHaveBeenCalled();
      expect(controller.getSnapshot().phase).toBe("needs_reconnect");
    });
  });

  describe("scollegamento", () => {
    it("cancella collegamento, sessione e chiave ricordata; impostazioni e libri locali restano", async () => {
      const controller = await connected();
      await controller.pushProfile({ protection: "passphrase", passphrase: "una frase privata molto lunga", remember: true, rotate: true });
      expect(await (await getDb()).get("meta", "cloud-vault-key:v1:google:acc-1")).toBeDefined();
      await controller.disconnect(true);
      expect(revokeGoogle).toHaveBeenCalledWith("ya29.token");
      expect(await getCloudLink()).toBeNull();
      expect(await (await getDb()).get("meta", "cloud-vault-key:v1:google:acc-1")).toBeUndefined();
      expect(controller.getSnapshot()).toMatchObject({ phase: "idle", link: null, session: null, library: null });
      expect((await loadSettings()).githubToken).toBeTruthy();
      expect(cloud.files.has(CLOUD_PROFILE_FILE)).toBe(true); // the cloud copy stays: other PCs still use it
    });
    it("senza revoca non contatta Google", async () => {
      const controller = await connected();
      await controller.disconnect();
      expect(revokeGoogle).not.toHaveBeenCalled();
    });
  });

  it("applicare il profilo cloud avvisa la pagina di rileggere le impostazioni", async () => {
    const controller = await connected();
    await controller.pushProfile({ protection: "account", rotate: true });
    const applied = vi.fn();
    controller.onSettingsApplied = applied;
    await controller.applyCloudProfile();
    expect(applied).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().message).toMatch(/Impostazioni applicate/);
  });
  it("rimuovere un libro dall'elenco cloud non cancella nulla da GitHub né dal dispositivo", async () => {
    const controller = await connected();
    const id = controller.getSnapshot().library!.books[0]!.bookId;
    await controller.removeBook(id);
    expect(controller.getSnapshot().library!.books[0]!.removed).toBe(true);
    expect(controller.getSnapshot().message).toMatch(/GitHub non sono toccati/);
  });
  it("collegamento rimosso a mano: nessuna sincronizzazione parte", async () => {
    const controller = await connected();
    await clearCloudLink();
    await expect(controller.pushProfile({ protection: "account", rotate: true })).resolves.not.toThrow();
    expect(controller.getSnapshot().error).toMatch(/non è collegato/);
  });
  it("elenco libri cloud corrotto: l'accesso riesce, l'errore è chiaro e solo una scelta esplicita lo ricrea", async () => {
    const controller = new CloudController();
    await controller.init();
    controller.setBooks([book("Il faro")]);
    cloud.files.set(CLOUD_LIBRARY_FILE, { text: "{rotto", version: 4 });
    await controller.connect("google");
    expect(controller.getSnapshot().error).toMatch(/libreria cloud non/i);
    expect(controller.getSnapshot().inspection!.library).toMatchObject({ exists: true, invalid: expect.any(String) });
    expect(cloud.files.get(CLOUD_LIBRARY_FILE)!.text).toBe("{rotto");
    await controller.recreateLibrary();
    expect(controller.getSnapshot().error).toBe("");
    expect(controller.getSnapshot().library!.books.map(entry => entry.title)).toEqual(["Il faro"]);
    expect(controller.getSnapshot().inspection!.library.invalid).toBeUndefined();
  });
});
