/// <reference types="vite/client" />
import { useCallback, useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isStandaloneDisplay(): boolean {
  return typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
}

/** Offline shell: production only, and never in the dev server where it would serve stale modules. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => { /* the app works without it */ });
  });
}

/** Ask the browser not to evict the local IndexedDB archive; only for installed apps,
 * where Chromium grants it without a prompt (Firefox would show one). */
export function requestPersistentStorage(): void {
  if (!isStandaloneDisplay() || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => { /* best effort */ });
}

/** Exposes the browser's install prompt (Chromium/Android); iOS has no such event. */
export function usePwaInstall(): { canInstall: boolean; install: () => Promise<void> } {
  const [event, setEvent] = useState<InstallPromptEvent | undefined>();
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallPromptEvent); };
    const onInstalled = () => setEvent(undefined);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => undefined);
    setEvent(undefined);
  }, [event]);
  return { canInstall: event !== undefined, install };
}
