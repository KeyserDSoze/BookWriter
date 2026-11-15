/** Small per-device interface preferences (collapsed menu, open sections): never book data, never synced. */
const PREFIX = "bookwriter.ui.";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function writePref(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode: the choice just isn't remembered */ }
}
