import { createHash, randomUUID } from "node:crypto";
import {
  AutopilotRunner, newBook, enqueueCheckpoint, withExclusiveLock,
  retryIsDue, serverCommandEnvelopeSchema, serverCommandDigestInput, currentStamp, bookEditing, forceCloseCycle,
  drainGitHubOutbox, saveToGitHubNow, pushManualGitHubBook,
  validateRemote, inspectRepository, inspectGitHubDestination, githubPublicationBlocker,
  type HostRuntime, type HostBookRecord, type BookProject, type Activity, type ServerCommandEnvelope,
  type ServerBookCreationInput,
} from "@engine/index";
import { FileBookStore } from "./files";
import type { Client } from "./auth";
import { ApiError } from "./errors";
import { HandoffService, isOriginReceipt } from "./handoff";

const BUSY_LOCK = "Un'altra operazione sta usando il blocco: riprova più tardi.";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scopeFor = (type: string) => ["start", "pause", "stop_after_task", "cancel_retry", "retry_now"].includes(type) ? "run" : "write";
export function bookEtag(record: HostBookRecord): string {
  return `"${record.book.executionAuthority?.epoch}:${record.revision}"`;
}
function creationId(serverId: string, commandId: string): string {
  const hex = digest(["bookwriter:create:v1", serverId, commandId]).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** One controller uses exactly the existing runner. File commits stay short;
 * an author edit can commit while the model is waiting for the network. */
export class Controller {
  private runners = new Map<string, { runner: AutopilotRunner; promise: Promise<void> }>();
  private operations = new Set<Promise<unknown>>();
  private effects = new Set<Promise<unknown>>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private shuttingDown = false;
  private configuring = false;
  private readonly handoffs: HandoffService;
  constructor(readonly store: FileBookStore, readonly runtime: HostRuntime, readonly serverId: string,
    private readonly isCurrent: (client: Client) => boolean = () => true) {
    this.handoffs = new HandoffService(store, serverId, isCurrent);
  }
  adopt(client: Client, body: { handoffId: string; epoch: string; book: unknown; activities: unknown }) {
    return this.track(this.handoffs.adopt(client, body, () => this.accepting()));
  }
  cancelHandoff(client: Client, handoffId: string, bookId: string) {
    return this.track(this.handoffs.cancel(client, handoffId, bookId, () => this.accepting()));
  }
  get busy(): boolean { return this.runners.size > 0 || this.effects.size > 0; }
  private track<T>(promise: Promise<T>, set = this.operations): Promise<T> {
    set.add(promise);
    void promise.then(() => set.delete(promise), () => set.delete(promise));
    return promise;
  }
  private accepting(): void {
    if (this.shuttingDown || this.configuring)
      throw new ApiError(503, "maintenance", "Il server si sta fermando o sta aggiornando la configurazione: nessun nuovo comando accettato.");
  }
  /** Serialises configuration with run admission, not with an entire model call. */
  configure<T>(action: () => Promise<T>): Promise<T> {
    return this.track(this.store.serial("$run-admission", async () => {
      this.accepting();
      if (this.busy) throw new ApiError(409, "running", "Attendi la pausa dei libri e la fine delle operazioni prima di cambiare la configurazione.");
      this.configuring = true;
      try { return await withExclusiveLock("bookwriter:github-outbox", { busy: BUSY_LOCK }, action); }
      finally { this.configuring = false; }
    }));
  }
  private owns(record: HostBookRecord): void {
    if (record.book.executionAuthority?.serverId !== this.serverId)
      throw new ApiError(409, "authority", "L'autorità di questo libro non appartiene al server.");
  }
  async recover(): Promise<void> {
    for (const id of await this.store.ids()) await this.store.transaction(id, record => {
      this.owns(record);
      let interrupted = false;
      for (const activity of record.activities) if (activity.status === "running") {
        activity.status = "cancelled"; activity.endedAt = new Date().toISOString();
        activity.error = "Server interrotto: esito della chiamata non confermato. Nessun replay automatico.";
        interrupted = true;
      }
      if (record.book.status === "running" || interrupted) {
        record.book.status = "paused";
        record.book.previousError = "Server riavviato: verifica i tentativi dall'esito incerto prima di riprendere.";
      }
      if (record.runAuthorization && record.runAuthorization.state !== "stopped") record.runAuthorization.state = "uncertain";
      for (const receipt of Object.values(record.commands)) if (receipt.state === "accepted") receipt.state = "uncertain";
      if (record.retrySchedule && (record.retrySchedule.state === "claimed" || interrupted)) {
        delete record.retrySchedule;
        record.book.previousError = "Ripartenza long-term interrotta: controlla l'attività prima di riprendere. Nessuna nuova richiesta automatica.";
      }
    });
  }
  startScheduler(): void {
    this.timer = setInterval(() => { void this.tick(); }, 5000);
  }
  private tick(): Promise<void> {
    if (this.ticking || this.shuttingDown || this.configuring) return this.ticking ?? Promise.resolve();
    const cycle = this.scheduledWork();
    this.ticking = cycle;
    void cycle.then(() => { if (this.ticking === cycle) this.ticking = undefined; });
    return cycle;
  }
  private async scheduledWork(): Promise<void> {
    try {
      for (const id of await this.store.ids()) {
        if (this.shuttingDown || this.configuring) break;
        await this.store.serial("$commands:" + id, () => this.store.serial("$run-admission", async () => {
          if (this.shuttingDown || this.configuring || this.runners.size >= 2 || this.runners.has(id)) return;
          const record = await this.store.read(id);
          if (record?.retrySchedule && retryIsDue(record.retrySchedule, Date.now()))
            this.launch(id, { generation: record.retrySchedule.generation, runId: record.retrySchedule.runId });
        }));
      }
      if (!this.shuttingDown && !this.configuring) await drainGitHubOutbox();
    } catch { /* Visible in persisted run/outbox state, never log provider bodies or books. */ }
  }
  private launch(id: string, options: { generation?: string; force?: boolean; runId?: string }): void {
    if (this.shuttingDown || this.runners.has(id) || this.runners.size >= 2)
      throw new ApiError(409, "runner_busy", "Un'esecuzione è già attiva o il limite di concorrenza è raggiunto.");
    const runner = new AutopilotRunner();
    const entry = { runner, promise: Promise.resolve() };
    this.runners.set(id, entry);
    // run() installs its AbortController synchronously: pause must also work
    // while the guard is still checking ownership, before the first task.
    entry.promise = runner.run(id, async () => {
      if (!this.shuttingDown) void this.track(drainGitHubOutbox(), this.effects).catch(() => undefined);
    }, options).catch(() => undefined).then(async () => {
      await this.store.transaction(id, record => {
        if (record.runAuthorization && record.runAuthorization.runId === options.runId) record.runAuthorization.state = "stopped";
      }).catch(() => undefined);
      if (!this.shuttingDown) await this.runtime.withBookScope(id, () => saveToGitHubNow(id)).catch(() => undefined);
    }).finally(() => {
      if (this.runners.get(id) === entry) this.runners.delete(id);
    });
  }
  async create(client: Client, commandId: string, input: ServerBookCreationInput): Promise<string> {
    if (!client.scopes.includes("write")) throw new ApiError(403, "scope", "Permesso di scrittura richiesto.");
    const id = creationId(this.serverId, commandId);
    return this.track(this.store.serial("$create:" + id, async () => {
      this.accepting();
      const existing = await this.store.read(id);
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima dell'accettazione.");
      const fingerprint = digest({ clientId: client.id, input });
      if (existing) {
        if (existing.commands[commandId]?.digest !== fingerprint)
          throw new ApiError(409, "command_reused", "Identificativo già usato con un'altra richiesta.");
        return id;
      }
      const book = newBook(input.brief, input.title, input.writingStyle, input.audience);
      if (input.bookConfig) {
        const { aiBudget, ...editorial } = structuredClone(input.bookConfig);
        Object.assign(book, editorial);
        // The new book does not inherit the original book's metering period.
        if (aiBudget) book.aiBudget = { ...aiBudget, enabledAt: book.createdAt };
      }
      book.id = id; book.status = "paused";
      book.executionAuthority = { kind: "server", serverId: this.serverId, epoch: randomUUID() };
      await this.store.create({ version: 1, revision: 1, book, activities: [], watermarks: {},
        commands: { [commandId]: { digest: fingerprint, clientId: client.id, sequence: 1,
          state: "completed", result: { bookId: id } } } });
      return id;
    }));
  }
  command(id: string, client: Client, expected: string | undefined, raw: unknown) {
    const envelope = serverCommandEnvelopeSchema.parse(raw);
    if (!client.scopes.includes(scopeFor(envelope.command.type)))
      throw new ApiError(403, "scope", "Il token non ha il permesso per questo comando.");
    // Keep acceptance and local control in order. Remote I/O is still outside
    // this queue, so an author can edit a book while a model/push is in flight.
    return this.track(this.store.serial("$commands:" + id, () => {
      const accept = () => this.acceptCommand(id, client, expected, envelope);
      return envelope.command.type === "start" || envelope.command.type === "retry_now"
        ? this.store.serial("$run-admission", accept) : accept();
    }));
  }
  private async acceptCommand(id: string, client: Client, expected: string | undefined, envelope: ServerCommandEnvelope) {
    const fingerprint = createHash("sha256").update(serverCommandDigestInput(client.id, envelope)).digest("hex");
    let effect = false;
    const result = await this.store.transaction(id, async record => {
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima dell'accettazione.");
      this.owns(record);
      const previous = record.commands[envelope.commandId];
      if (previous) {
        if (previous.digest !== fingerprint || previous.clientId !== client.id)
          throw new ApiError(409, "command_reused", "Identificativo già usato con un'altra richiesta.");
        return previous;
      }
      this.accepting();
      if (expected !== bookEtag(record)) throw new ApiError(412, "revision", "Il libro è cambiato: ricarica lo stato e conserva la tua bozza.");
      const last = record.watermarks?.[client.id] ?? 0;
      if (envelope.sequence !== last + 1) throw new ApiError(409, "sequence", "Sequenza del comando non attuale: riconcilia lo stato.");
      const cmd = envelope.command;
      if (cmd.type === "start" && record.retrySchedule)
        throw new ApiError(409, "retry_pending", "Usa «Riprova ora» per conservare la sessione, oppure annulla prima l'attesa.");
      if (["start", "retry_now"].includes(cmd.type) &&
          (this.shuttingDown || this.runners.size >= 2 || this.runners.has(id) ||
            ["requested", "started"].includes(record.runAuthorization?.state ?? "")))
        throw new ApiError(409, "runner_busy", "Esecuzione già attiva o capacità del server raggiunta.");
      this.makeReceiptRoom(record);
      const receipt: HostBookRecord["commands"][string] = { digest: fingerprint, clientId: client.id,
        sequence: envelope.sequence, state: "completed", result: { accepted: true } };
      record.commands[envelope.commandId] = receipt;
      record.watermarks ??= {}; record.watermarks[client.id] = envelope.sequence;
      if (cmd.type === "start" || cmd.type === "retry_now") {
        if (cmd.type === "retry_now" && (record.retrySchedule?.generation !== cmd.generation || record.retrySchedule.state !== "waiting"))
          throw new ApiError(409, "retry", "Il retry non è più in attesa.");
        const runId = cmd.type === "retry_now" ? record.retrySchedule!.runId : randomUUID();
        record.runAuthorization = { commandId: envelope.commandId, runId, state: "requested" };
        receipt.result = { runId }; effect = true; receipt.state = "accepted";
      } else if (cmd.type === "pause" || cmd.type === "stop_after_task" || cmd.type === "save_github" || cmd.type === "connect_github") {
        if (cmd.type === "pause" || cmd.type === "stop_after_task") {
          delete record.retrySchedule;
          if (record.book.previousError?.startsWith("In attesa di retry long-term:")) delete record.book.previousError;
          if (record.runAuthorization && (cmd.type === "pause" || record.runAuthorization.state === "requested"))
            record.runAuthorization.state = "stopped";
        }
        if (cmd.type === "connect_github" && (record.book.status === "running" || record.book.remote))
          throw new ApiError(409, "remote", "Collegamento ammesso solo per un libro fermo senza destinazione GitHub.");
        effect = true; receipt.state = "accepted";
      } else if (cmd.type === "cancel_retry") {
        delete record.retrySchedule;
        if (record.book.previousError?.startsWith("In attesa di retry long-term:")) delete record.book.previousError;
      } else if (cmd.type === "set_autosync") {
        if (record.book.status === "running" || !record.book.remote ||
            cmd.enabled && (!record.book.remote.lastSyncedCommit || githubPublicationBlocker(record.book)))
          throw new ApiError(409, "autosync", "Per attivare autosync servono libro fermo, primo salvataggio e scene fuse confermate.");
        record.book.remote.autoSync = cmd.enabled;
        record.book.updatedAt = new Date(Math.max(Date.now(), Date.parse(record.book.updatedAt) + 1)).toISOString();
        if (cmd.enabled) await enqueueCheckpoint(record.book, { get: async () => record.outbox, put: async value => { record.outbox = value; } });
      } else {
        const book = record.book;
        const now = new Date().toISOString();
        if (cmd.type === "close_blocked") {
          if (book.status === "running" || book.editorialCycle?.stage !== "blocked")
            throw new ApiError(409, "editorial", "Il ciclo non è fermo e bloccato.");
          forceCloseCycle(book.editorialCycle, "author", cmd.note, now);
        } else {
          const target = { kind: cmd.type === "edit_scene" ? "scene" as const : "memory" as const,
            id: cmd.type === "edit_scene" ? cmd.sceneId : cmd.memoryId };
          if (currentStamp(book, target) !== cmd.expectedStamp)
            throw new ApiError(412, "element_changed", "L'elemento è cambiato: conserva la bozza e confronta il nuovo testo.");
          if (cmd.type === "edit_scene") bookEditing.editScene(book, cmd.sceneId, cmd.patch, { now, origin: "manual" });
          else bookEditing.editMemory(book, cmd.memoryId, cmd.text, { now, origin: "manual" });
        }
        delete record.retrySchedule;
        book.updatedAt = new Date(Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
        record.activities.push({ id: randomUUID(), bookId: id, runId: envelope.commandId, phase: book.phase,
          title: cmd.type === "close_blocked" ? "Chiusura editoriale dell'autore" : "Modifica dell'autore",
          reason: "Comando autenticato applicato sulla revisione confermata.",
          nextStep: "La modifica non avvia automaticamente una review o una richiesta AI.",
          status: "succeeded", aiRequested: false, createdAt: now, endedAt: now });
        await enqueueCheckpoint(book, { get: async () => record.outbox, put: async value => { record.outbox = value; } });
      }
      return receipt;
    });
    if (effect) {
      if (["start", "retry_now", "pause", "stop_after_task"].includes(envelope.command.type))
        return this.effect(id, client, envelope);
      void this.track(this.effect(id, client, envelope), this.effects).catch(() => undefined);
    }
    return result;
  }
  private makeReceiptRoom(record: HostBookRecord): void {
    // Sequence watermarks survive compaction; an evicted command is never replayed.
    const receipts = Object.entries(record.commands);
    if (receipts.length < 2000) return;
    const compactable = receipts.filter(([, receipt]) => receipt.state === "completed" && !isOriginReceipt(receipt, record.book.id));
    for (const [key] of compactable.slice(0, 1000)) delete record.commands[key];
    if (Object.keys(record.commands).length >= 2000)
      throw new ApiError(409, "receipts", "Ricevute incerte da riconciliare prima di nuovi comandi.");
  }
  /** Explicit reconciliation, NEVER execution. A missing request receives a
   * durable tombstone so a delayed original POST cannot start after the check. */
  resolveCommand(id: string, client: Client, expected: string | undefined, raw: unknown) {
    const envelope = serverCommandEnvelopeSchema.parse(raw);
    if (!client.scopes.includes(scopeFor(envelope.command.type)))
      throw new ApiError(403, "scope", "Permesso del comando originale richiesto per riconciliarlo.");
    const fingerprint = createHash("sha256").update(serverCommandDigestInput(client.id, envelope)).digest("hex");
    return this.track(this.store.serial("$commands:" + id, () => this.store.transaction(id, record => {
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima della riconciliazione.");
      this.owns(record);
      const previous = record.commands[envelope.commandId];
      if (previous) {
        if (previous.clientId !== client.id || previous.digest !== fingerprint)
          throw new ApiError(409, "command_reused", "Identificativo già usato con un'altra richiesta.");
        return previous;
      }
      this.accepting();
      if (expected !== bookEtag(record)) throw new ApiError(412, "revision", "Ricarica la replica prima di riconciliare la richiesta.");
      if (envelope.sequence !== (record.watermarks?.[client.id] ?? 0) + 1)
        throw new ApiError(409, "sequence", "Sequenza già consumata o non attuale: l'assenza della ricevuta non prova che il comando non sia stato eseguito.");
      this.makeReceiptRoom(record);
      const receipt: HostBookRecord["commands"][string] = {
        digest: fingerprint, clientId: client.id, sequence: envelope.sequence, state: "completed",
        result: { ok: false, code: "cancelled_before_acceptance" },
      };
      record.commands[envelope.commandId] = receipt;
      record.watermarks ??= {}; record.watermarks[client.id] = envelope.sequence;
      return receipt;
    })));
  }
  private async effect(id: string, client: Client, envelope: ServerCommandEnvelope) {
    const cmd = envelope.command;
    let result: unknown = { accepted: true };
    let state: "completed" | "uncertain" = "completed";
    try {
      if (cmd.type === "start" || cmd.type === "retry_now") {
        const runId = await this.store.transaction(id, record => {
          this.accepting();
          if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima dell'avvio.");
          this.owns(record);
          const authorization = record.runAuthorization;
          if (!authorization || authorization.commandId !== envelope.commandId || authorization.state !== "requested")
            throw new Error("Autorizzazione del run non attuale.");
          authorization.state = "started"; return authorization.runId;
        });
        this.launch(id, cmd.type === "start" ? { runId } : { generation: cmd.generation, force: true, runId });
        result = { runId };
      } else if (cmd.type === "pause") {
        this.runners.get(id)?.runner.stop();
        result = { pauseRequested: true };
      } else if (cmd.type === "stop_after_task") {
        this.runners.get(id)?.runner.stopAfterCurrent();
        result = { stopAfterTaskRequested: true };
      } else if (cmd.type === "save_github") {
        this.accepting();
        const book = await this.runtime.getBook(id);
        result = book?.remote?.autoSync
          ? await this.runtime.withBookScope(id, () => saveToGitHubNow(id))
          : await pushManualGitHubBook(id, cmd.consentPublic);
      } else if (cmd.type === "connect_github") {
        this.accepting();
        await this.runtime.withBookScope(id, () => withExclusiveLock("bookwriter:writer:" + id, { busy: BUSY_LOCK }, () =>
          withExclusiveLock("bookwriter:github-outbox", { busy: BUSY_LOCK }, async () => {
            const before = await this.store.read(id);
            if (!before || before.book.status === "running" || before.book.remote) throw new Error("Libro cambiato.");
            const remote = validateRemote({ owner: cmd.owner, repository: cmd.repository, branch: cmd.branch });
            const repository = await inspectRepository(remote);
            if (!repository.canPush || !repository.private && !cmd.consentPublic) throw new Error("Consenso o permessi GitHub assenti.");
            const destination = await inspectGitHubDestination(remote);
            if (destination.kind !== "available") throw new Error("Repository con libro esistente: usa un trasferimento verificato, non un overwrite.");
            await this.store.transaction(id, record => {
              if (record.book.updatedAt !== before.book.updatedAt || record.book.remote || record.book.status === "running")
                throw new Error("Libro cambiato durante la verifica GitHub.");
              record.book.remote = { ...remote, autoSync: false, allowPublicSync: cmd.consentPublic };
              record.book.updatedAt = new Date(Math.max(Date.now(), Date.parse(record.book.updatedAt) + 1)).toISOString();
            });
          })));
        result = { connected: true, firstPushRequired: true };
      }
    } catch {
      if (cmd.type === "save_github" || cmd.type === "connect_github") state = "uncertain";
      if (cmd.type === "start" || cmd.type === "retry_now") await this.store.transaction(id, record => {
        if (record.runAuthorization?.commandId === envelope.commandId) record.runAuthorization.state = "stopped";
      });
      result = { ok: false, code: "operation_not_completed",
        message: "Operazione non completata: controlla attività e coda. Non ripetere alla cieca un tentativo incerto." };
    }
    return this.store.transaction(id, record => {
      const receipt = record.commands[envelope.commandId];
      if (!receipt || receipt.clientId !== client.id) throw new Error("Ricevuta del comando non più disponibile.");
      receipt.state = state; receipt.result = result;
      return receipt;
    });
  }
  /** Waits for currently admitted work; unlike close(), does not request a stop. */
  async waitForIdle(): Promise<void> {
    // Operations and runners can enqueue effects (including an outbox pass) while settling.
    while (this.operations.size || this.effects.size || this.runners.size) {
      await Promise.allSettled([...this.operations, ...this.effects, ...[...this.runners.values()].map(r => r.promise)]);
    }
  }
  async close(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    for (const { runner } of this.runners.values()) runner.stop();
    await Promise.allSettled([...this.operations]);
    for (const { runner } of this.runners.values()) runner.stop();
    await Promise.allSettled([...this.runners.values()].map(r => r.promise));
    await this.ticking;
    await Promise.allSettled([...this.effects]);
  }
}
