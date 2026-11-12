import { useEffect } from "react";

/** Keeps the screen (and the machine) awake while the autopilot runs in this tab.
 * Best effort: browsers release the lock when the tab is hidden, so it is
 * requested again as soon as the tab is visible. Does nothing where unsupported. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | undefined;
    let stopped = false;
    const acquire = async () => {
      if (stopped || sentinel || document.visibilityState !== "visible") return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (stopped) { void lock.release().catch(() => {}); return; }
        sentinel = lock;
        lock.addEventListener("release", () => { if (sentinel === lock) sentinel = undefined; });
      } catch { /* denied: battery saver or not allowed; the run continues regardless */ }
    };
    const onVisibility = () => { void acquire(); };
    document.addEventListener("visibilitychange", onVisibility);
    void acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const held = sentinel;
      sentinel = undefined;
      if (held) void held.release().catch(() => {});
    };
  }, [active]);
}
