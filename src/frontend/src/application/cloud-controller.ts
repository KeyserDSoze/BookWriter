import { CLOUD_LIBRARY_FILE, type CloudLibrary, type CloudDevice } from "../domain/cloud-profile";
import type { BookProject } from "../domain/types";
import { CloudError, CLOUD_PROVIDER_LABEL, type CloudProvider, type CloudSession } from "../infrastructure/cloud/types";
import {
  clearCloudLink, clearMicrosoftSession, createCloudLink, getCloudDevice, getCloudLink, loadCloudConfig,
  loadMicrosoftSession, renameCloudDevice, saveCloudOverrides, saveMicrosoftSession, updateCloudLink,
  type CloudConfig, type CloudLink,
} from "../infrastructure/cloud/cloud-state";
import { connectGoogle, revokeGoogle } from "../infrastructure/cloud/google-drive";
import { connectMicrosoft, microsoftSession, refreshMicrosoft } from "../infrastructure/cloud/microsoft-graph";
import { forgetVaultKey } from "../infrastructure/cloud/vault-store";
import { VaultLockedError, VaultPassphraseError } from "../infrastructure/cloud/vault";
import {
  inspectCloud, pullProfile, pushProfile, removeFromCloudLibrary, syncLibrary,
  type CloudInspection, type PushRequest, type VaultAccess,
} from "./cloud-sync";

export type CloudPhase = "loading" | "idle" | "connecting" | "connected" | "needs_reconnect";
export interface ProfileConflict { remoteRevision: number; remoteDevice: string; remoteUpdatedAt: string }
export interface CloudSnapshot {
  phase: CloudPhase;
  config: CloudConfig;
  link: CloudLink | null;
  device: CloudDevice | null;
  /** Memory-only session: tokens are never part of this object. */
  session: { provider: CloudProvider; accountLabel: string; expiresAt: number } | null;
  inspection: CloudInspection | null;
  library: CloudLibrary | null;
  conflict: ProfileConflict | null;
  /** An action needs the vault passphrase of the cloud profile. */
  needsPassphrase: boolean;
  busy: boolean;
  message: string;
  error: string;
}

export function describeCloudError(error: unknown): string {
  if (error instanceof CloudError || error instanceof VaultLockedError || error instanceof VaultPassphraseError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "Operazione annullata.";
  if (error instanceof Error) return error.message;
  return "Operazione cloud non riuscita.";
}

const MARGIN_MS = 60_000;
const emptyConfig: CloudConfig = { googleClientId: "", microsoftClientId: "", microsoftTenant: "common" };

/** One per page. All cloud actions queue behind each other, so a manual push and the
 * periodic sync never overlap in this tab (other tabs are fenced by a Web Lock). */
export class CloudController {
  private listeners = new Set<() => void>();
  private state: CloudSnapshot = {
    phase: "loading", config: emptyConfig, link: null, device: null, session: null, inspection: null,
    library: null, conflict: null, needsPassphrase: false, busy: false, message: "", error: "",
  };
  private session: CloudSession | null = null;
  private googleAccessToken: string | null = null;
  private books: BookProject[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private pendingVisible = 0;
  private lastLibraryKey = "";
  private autoPushBlocked = false;
  /** The page reloads its React settings after the cloud profile was applied. */
  onSettingsApplied?: () => void | Promise<void>;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): CloudSnapshot => this.state;

  private set(patch: Partial<CloudSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private publishSession(): void {
    this.set({ session: this.session && { provider: this.session.provider,
      accountLabel: this.session.accountLabel, expiresAt: this.session.expiresAt } });
  }
  private enqueue<T>(job: () => Promise<T>, label = "", silent = false): Promise<T | undefined> {
    this.pending++;
    // The periodic tick runs silently: a «busy» flash every few seconds would keep disabling buttons.
    if (!silent) { this.pendingVisible++; this.set({ busy: true, error: "", ...(label ? { message: label } : {}) }); }
    const run = this.chain.then(job, job).catch((error: unknown) => {
      this.set({ error: describeCloudError(error) });
      if (error instanceof CloudError && error.kind === "auth" && this.state.link) this.dropSession();
      if (error instanceof VaultLockedError) this.set({ needsPassphrase: true });
      return undefined;
    }).finally(() => {
      this.pending--;
      if (!silent && --this.pendingVisible === 0) this.set({ busy: false });
    });
    this.chain = run;
    return run;
  }
  private dropSession(): void {
    this.session = null; this.googleAccessToken = null;
    this.set({ session: null, phase: this.state.link ? "needs_reconnect" : "idle" });
  }

  private starting?: Promise<void>;
  /** Safe to call twice (React runs effects twice in development): a Microsoft refresh token rotates. */
  init(): Promise<void> { return this.starting ??= this.start(); }

  private async start(): Promise<void> {
    try {
      const [config, device, link] = [await loadCloudConfig(), await getCloudDevice(), await getCloudLink()];
      this.set({ config, device, link, phase: link ? "needs_reconnect" : "idle" });
      if (link?.provider === "microsoft") await this.restoreMicrosoft(link, config);
    } catch (error) { this.set({ phase: "idle", error: describeCloudError(error) }); }
  }

  /** A Microsoft refresh token (24 h) lets a reload continue without a popup. */
  private async restoreMicrosoft(link: CloudLink, config: CloudConfig): Promise<void> {
    const stored = await loadMicrosoftSession();
    if (!stored || stored.accountId !== link.accountId || !config.microsoftClientId) return;
    try {
      const tokens = await refreshMicrosoft({ clientId: config.microsoftClientId, tenant: config.microsoftTenant }, stored.refreshToken);
      await saveMicrosoftSession(stored.accountId, stored.accountLabel, tokens.refreshToken ?? stored.refreshToken, stored.savedAt);
      this.session = microsoftSession(tokens, { accountId: stored.accountId, label: stored.accountLabel });
      this.set({ phase: "connected" }); this.publishSession();
      void this.enqueue(() => this.afterConnect());
    } catch { /* the author reconnects with a click */ }
  }

  private async ensureSession(): Promise<CloudSession> {
    const link = this.state.link;
    const session = this.session;
    if (session && session.expiresAt - MARGIN_MS > Date.now()) return session;
    if (link?.provider === "microsoft") {
      const stored = await loadMicrosoftSession();
      const { config } = this.state;
      if (stored && config.microsoftClientId) {
        const tokens = await refreshMicrosoft({ clientId: config.microsoftClientId, tenant: config.microsoftTenant }, stored.refreshToken);
        await saveMicrosoftSession(stored.accountId, stored.accountLabel, tokens.refreshToken ?? stored.refreshToken, stored.savedAt);
        this.session = microsoftSession(tokens, { accountId: stored.accountId, label: stored.accountLabel });
        this.publishSession();
        return this.session;
      }
    }
    throw new CloudError("auth", "Sessione cloud scaduta: riconnetti l'account.");
  }

  /** Must be called straight from a click: the sign-in window opens before any await. */
  connect(provider: CloudProvider): Promise<boolean> {
    const { config, link } = this.state;
    this.set({ phase: "connecting", error: "", message: "Accesso a " + CLOUD_PROVIDER_LABEL[provider] + " in corso…" });
    let attempt: Promise<{ session: CloudSession; googleToken?: string; refresh?: string }>;
    try {
      attempt = provider === "google"
        ? connectGoogle(config.googleClientId, { hint: link?.provider === "google" ? link.accountLabel : undefined })
          .then(result => ({ session: result.session, googleToken: result.accessToken }))
        : connectMicrosoft({ clientId: config.microsoftClientId, tenant: config.microsoftTenant },
          { loginHint: link?.provider === "microsoft" ? link.accountLabel : undefined })
          .then(result => ({ session: result.session, refresh: result.tokens.refreshToken }));
    } catch (error) { attempt = Promise.reject(error); }
    // The sign-in may fail before the queued job awaits it: mark it handled now.
    attempt.catch(() => undefined);
    return this.enqueue(async () => {
      let signedIn;
      try { signedIn = await attempt; }
      catch (error) {
        this.set({ phase: this.state.link ? "needs_reconnect" : "idle" });
        throw error;
      }
      const { session } = signedIn;
      let current = await getCloudLink();
      if (current && (current.provider !== session.provider || current.accountId !== session.accountId)) {
        await clearCloudLink(); await clearMicrosoftSession(); current = null;
        this.autoPushBlocked = false;
      }
      current ??= await createCloudLink(session.provider, session.accountId, session.accountLabel);
      if (current.accountLabel !== session.accountLabel)
        current = await updateCloudLink(link => ({ ...link, accountLabel: session.accountLabel })) ?? current;
      if (session.provider === "microsoft" && signedIn.refresh)
        await saveMicrosoftSession(session.accountId, session.accountLabel, signedIn.refresh);
      this.session = session; this.googleAccessToken = signedIn.googleToken ?? null;
      this.set({ link: current, phase: "connected", message: "Connesso come " + session.accountLabel + "." });
      this.publishSession();
      await this.afterConnect();
    }).then(() => this.state.phase === "connected");
  }

  private async afterConnect(): Promise<void> {
    const session = await this.ensureSession();
    // Sync the index first, so the summary below describes the cloud as it is NOW.
    let libraryError: unknown;
    try { await this.refreshLibrary(session, true); } catch (error) { libraryError = error; }
    this.set({ inspection: await inspectCloud(session), link: await getCloudLink() });
    if (libraryError) throw libraryError;
  }

  private async refreshLibrary(session: CloudSession, force = false): Promise<void> {
    const key = this.books.map(book => [book.id, book.updatedAt, book.status, book.remote?.lastSyncedCommit ?? ""].join(":")).join("|");
    if (!force && key === this.lastLibraryKey) return;
    const result = await syncLibrary(session, this.books);
    this.lastLibraryKey = key;
    this.set({ library: result.library, link: await getCloudLink() });
  }

  setBooks(books: BookProject[]): void { this.books = books; }

  /** Resolves when every queued job has finished, including the ones queued meanwhile. */
  async idle(): Promise<void> {
    let chain: Promise<unknown>;
    do { chain = this.chain; await chain; } while (chain !== this.chain);
  }

  inspect(): Promise<unknown> {
    return this.enqueue(async () => {
      const session = await this.ensureSession();
      this.set({ inspection: await inspectCloud(session), link: await getCloudLink() });
    }, "Controllo del cloud…");
  }

  /** First upload, or replacing an existing cloud profile, from this device. */
  pushProfile(request: PushRequest): Promise<unknown> {
    return this.enqueue(async () => {
      const session = await this.ensureSession();
      const outcome = await pushProfile(session, request);
      if (outcome.status === "passphrase_required") {
        this.set({ needsPassphrase: true, error: "Inserisci la passphrase del vault cloud per inviare le credenziali." });
        return;
      }
      if (outcome.status === "conflict") {
        this.set({ conflict: { remoteRevision: outcome.remoteRevision, remoteDevice: outcome.remoteDevice,
          remoteUpdatedAt: outcome.remoteUpdatedAt }, message: "" });
        return;
      }
      this.autoPushBlocked = false;
      this.set({ conflict: null, needsPassphrase: false, message: "Impostazioni e credenziali inviate al cloud (revisione " + outcome.revision + ")." });
      await this.afterConnect();
    }, "Invio delle impostazioni al cloud…");
  }

  /** Replaces this device's synchronised settings with the cloud profile. */
  applyCloudProfile(access: VaultAccess = {}): Promise<unknown> {
    return this.enqueue(async () => {
      const session = await this.ensureSession();
      const outcome = await pullProfile(session, access);
      if (outcome.status === "none") { this.set({ message: "Nel cloud non c'è ancora nessun profilo." }); return; }
      this.autoPushBlocked = false;
      this.set({ conflict: null, needsPassphrase: false, message:
        `Impostazioni applicate dal cloud (revisione ${outcome.revision}, da «${outcome.deviceName}»)` +
        (outcome.githubToken ? ", PAT GitHub incluso" : "") +
        (outcome.apiKeys ? `, ${outcome.apiKeys} chiavi API incluse` : "") + "." });
      await this.onSettingsApplied?.();
      await this.afterConnect();
    }, "Lettura del profilo dal cloud…");
  }

  syncLibraryNow(): Promise<unknown> {
    return this.enqueue(async () => {
      await this.refreshLibrary(await this.ensureSession(), true);
      this.set({ message: "Libreria cloud aggiornata." });
    }, "Aggiornamento della libreria cloud…");
  }

  /** Only for an unreadable index file: delete it and rebuild it from the books of this device. */
  recreateLibrary(): Promise<unknown> {
    return this.enqueue(async () => {
      const session = await this.ensureSession();
      await session.store.remove(CLOUD_LIBRARY_FILE);
      this.lastLibraryKey = "";
      await this.afterConnect();
      this.set({ message: "Elenco libri cloud ricreato dai libri di questo dispositivo." });
    }, "Ricostruzione dell'elenco libri cloud…");
  }

  removeBook(bookId: string): Promise<unknown> {
    return this.enqueue(async () => {
      const library = await removeFromCloudLibrary(await this.ensureSession(), bookId);
      this.set({ library, message: "Libro rimosso dall'elenco cloud. I suoi dati su GitHub non sono toccati." });
    });
  }

  setAutoSync(enabled: boolean): Promise<unknown> {
    return this.enqueue(async () => { this.set({ link: await updateCloudLink(link => ({ ...link, autoSync: enabled })) }); });
  }
  renameDevice(name: string): Promise<unknown> {
    return this.enqueue(async () => { this.set({ device: await renameCloudDevice(name) }); });
  }
  saveConfig(values: Partial<CloudConfig>): Promise<unknown> {
    return this.enqueue(async () => {
      await saveCloudOverrides(values);
      this.set({ config: await loadCloudConfig(), message: "Impostazioni dell'accesso cloud salvate su questo dispositivo." });
    });
  }

  /** Local forget by default; `revoke` also withdraws Google's consent for this app. */
  disconnect(revoke = false): Promise<unknown> {
    return this.enqueue(async () => {
      const link = await getCloudLink();
      if (revoke && this.googleAccessToken) await revokeGoogle(this.googleAccessToken).catch(() => undefined);
      if (link) await forgetVaultKey(link.provider + ":" + link.accountId);
      await clearCloudLink(); await clearMicrosoftSession();
      this.session = null; this.googleAccessToken = null; this.autoPushBlocked = false; this.lastLibraryKey = "";
      this.set({ link: null, session: null, inspection: null, library: null, conflict: null,
        needsPassphrase: false, phase: "idle", message: "Dispositivo scollegato dal cloud. Impostazioni e libri locali non sono stati toccati." });
    });
  }

  /** Called every few seconds while the page is open. Does nothing unless the sign-in is still valid. */
  tick(): void {
    const { link, phase, conflict } = this.state;
    if (phase !== "connected" || !link?.autoSync || this.pending > 0 || !this.session) return;
    if (this.session.expiresAt - MARGIN_MS <= Date.now() && link.provider === "google") {
      // Google gives no refresh token to a page without a server: one click renews it.
      this.dropSession();
      this.set({ message: "La sessione Google è scaduta (dura circa un'ora): premi «Riconnetti» per riprendere la sincronizzazione." });
      return;
    }
    void this.enqueue(async () => {
      const session = await this.ensureSession();
      const current = await getCloudLink();
      if (current?.dirtyProfile && !this.autoPushBlocked && !conflict) {
        const outcome = await pushProfile(session, { protection: current.vaultMode ?? "passphrase" });
        if (outcome.status === "pushed")
          this.set({ link: await getCloudLink(), message: "Impostazioni inviate al cloud (revisione " + outcome.revision + ")." });
        else {
          this.autoPushBlocked = true; // wait for an explicit choice instead of retrying every tick
          this.set(outcome.status === "conflict"
            ? { conflict: { remoteRevision: outcome.remoteRevision, remoteDevice: outcome.remoteDevice, remoteUpdatedAt: outcome.remoteUpdatedAt } }
            : { needsPassphrase: true, error: "Le impostazioni hanno modifiche da inviare: inserisci la passphrase del vault." });
        }
      }
      await this.refreshLibrary(session);
    }, "", true);
  }
}
