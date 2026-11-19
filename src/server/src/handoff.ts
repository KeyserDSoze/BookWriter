import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  bookSchema, activitySchema, migrateBook, withoutInheritedConsents, serverHandoffDigestInput, z,
  type BookProject, type Activity, type HandoffResolution,
} from "@engine/index";
import { FileBookStore, atomicJson, readJson } from "./files";
import type { Client } from "./auth";
import { ApiError } from "./errors";

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
      accepting();
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima dell'accettazione.");
      if ((await this.ledger()).cancelled[raw.handoffId])
        throw new ApiError(409, "handoff_cancelled", "Trasferimento annullato: nessun libro è stato accettato.");
      const existing = await this.store.read(book.id);
      if (existing) {
        const receipt = existing.commands[raw.handoffId];
        if (receipt?.clientId === client.id && receipt.digest === digest) return book.id;
        throw new ApiError(409, "book_exists", "Libro già presente: nessuna copia sostituita.");
      }
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
  /** The ONLY way to give up an unreceived handoff. A received one cannot be undone here. */
  async cancel(client: Client, handoffId: string, bookId: string, accepting: () => void): Promise<HandoffResolution> {
    if (!client.scopes.includes("write")) throw new ApiError(403, "scope", "Permesso di scrittura richiesto.");
    return this.store.serial("$handoffs", () => this.store.serial("$adopt:" + bookId, async () => {
      if (!this.isCurrent(client)) throw new ApiError(401, "revoked", "Token revocato prima della riconciliazione.");
      const existing = await this.store.read(bookId);
      const receipt = existing?.commands[handoffId];
      if (receipt) {
        if (receipt.clientId !== client.id) throw new ApiError(409, "handoff_foreign", "Trasferimento di un altro client.");
        return { state: "adopted" as const, bookId };
      }
      accepting();
      const ledger = await this.ledger();
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
