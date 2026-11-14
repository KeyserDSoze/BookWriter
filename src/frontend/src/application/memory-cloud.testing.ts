import type { CloudFileName } from "../domain/cloud-profile";
import { CloudError, type CloudProvider, type CloudSession, type CloudStore } from "../infrastructure/cloud/types";

/** In-memory cloud account with the same version/conflict rules as the real stores. Tests only. */
export function memoryCloud(provider: CloudProvider = "google", accountId = "acc-1") {
  const files = new Map<CloudFileName, { text: string; version: number }>();
  const hooks: { beforeWrite?: (name: CloudFileName) => void } = {};
  const stats = { reads: 0, writes: 0, active: 0, maxActive: 0 };
  const enter = async () => {
    stats.maxActive = Math.max(stats.maxActive, ++stats.active);
    await Promise.resolve();
  };
  const store: CloudStore = {
    provider,
    async read(name) {
      await enter(); stats.reads++; stats.active--;
      const file = files.get(name);
      return file ? { text: file.text, version: String(file.version) } : null;
    },
    async write(name, text, expected) {
      await enter();
      try {
        hooks.beforeWrite?.(name);
        const current = files.get(name);
        if ((expected === null && current) || (expected !== null && String(current?.version) !== expected))
          throw new CloudError("conflict", "conflitto");
        const next = { text, version: (current?.version ?? 0) + 1 };
        files.set(name, next); stats.writes++;
        return { version: String(next.version) };
      } finally { stats.active--; }
    },
    async remove(name) { files.delete(name); },
  };
  const session: CloudSession = {
    provider, accountId, accountLabel: "autore@example.com", expiresAt: Date.now() + 3_600_000, store,
  };
  return { files, hooks, store, session, stats, reads: () => stats.reads };
}
