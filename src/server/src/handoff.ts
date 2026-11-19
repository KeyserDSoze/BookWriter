import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  bookSchema, activitySchema, migrateBook, withoutInheritedConsents, serverHandoffDigestInput, serverGitHubHandoffDigestInput,
  validateRemote, isReleasedBook, z,
  type BookProject, type Activity, type HandoffResolution, type GitHubHandoffRequest, type GitHubRemote,
} from "@engine/index";
import { FileBookStore, atomicJson, readJson } from "./files";
import type { Client } from "./auth";
import { ApiError } from "./errors";
import type { HostBookRecord, ServerCommandReceipt } from "@engine/index";

/** Creation/adoption receipts are permanent origin evidence, not command history. */
export function isOriginReceipt(receipt: ServerCommandReceipt | undefined, bookId: string): boolean {
  return receipt?.state === "completed" && receipt.sequence === 1 && !!receipt.result &&
    typeof receipt.result === "object" && "bookId" in receipt.result && receipt.result.bookId === bookId;
}
function isAdoptionReceipt(record: HostBookRecord, handoffId: string): boolean {
  const receipt = record.commands[handoffId];
  const result = receipt?.result;
  return isOriginReceipt(receipt, record.book.id) && !!result && typeof result === "object" &&
    "handoff" in result && result.handoff === true;
}

/** What the adoption of a GitHub book needs from the host: its credential store and the repository (always read with that book's PAT). */
export interface GitHubAdoptionHooks {
  stage(bookId: string, token: string): Promise<void>;
  drop(bookId: string): Promise<void>;
  inspect(bookId: string, remote: GitHubRemote): Promise<{ private: boolean; canPush: boolean }>;
  read(bookId: string, remote: GitHubRemote): Promise<{ book: BookProject; activities: Activity[] }>;
  compare(bookId: string, remote: GitHubRemote, from: string, to: string): Promise<{ status: string }>;
  publish(bookId: string, consentPublic: boolean): Promise<void>;
}

const MAX_TOMBSTONES = 5000;
const ledgerSchema = z.object({
  version: z.literal(1),
  cancelled: z.record(z.string().uuid(), z.object({ at: z.string().datetime(), bookId: z.string().uuid() }).strict()),
}).strict().refine(value => Object.keys(value.cancelled).length <= MAX_TOMBSTONES);
type Ledger = z.infer<typeof ledgerSchema>;

/**
 * Adoption of a local book. The server never executes a book that arrived by
 * a plain upload: the client fenced its own copy FIRST, the receipt below is the
 * durable proof, and a handoff that was never received can only be cancelled by a
 * tombstone that also rejects a late delivery. Nothing here deletes a book.
 */
export class HandoffService {
  private readonly path: string;
  constructor(private readonly store: FileBookStore, private readonly serverId: string,
    private readonly isCurrent: (client: Client) => boolean) {
    this.path = join(store.root, "private", "handoffs.json");
  }
  private async ledger(): Promise<Ledger> {
    const stored = await readJson(this.path, 4 * 1024 * 1024);
    return stored === undefined ? { version: 1, cancelled: {} } : ledgerSchema.parse(stored);
  }
  async adopt(client: Client, raw: { handoffId: string; epoch: string; book: unknown; activities: unknown },
    accepting: () => void): Promise<string> {
    if (!client.scopes.includes("write")) throw new ApiError(403, "scope", "Permesso di scrittura richiesto.");
    const book = bookSchema.parse(raw.book) as BookProject;
    const activities = activitySchema.array().max(50_000).parse(raw.activities) as Activity[];
    const authority = book.executionAuthority;
    if (book.remote || book.status === "running" || authority?.kind !== "server" ||
        authority.serverId !== this.serverId || authority.epoch !== raw.epoch ||
        activities.some(activity => activity.bookId !== book.id || activity.status === "running"))
      throw new ApiError(409, "handoff_invalid",
        "Trasferimento non valido: serve un libro locale fermo, senza GitHub, già bloccato dal client con questa epoca e senza tentativi in corso.");
    const digest = createHash("sha256").update(serverHandoffDigestInput(client.id, raw)).digest("hex");
    return this.store.serial("$handoffs", () => this.store.serial("$adopt:" + book.id, async () => {
      const ledger = await this.ledger();
      const existing = await this.store.read(book.id);
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima dell'accettazione.");
      if (ledger.cancelled[raw.handoffId])
        throw new ApiError(409, "handoff_cancelled", "Trasferimento annullato: nessun libro è stato accettato.");
      if (existing) {
        const receipt = existing.commands[raw.handoffId];
        if (isAdoptionReceipt(existing, raw.handoffId) && receipt?.clientId === client.id && receipt.digest === digest) return book.id;
        throw new ApiError(409, "book_exists", "Libro già presente: nessuna copia sostituita.");
      }
      accepting();
      // Defence in depth: a permission never survives a change of host.
      const adopted: BookProject = { ...book, ...withoutInheritedConsents(book) };
      migrateBook(adopted);
      await this.store.create({ version: 1, revision: 1, book: adopted, activities, watermarks: {}, commands: {
        [raw.handoffId]: { digest, clientId: client.id, sequence: 1, state: "completed",
          result: { bookId: book.id, handoff: true } },
      } });
      return book.id;
    }));
  }
  /**
   * The client fenced its copy first; the server reads the book from the repository with the PAT the client
   * delegated for this book. Nothing is uploaded. The book is accepted only if the repository holds exactly this
   * book, descends from the version the client saved, and names no other authority. The marker that makes the
   * server the authority is then published; until it is, the server refuses to run the book.
   */
  async adoptGitHub(client: Client, raw: GitHubHandoffRequest, accepting: () => void, hooks: GitHubAdoptionHooks): Promise<{ bookId: string; markerPublished: boolean }> {
    if (!client.scopes.includes("write")) throw new ApiError(403, "scope", "Permesso di scrittura richiesto.");
    const bookId = raw.bookId;
    const digest = createHash("sha256").update(serverGitHubHandoffDigestInput(client.id, raw)).digest("hex");
    const remote = validateRemote({ owner: raw.github.owner, repository: raw.github.repository, branch: raw.github.branch });
    const created = await this.store.serial("$handoffs", () => this.store.serial("$adopt:" + bookId, async () => {
      const ledger = await this.ledger();
      const existing = await this.store.read(bookId);
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima dell'accettazione.");
      if (ledger.cancelled[raw.handoffId])
        throw new ApiError(409, "handoff_cancelled", "Trasferimento annullato: nessun libro è stato accettato.");
      const rewrite = !!existing && isReleasedBook(existing.book) && existing.book.executionAuthority?.serverId === this.serverId;
      if (existing && !rewrite) {
        const receipt = existing.commands[raw.handoffId];
        if (isAdoptionReceipt(existing, raw.handoffId) && receipt?.clientId === client.id && receipt.digest === digest) return { replay: true as const };
        throw new ApiError(409, "book_exists", "Libro già presente: nessuna copia sostituita.");
      }
      accepting();
      await hooks.stage(bookId, raw.githubToken);
      let made = false;
      try {
        const repository = await hooks.inspect(bookId, remote);
        if (!repository.canPush || !repository.private && !raw.github.consentPublic)
          throw new ApiError(409, "handoff_invalid", "Il PAT non può scrivere su questa repository, oppure è pubblica senza il consenso del libro.");
        const { book: imported, activities } = await hooks.read(bookId, remote);
        const head = imported.remote?.lastSyncedCommit;
        if (imported.id !== bookId || !head || imported.executionAuthority && !(rewrite && imported.executionAuthority.serverId === this.serverId))
          throw new ApiError(409, "handoff_invalid", "La repository non contiene questo libro, oppure lo attribuisce già a un altro server.");
        const cmp = head === raw.github.expectedHead ? { status: "identical" } : await hooks.compare(bookId, remote, raw.github.expectedHead, head);
        if (cmp.status !== "identical" && cmp.status !== "ahead")
          throw new ApiError(409, "handoff_stale", "La repository non discende dalla versione salvata dal client: salva o aggiorna il libro sul client e riprova.");
        const now = new Date();
        const adopted: BookProject = { ...imported, ...withoutInheritedConsents(imported), status: "paused",
          executionAuthority: { kind: "server", serverId: this.serverId, epoch: raw.epoch },
          remote: { ...imported.remote!, autoSync: false, allowPublicSync: raw.github.consentPublic },
          // Newer than the saved snapshot: the authority marker still has to be published.
          updatedAt: new Date(Math.max(now.getTime(), Date.parse(imported.updatedAt) + 1)).toISOString(),
          previousError: "Libro adottato da GitHub: il server ha letto la repository e ora pubblica il marcatore di autorità. Non è partita alcuna richiesta AI." };
        migrateBook(adopted);
        const receipt = { digest, clientId: client.id, sequence: 1, state: "completed" as const, result: { bookId, handoff: true } };
        if (rewrite) {
          await this.store.transaction(bookId, record => {
            record.book = adopted; record.commands = { [raw.handoffId]: receipt }; record.watermarks = {};
            const known = new Set(record.activities.map(a => a.id));
            for (const activity of activities) if (!known.has(activity.id)) record.activities.push(activity);
            delete record.outbox; delete record.retrySchedule; delete record.manualPushIntent; delete record.runAuthorization;
            delete record.structuralCheckpoints;
          });
        } else {
          await this.store.create({ version: 1, revision: 1, book: adopted, activities, watermarks: {}, commands: { [raw.handoffId]: receipt } });
        }
        made = true;
        return { replay: false as const };
      } catch (error) {
        if (!made) await hooks.drop(bookId).catch(() => undefined);
        throw error;
      }
    }));
    if (created.replay) return { bookId, markerPublished: true };
    // Outside the serialisation: a slow push must not hold the ledger. Failing here keeps the adopted book, which
    // refuses to run until a save publishes the marker.
    let markerPublished = false;
    try { await hooks.publish(bookId, raw.github.consentPublic); markerPublished = true; }
    catch { /* the book says so in previousError; «Salva su GitHub dal server» completes it */ }
    await this.store.transaction(bookId, record => {
      if (record.book.previousError?.startsWith("Libro adottato da GitHub"))
        record.book.previousError = markerPublished ? undefined : "Adozione da completare: il marcatore di autorità non è ancora su GitHub. Usa «Salva su GitHub dal server»; finché manca il server non avvia l'AI.";
    }).catch(() => undefined);
    return { bookId, markerPublished };
  }
  /** The ONLY way to give up an unreceived handoff. A received one cannot be undone here. */
  async cancel(client: Client, handoffId: string, bookId: string, accepting: () => void, dropCredential?: (bookId: string) => Promise<void>): Promise<HandoffResolution> {
    if (!client.scopes.includes("write")) throw new ApiError(403, "scope", "Permesso di scrittura richiesto.");
    return this.store.serial("$handoffs", () => this.store.serial("$adopt:" + bookId, async () => {
      const existing = await this.store.read(bookId);
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima della riconciliazione.");
      if (existing) {
        // An older version may have compacted the original receipt. The file's
        // presence is enough to rule out cancellation, but not to prove adoption.
        if (isAdoptionReceipt(existing, handoffId) && existing.commands[handoffId]?.clientId === client.id)
          return { state: "adopted" as const, bookId };
        throw new ApiError(409, "handoff_unverified", "Il libro esiste sul server ma la ricevuta non è verificabile: non sbloccare la copia locale.");
      }
      const ledger = await this.ledger();
      accepting();
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima della riconciliazione.");
      if (ledger.cancelled[handoffId] && ledger.cancelled[handoffId].bookId !== bookId)
        throw new ApiError(409, "handoff_unverified", "L'identificativo non identifica questo trasferimento.");
      await dropCredential?.(bookId);
      if (!ledger.cancelled[handoffId]) {
        if (Object.keys(ledger.cancelled).length >= MAX_TOMBSTONES)
          throw new ApiError(409, "handoff_ledger_full", "Troppi trasferimenti annullati: conserva la copia locale e contatta l'amministratore.");
        ledger.cancelled[handoffId] = { at: new Date().toISOString(), bookId };
        await atomicJson(this.path, ledger);
      }
      return { state: "cancelled" as const, bookId };
    }));
  }
}
