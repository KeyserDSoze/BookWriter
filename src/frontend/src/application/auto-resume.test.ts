import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterruptedRun } from "../infrastructure/db";
import { AUTO_RESUME_WINDOW_MS, autoResumeEnabled, pageLoadKind, pickAutoResume, setAutoResumeEnabled } from "./auto-resume";

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const run = (bookId: string, minutesAgo: number): InterruptedRun =>
  ({ bookId, title: "Libro " + bookId, lastActivityAt: new Date(NOW - minutesAgo * 60_000).toISOString() });
const pick = (patch: Partial<Parameters<typeof pickAutoResume>[0]> = {}) =>
  pickAutoResume({ enabled: true, loadKind: "reload", runs: [run("a", 2)], now: NOW, ...patch });
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Ripresa automatica dopo un ricaricamento", () => {
  it("riprende solo dopo un ricaricamento: un link, una scheda nuova o un tipo ignoto no", () => {
    expect(pick()?.bookId).toBe("a");
    for (const loadKind of ["navigate", "back_forward", "prerender", "unknown", ""]) expect(pick({ loadKind })).toBeUndefined();
  });
  it("rispetta l'interruttore del dispositivo", () => {
    expect(pick({ enabled: false })).toBeUndefined();
    expect(autoResumeEnabled()).toBe(true); // default: on
    setAutoResumeEnabled(false);
    expect(autoResumeEnabled()).toBe(false);
    setAutoResumeEnabled(true);
    expect(autoResumeEnabled()).toBe(true);
  });
  it("non riprende un lavoro lasciato da troppo tempo, né uno con data impossibile", () => {
    expect(pick({ runs: [run("a", AUTO_RESUME_WINDOW_MS / 60_000 - 1)] })?.bookId).toBe("a");
    expect(pick({ runs: [run("a", AUTO_RESUME_WINDOW_MS / 60_000 + 1)] })).toBeUndefined();
    expect(pick({ runs: [run("a", -3)] })?.bookId).toBe("a"); // small clock skew is tolerated
    expect(pick({ runs: [run("a", -30)] })).toBeUndefined();
    expect(pick({ runs: [{ bookId: "a", title: "x", lastActivityAt: "non una data" }] })).toBeUndefined();
  });
  it("sceglie un solo libro, il più recente fra quelli recenti", () => {
    expect(pick({ runs: [run("vecchio", 12), run("recente", 1), run("scaduto", 40)] })?.bookId).toBe("recente");
    expect(pick({ runs: [] })).toBeUndefined();
  });
  it("legge dal browser come è stata caricata la pagina, senza mai lanciare", () => {
    vi.stubGlobal("performance", { getEntriesByType: () => [{ type: "reload" }] });
    expect(pageLoadKind()).toBe("reload");
    vi.stubGlobal("performance", { getEntriesByType: () => [] });
    expect(pageLoadKind()).toBe("unknown");
    vi.stubGlobal("performance", { getEntriesByType: () => { throw new Error("non supportato"); } });
    expect(pageLoadKind()).toBe("unknown");
  });
});
