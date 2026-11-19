import { z } from "zod";
import type { ServerConnection } from "@engine/domain/personal-server";
import { parseServerSentEvents } from "../infrastructure/personal-server-events";
import {
  openServerEventStream, personalServerConnection, syncChangedServerBooks, syncServerBook, SERVER_CONNECTION_EVENT,
} from "../infrastructure/personal-server-client";
import { readPref, writePref } from "./ui-prefs";

export const REPLICA_AUTO_UPDATE_PREF = "serverAutoUpdate";
const IDLE_MS = 15_000;
const FLUSH_MS = 1_500;
const MIN_BOOK_INTERVAL_MS = 3_000;
const MAX_BACKOFF_MS = 30_000;

export interface ReplicaFeedStatus {
  state: "off" | "connecting" | "live" | "retrying";
  message: string;
  lastSyncAt?: string;
}
export interface ReplicaFeedDeps {
  connection: () => Promise<ServerConnection | undefined>;
  open: (connection: ServerConnection, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  syncBook: (connection: ServerConnection, bookId: string) => Promise<unknown>;
  syncChanged: () => Promise<{ synced: string[]; failed: number }>;
  enabled: () => boolean;
  now: () => number;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  idleMs: number; flushMs: number; minBookIntervalMs: number;
}
const realWait = (ms: number, signal: AbortSignal) => new Promise<void>(done => {
  if (signal.aborted) { done(); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); done(); }, ms);
  const stop = () => { clearTimeout(timer); done(); };
  signal.addEventListener("abort", stop, { once: true });
});
export const defaultReplicaFeedDeps: ReplicaFeedDeps = {
  connection: personalServerConnection, open: openServerEventStream, syncBook: syncServerBook,
  syncChanged: syncChangedServerBooks, enabled: () => readPref(REPLICA_AUTO_UPDATE_PREF, true),
  now: Date.now, wait: realWait, idleMs: IDLE_MS, flushMs: FLUSH_MS, minBookIntervalMs: MIN_BOOK_INTERVAL_MS,
};

const eventSchema = z.union([
  z.object({ all: z.literal(true) }).passthrough(),
  z.object({ bookId: z.string().uuid() }).passthrough(),
]);

/**
 * Keeps local replicas current while a server connection exists. It only READS:
 * snapshots go through the same fenced, atomic replica transaction as the manual
 * button, never create a runner, command or outbox, and a failed or stale answer
 * leaves the previous replica untouched. One stream per page; the server caps streams.
 */
export class ReplicaFeed {
  private listeners = new Set<() => void>();
  private status: ReplicaFeedStatus = { state: "off", message: "Aggiornamento automatico spento." };
  private running?: AbortController;
  private loop?: Promise<void>;
  private pending = new Set<string>();
  private lastSynced = new Map<string, number>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  private flushing = false;
  private generation = 0;
  constructor(private readonly deps: ReplicaFeedDeps = defaultReplicaFeedDeps) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.status;
  onSynced: () => void | Promise<void> = () => undefined;
  private set(next: Partial<ReplicaFeedStatus>) {
    this.status = { ...this.status, ...next };
    for (const listener of [...this.listeners]) listener();
  }
  /** Idempotent: restarts when the connection or the preference changed. */
  async start(): Promise<void> {
    const ticket = ++this.generation;
    this.halt();
    const connection = await this.deps.connection().catch(() => undefined);
    if (ticket !== this.generation) return;
    if (!connection) { this.set({ state: "off", message: "Nessun server collegato." }); return; }
    if (!this.deps.enabled()) { this.set({ state: "off", message: "Aggiornamento automatico spento su questo dispositivo." }); return; }
    const controller = new AbortController();
    this.running = controller;
    this.loop = this.run(connection, controller.signal);
    void this.loop;
  }
  stop(): void { this.generation++; this.halt(); this.set({ state: "off", message: "Aggiornamento automatico fermato." }); }
  /** Test and shutdown helper: resolves when the current loop has ended. */
  async idle(): Promise<void> { await this.loop; }
  private halt(): void {
    this.running?.abort(); this.running = undefined;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined; this.pending.clear();
  }
  private async run(connection: ServerConnection, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      const stream = new AbortController();
      const stopStream = () => stream.abort();
      signal.addEventListener("abort", stopStream, { once: true });
      let idle: ReturnType<typeof setTimeout> | undefined;
      const resetIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => stream.abort(), this.deps.idleMs); };
      try {
        this.set({ state: "connecting", message: "Connessione al server…" });
        resetIdle();
        const body = await this.deps.open(connection, stream.signal);
        for await (const event of parseServerSentEvents(body, resetIdle)) {
          if (signal.aborted) break;
          if (attempt) attempt = 0;
          this.handle(connection, event.event, event.data);
        }
        if (!signal.aborted) throw new Error("Flusso chiuso dal server.");
      } catch (error) {
        if (signal.aborted) break;
        const message = error instanceof Error && error.message ? error.message : "Flusso non disponibile.";
        this.set({ state: "retrying", message: `${message} Nuovo tentativo automatico: nessun comando viene ripetuto.` });
      } finally {
        if (idle) clearTimeout(idle);
        signal.removeEventListener("abort", stopStream);
        stream.abort();
      }
      if (signal.aborted) break;
      await this.deps.wait(Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.min(attempt, 5)), signal);
      attempt++;
    }
  }
  private handle(connection: ServerConnection, name: string, data: unknown): void {
    if (name === "heartbeat") { if (this.status.state !== "live") this.set({ state: "live", message: "Aggiornamento automatico attivo." }); return; }
    if (name !== "snapshot-required") return;
    const parsed = eventSchema.safeParse(data);
    if (!parsed.success) return;
    this.set({ state: "live", message: "Aggiornamento automatico attivo." });
    if ("all" in parsed.data) { void this.catchUp(); return; }
    this.pending.add(parsed.data.bookId);
    this.arm(connection);
  }
  private arm(connection: ServerConnection, delay = this.deps.flushMs): void {
    if (this.flushTimer || !this.running) return;
    const owner = this.running;
    this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush(connection, owner); }, delay);
  }
  private async catchUp(): Promise<void> {
    const owner = this.running;
    try {
      const result = await this.deps.syncChanged();
      if (owner !== this.running) return;
      if (result.synced.length) { this.touch(); await this.onSynced(); }
      if (result.failed) this.set({ message: `${result.failed} libri non aggiornati: replica precedente conservata.` });
    } catch (error) {
      if (owner === this.running) this.set({ message: error instanceof Error ? error.message : "Aggiornamento non riuscito." });
    }
  }
  private touch() { this.set({ lastSyncAt: new Date(this.deps.now()).toISOString() }); }
  private async flush(connection: ServerConnection, owner: AbortController): Promise<void> {
    if (this.flushing) { this.arm(connection); return; }
    this.flushing = true;
    try {
      let changed = false;
      let deferred = 0;
      for (const bookId of [...this.pending]) {
        if (owner !== this.running) return;
        const wait = (this.lastSynced.get(bookId) ?? 0) + this.deps.minBookIntervalMs - this.deps.now();
        if (wait > 0) { deferred = Math.max(deferred, wait); continue; }
        this.pending.delete(bookId);
        this.lastSynced.set(bookId, this.deps.now());
        try { await this.deps.syncBook(connection, bookId); changed = true; }
        catch (error) { this.set({ message: `Libro non aggiornato: ${error instanceof Error ? error.message : "errore"} Replica precedente conservata.` }); }
      }
      if (changed && owner === this.running) { this.touch(); await this.onSynced(); }
      if (deferred && owner === this.running) this.arm(connection, deferred);
    } finally { this.flushing = false; }
  }
}

export const replicaFeed = new ReplicaFeed();
export function setReplicaAutoUpdate(enabled: boolean): void {
  writePref(REPLICA_AUTO_UPDATE_PREF, enabled);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_CONNECTION_EVENT));
}
