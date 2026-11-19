import { z } from "zod";

export const SERVER_API_VERSION = 1;
export const SERVER_SCOPES = ["read", "write", "run", "update"] as const;
export const serverScopeSchema = z.enum(SERVER_SCOPES);
export type ServerScope = z.infer<typeof serverScopeSchema>;
export const serverInfoSchema = z.object({
  apiVersion: z.literal(SERVER_API_VERSION), serverVersion: z.string().max(60),
  engineVersion: z.string().max(60), bookFormatVersion: z.number().int().min(0),
  serverId: z.string().uuid(), publicKey: z.string().min(20).max(256),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().min(40).max(256),
}).strict();
export type ServerInfo = z.infer<typeof serverInfoSchema>;
export const serverSessionSchema = z.object({
  clientId: z.string().uuid(), label: z.string().max(80),
  scopes: z.array(serverScopeSchema).max(4),
}).strict();
export type ServerSession = z.infer<typeof serverSessionSchema>;
export const serverConnectionSchema = z.object({
  id: z.string().uuid(), baseUrl: z.string().max(500),
  serverId: z.string().uuid(), publicKey: z.string().min(20).max(256),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  clientId: z.string().uuid().optional(), // Pre-command-journal connections can still read; reconnect to send.
  token: z.object({ iv: z.string().max(128), data: z.string().max(4096) }).strict(),
}).strict();
export type ServerConnection = z.infer<typeof serverConnectionSchema>;

const id = z.string().min(1).max(300);
/** Finite protocol, not arbitrary patches or serialised closures. */
export const serverCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("pause") }).strict(),
  z.object({ type: z.literal("stop_after_task") }).strict(),
  z.object({ type: z.literal("cancel_retry") }).strict(),
  z.object({ type: z.literal("retry_now"), generation: z.string().uuid() }).strict(),
  z.object({ type: z.literal("save_github"), consentPublic: z.boolean() }).strict(),
  z.object({ type: z.literal("connect_github"), owner: z.string().min(1).max(100),
    repository: z.string().min(1).max(100), branch: z.string().min(1).max(200), consentPublic: z.boolean() }).strict(),
  z.object({ type: z.literal("set_autosync"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("edit_scene"), sceneId: id, expectedStamp: z.string().max(100),
    patch: z.object({ title: z.string().optional(), objective: z.string().optional(),
      text: z.string().optional(), summary: z.string().optional() }).strict() }).strict(),
  z.object({ type: z.literal("edit_memory"), memoryId: id, text: z.string(), expectedStamp: z.string().max(100) }).strict(),
  z.object({ type: z.literal("close_blocked"), note: z.string().min(1).max(8000), confirmed: z.literal(true) }).strict(),
]);
export type ServerCommand = z.infer<typeof serverCommandSchema>;
export const serverCommandEnvelopeSchema = z.object({
  commandId: z.string().uuid(), sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  command: serverCommandSchema,
}).strict();
export type ServerCommandEnvelope = z.infer<typeof serverCommandEnvelopeSchema>;
export const serverCommandReceiptSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/), clientId: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["accepted", "completed", "uncertain"]), result: z.unknown(),
}).strict();
export type ServerCommandReceipt = z.infer<typeof serverCommandReceiptSchema>;
/** Shared canonical input for SHA-256, never a fingerprint of credentials. */
export function serverCommandDigestInput(clientId: string, envelope: ServerCommandEnvelope): string {
  return JSON.stringify({ clientId, ...serverCommandEnvelopeSchema.parse(envelope) });
}

/** One-way adoption of a LOCAL book that has no GitHub destination. The epoch is
 * chosen by the client and written into the book BEFORE the upload, so that a
 * lost answer can never leave two executable copies. Anything else is rejected. */
export const handoffRequestSchema = z.object({
  handoffId: z.string().uuid(), consent: z.literal(true), epoch: z.string().uuid(),
  book: z.unknown(), activities: z.unknown(),
}).strict();
export const handoffResolveSchema = z.object({ bookId: z.string().uuid() }).strict();
export const handoffResolutionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("adopted"), bookId: z.string().uuid() }).strict(),
  z.object({ state: z.literal("cancelled"), bookId: z.string().uuid() }).strict(),
]);
export type HandoffResolution = z.infer<typeof handoffResolutionSchema>;
export function serverHandoffDigestInput(clientId: string, body: { handoffId: string; epoch: string; book: unknown; activities: unknown }): string {
  return JSON.stringify({ clientId, handoffId: body.handoffId, epoch: body.epoch, book: body.book, activities: body.activities });
}

export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("URL del server non valido."); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
    throw new Error("Usa un'origine HTTPS senza percorso, credenziali o parametri; HTTP è ammesso solo su loopback.");
  return url.origin;
}
