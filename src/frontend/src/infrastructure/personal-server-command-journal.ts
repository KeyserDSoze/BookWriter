import { z } from "zod";
import { serverCommandEnvelopeSchema, type ServerConnection, type ServerCommandReceipt } from "@engine/domain/personal-server";

export const serverCommandJournalKey = (bookId: string) => "personal-server:command:v1:" + bookId;
export const MAX_PENDING_SERVER_COMMANDS = 20;
export const pendingServerCommandSchema = z.object({
  serverId: z.string().uuid(), clientId: z.string().uuid(), epoch: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), baseUrl: z.string().max(500),
  etag: z.string().min(1).max(200), digest: z.string().regex(/^[a-f0-9]{64}$/),
  envelope: serverCommandEnvelopeSchema, state: z.enum(["prepared", "accepted", "uncertain"]),
}).strict();
export type PendingServerCommand = z.infer<typeof pendingServerCommandSchema>;
const journalSchema = z.object({
  version: z.literal(1), entries: z.array(pendingServerCommandSchema).max(MAX_PENDING_SERVER_COMMANDS),
}).strict().refine(value => new Set(value.entries.map(entry => entry.envelope.commandId)).size === value.entries.length);
export type ServerCommandJournal = z.infer<typeof journalSchema>;
export function readServerCommandJournal(raw: unknown): ServerCommandJournal {
  if (raw === undefined) return { version: 1, entries: [] };
  const result = journalSchema.safeParse(raw);
  if (!result.success) throw new Error("Registro dei comandi non verificabile: dati conservati, nessuna richiesta ripetuta. Controlla il server.");
  return result.data;
}
export function commandMatchesConnection(pending: PendingServerCommand, connection: ServerConnection, epoch: string): boolean {
  return pending.serverId === connection.serverId && pending.clientId === connection.clientId &&
    pending.fingerprint === connection.fingerprint && pending.baseUrl === connection.baseUrl && pending.epoch === epoch;
}
export function assertCommandConnection(pending: PendingServerCommand, connection: ServerConnection, epoch: string): void {
  if (!commandMatchesConnection(pending, connection, epoch))
    throw new Error("Il comando appartiene a un'altra identità, client o epoca: nessun invio e nessuna ricevuta eliminata.");
}
export function settleCommandJournal(journal: ServerCommandJournal, pending: PendingServerCommand,
  receipt: ServerCommandReceipt): ServerCommandJournal {
  if (receipt.digest !== pending.digest || receipt.clientId !== pending.clientId || receipt.sequence !== pending.envelope.sequence)
    throw new Error("Ricevuta non coerente con il comando originale: nessun risultato approvato.");
  const current = journal.entries.find(entry => entry.envelope.commandId === pending.envelope.commandId);
  if (current && (current.digest !== pending.digest || current.clientId !== pending.clientId || current.epoch !== pending.epoch))
    throw new Error("Registro dei comandi cambiato durante la verifica: nessuna richiesta eliminata.");
  return { version: 1, entries: journal.entries.flatMap(entry => {
    if (entry.envelope.commandId !== pending.envelope.commandId) return [entry];
    return receipt.state === "completed" ? [] : [{ ...entry, state: receipt.state }];
  }) };
}
