import type { AppSettings, EncryptedSecret } from "../domain/types";
import { chatOutputTokenParameter, endpointAuthMode, normalizeEndpoint } from "../infrastructure/ai";
import { chatHeaderTimeoutSeconds } from "../infrastructure/ai-header-timeout";
import { chatReasoningEffort, chatStreamMode } from "../infrastructure/ai-stream";
import { assertModelCapabilitySettings } from "../domain/model-capabilities";
import { validateTaskReasoningOverrides } from "../domain/task-reasoning";

export interface EndpointSettingsSnapshot {
  settings: AppSettings;
  keyDrafts: Record<string, string>;
}

export class StaleEndpointSettingsSave extends Error {
  readonly superseded: boolean;
  constructor(superseded: boolean) {
    super(superseded
      ? "Salvataggio precedente superato da una richiesta più recente."
      : "Impostazioni cambiate durante la cifratura o il salvataggio: modifica non salvata. Controlla i campi e premi di nuovo Salva impostazioni.");
    this.name = "StaleEndpointSettingsSave";
    this.superseded = superseded;
  }
}

/** Intra-tab optimistic fencing for explicit endpoint-settings Save.
 * React state is replaced immutably; compare exact object identity and
 * draft identity instead of persisting any plaintext-key fingerprint.
 * Persistence must recheck after opening IndexedDB, just before its write. */
export class EndpointSettingsSaveCoordinator {
  private latest = 0;

  async save(
    snapshot: EndpointSettingsSnapshot,
    readCurrent: () => EndpointSettingsSnapshot,
    encrypt: (value: string) => Promise<EncryptedSecret>,
    persist: (next: AppSettings, isCurrent: () => boolean) => Promise<void>,
    onSaved: (next: AppSettings) => void,
  ): Promise<void> {
    const attempt = ++this.latest;
    const isCurrent = () => {
      const current = readCurrent();
      return attempt === this.latest &&
        current.settings === snapshot.settings &&
        current.keyDrafts === snapshot.keyDrafts;
    };
    const assertCurrent = () => {
      if (!isCurrent()) throw new StaleEndpointSettingsSave(attempt !== this.latest);
    };
    try {
      // Validate all declared model tags and defaults before encryption/IndexedDB.
      assertModelCapabilitySettings(snapshot.settings);
      validateTaskReasoningOverrides(snapshot.settings.taskReasoningEfforts);
      // Validate all endpoint profiles before starting any encryption.
      const verified = snapshot.settings.endpoints.map(profile => {
        const baseUrl = normalizeEndpoint(profile.baseUrl);
        chatHeaderTimeoutSeconds(profile.headerTimeoutSeconds);
        chatOutputTokenParameter(profile.outputTokenParameter);
        chatReasoningEffort(profile.reasoningEffort);
        chatStreamMode(profile.streamMode);
        const authMode = endpointAuthMode(profile.authMode, baseUrl);
        return { profile, baseUrl, authMode };
      });
      const endpoints = await Promise.all(verified.map(async ({ profile, baseUrl, authMode }) => {
        const draft = snapshot.keyDrafts[profile.id];
        return {
          ...profile, baseUrl,
          secret: authMode === "none" ? null : draft ? await encrypt(draft) : profile.secret,
        };
      }));
      assertCurrent();
      const next = { ...snapshot.settings, endpoints };
      await persist(next, isCurrent);
      // Edits during the IDB write are still unsaved: do not lose new drafts.
      assertCurrent();
      // No await between this last check and the React/ref updates.
      onSaved(next);
    } catch (error) {
      if (!isCurrent()) throw new StaleEndpointSettingsSave(attempt !== this.latest);
      throw error;
    }
  }
}
