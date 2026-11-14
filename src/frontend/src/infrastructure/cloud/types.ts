import type { CloudFileName } from "../../domain/cloud-profile";

export type CloudProvider = "google" | "microsoft";
export const CLOUD_PROVIDER_LABEL: Record<CloudProvider, string> = {
  google: "Google Drive", microsoft: "Microsoft OneDrive",
};

export type CloudErrorKind =
  "auth" | "forbidden" | "notfound" | "conflict" | "rate" | "server" | "network" | "invalid" | "config" | "cancelled";

/** Messages are fixed Italian sentences: never a response body, URL, token or header. */
export class CloudError extends Error {
  constructor(readonly kind: CloudErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "CloudError";
  }
}

export interface CloudFileRead { text: string; version: string }

/** App-private storage of one cloud account. Only the two profile files exist in it. */
export interface CloudStore {
  readonly provider: CloudProvider;
  read(name: CloudFileName, signal?: AbortSignal): Promise<CloudFileRead | null>;
  /** `expectedVersion` null = the file must not exist yet. A mismatch is a "conflict" error. */
  write(name: CloudFileName, text: string, expectedVersion: string | null, signal?: AbortSignal): Promise<{ version: string }>;
  remove(name: CloudFileName, signal?: AbortSignal): Promise<void>;
}

export interface CloudSession {
  provider: CloudProvider;
  /** Stable account id (never shown as a secret) and the human label (email or name). */
  accountId: string;
  accountLabel: string;
  /** Epoch milliseconds at which the access token stops working. Tokens stay in memory only. */
  expiresAt: number;
  store: CloudStore;
}
