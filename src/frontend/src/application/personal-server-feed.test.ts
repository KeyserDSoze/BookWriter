import { describe, expect, it, vi } from "vitest";
import { ReplicaFeed, type ReplicaFeedDeps } from "./personal-server-feed";
import type { ServerConnection } from "@engine/domain/personal-server";

const enc = new TextEncoder();
const connection = { id: crypto.randomUUID(), serverId: crypto.randomUUID() } as unknown as ServerConnection;
const A = crypto.randomUUID(), B = crypto.randomUUID();
const until = async (condition: () => boolean, label = "condizione") => {
  for (let i = 0; i < 400; i++) { if (condition()) return; await new Promise(done => setTimeout(done, 5)); }
  throw new Error("Timeout: " + label);
};

function harness(overrides: Partial<ReplicaFeedDeps> = {}) {
  const channels: Array<{ push: (text: string) => void; end: () => void; signal: AbortSignal }> = [];
  const synced: string[] = [];
  const caughtUp: number[] = [];
  let clock = 1_000_000;
  const deps: ReplicaFeedDeps = {
    connection: async () => connection,
    open: async (_connection, signal) => {
      let control!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start(c) { control = c; } });
      signal.addEventListener("abort", () => { try { control.error(new Error("abortito")); } catch { /* closed */ } }, { once: true });
      channels.push({ signal, push: text => control.enqueue(enc.encode(text)), end: () => control.close() });
      return stream;
    },
    syncBook: async (_c, bookId) => { synced.push(bookId); },
    syncChanged: async () => { caughtUp.push(1); return { synced: [A], failed: 0 }; },
    enabled: () => true, now: () => clock, wait: async () => undefined,
    idleMs: 10_000, flushMs: 5, minBookIntervalMs: 50, ...overrides,
  };
  const feed = new ReplicaFeed(deps);
  const refreshed = vi.fn();
  feed.onSynced = refreshed;
  return { feed, channels, synced, caughtUp, refreshed, advance: (ms: number) => { clock += ms; } };
}
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

describe("Aggiornamento automatico delle repliche", () => {
  it("alla connessione recupera solo i libri cambiati e aggiorna l'interfaccia", async () => {
    const h = harness();
    await h.feed.start(); await until(() => h.channels.length === 1);
    h.channels[0]!.push(event("snapshot-required", { all: true }));
    await until(() => h.refreshed.mock.calls.length === 1);
    expect(h.caughtUp).toHaveLength(1); expect(h.synced).toEqual([]);
    expect(h.feed.getSnapshot().state).toBe("live");
    expect(h.feed.getSnapshot().lastSyncAt).toBeDefined();
    h.feed.stop(); await h.feed.idle();
  });
  it("raggruppa gli eventi dello stesso libro e rispetta l'intervallo minimo", async () => {
    const h = harness();
    await h.feed.start(); await until(() => h.channels.length === 1);
    for (let i = 0; i < 5; i++) h.channels[0]!.push(event("snapshot-required", { bookId: A }));
    await until(() => h.synced.length === 1);
    expect(h.synced).toEqual([A]);
    h.channels[0]!.push(event("snapshot-required", { bookId: A }));
    await new Promise(done => setTimeout(done, 30));
    expect(h.synced).toEqual([A]);
    h.advance(60);
    await until(() => h.synced.length === 2, "seconda sincronizzazione dopo l'intervallo");
    h.feed.stop(); await h.feed.idle();
  });
  it("un libro che fallisce non ferma gli altri e conserva il messaggio senza perdere lo stream", async () => {
    const h = harness({ syncBook: async (_c, id) => { if (id === A) throw new Error("Snapshot non coerente."); } });
    await h.feed.start(); await until(() => h.channels.length === 1);
    h.channels[0]!.push(event("snapshot-required", { bookId: A }) + event("snapshot-required", { bookId: B }));
    await until(() => h.refreshed.mock.calls.length === 1);
    expect(h.feed.getSnapshot().message).toContain("Replica precedente conservata");
    expect(h.feed.getSnapshot().state).toBe("live");
    h.feed.stop(); await h.feed.idle();
  });
  it("stream chiuso o corrotto: riconnette con attesa progressiva, senza duplicare i loop", async () => {
    const waits: number[] = [];
    const h = harness({ wait: async ms => { waits.push(ms); } });
    await h.feed.start(); await until(() => h.channels.length === 1);
    h.channels[0]!.end();
    await until(() => h.channels.length === 2, "seconda connessione");
    h.channels[1]!.push("event: x\ndata: {rotto\n\n");
    await until(() => h.channels.length === 3, "terza connessione");
    expect(waits.slice(0, 2)).toEqual([2000, 4000]);
    expect(h.feed.getSnapshot().state).not.toBe("off");
    h.channels[2]!.push(event("heartbeat", { at: "x" }));
    await until(() => h.feed.getSnapshot().state === "live");
    h.feed.stop(); await h.feed.idle();
    const opened = h.channels.length;
    await new Promise(done => setTimeout(done, 30));
    expect(h.channels.length).toBe(opened);
  });
  it("il watchdog interrompe un flusso silenzioso e riapre; un heartbeat lo mantiene vivo", async () => {
    const h = harness({ idleMs: 40 });
    await h.feed.start(); await until(() => h.channels.length === 1);
    const keepAlive = setInterval(() => { try { h.channels[0]!.push(event("heartbeat", {})); } catch { /* aborted */ } }, 10);
    await new Promise(done => setTimeout(done, 120));
    expect(h.channels).toHaveLength(1);
    clearInterval(keepAlive);
    await until(() => h.channels.length === 2, "riapertura dopo silenzio");
    expect(h.channels[0]!.signal.aborted).toBe(true);
    h.feed.stop(); await h.feed.idle();
  });
  it("preferenza spenta o nessun server: nessuna connessione e nessuna richiesta", async () => {
    const open = vi.fn();
    const off = harness({ enabled: () => false, open });
    await off.feed.start(); expect(off.feed.getSnapshot().state).toBe("off"); expect(open).not.toHaveBeenCalled();
    const none = harness({ connection: async () => undefined, open });
    await none.feed.start(); expect(none.feed.getSnapshot().message).toContain("Nessun server"); expect(open).not.toHaveBeenCalled();
  });
  it("stop e riavvio scartano gli aggiornamenti in attesa: nessuna sincronizzazione dopo l'arresto", async () => {
    const h = harness({ flushMs: 40 });
    await h.feed.start(); await until(() => h.channels.length === 1);
    h.channels[0]!.push(event("snapshot-required", { bookId: A }));
    await new Promise(done => setTimeout(done, 5));
    h.feed.stop();
    await new Promise(done => setTimeout(done, 80));
    expect(h.synced).toEqual([]); expect(h.channels[0]!.signal.aborted).toBe(true);
    await h.feed.idle();
  });
  it("un secondo start sostituisce il primo flusso invece di aprirne due attivi", async () => {
    const h = harness();
    await h.feed.start(); await until(() => h.channels.length === 1);
    await h.feed.start(); await until(() => h.channels.length === 2);
    expect(h.channels[0]!.signal.aborted).toBe(true);
    expect(h.channels[1]!.signal.aborted).toBe(false);
    h.feed.stop(); await h.feed.idle();
  });
  it("eventi non riconosciuti o malformati vengono ignorati", async () => {
    const h = harness();
    await h.feed.start(); await until(() => h.channels.length === 1);
    h.channels[0]!.push(event("snapshot-required", { bookId: "non-un-uuid" }) + event("live", { bookId: A, textTail: "x" }) + event("sconosciuto", {}));
    await new Promise(done => setTimeout(done, 30));
    expect(h.synced).toEqual([]); expect(h.caughtUp).toEqual([]);
    h.feed.stop(); await h.feed.idle();
  });
});
