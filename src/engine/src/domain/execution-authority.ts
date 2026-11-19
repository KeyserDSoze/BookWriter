import { z } from "zod";
import type { BookProject } from "./types";

/** Portable authority marker. Credentials, connection URL and executable timers are never here. */
export const executionAuthoritySchema = z.object({
  kind: z.literal("server"),
  serverId: z.string().uuid(),
  epoch: z.string().uuid(),
  /** Set by the server when it gives the book back: it no longer runs it, and the repository carries no marker. */
  releasedAt: z.string().datetime().optional(),
  releasedCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
}).strict();
export type ExecutionAuthority = z.infer<typeof executionAuthoritySchema>;

export function isServerBook(book: Pick<BookProject, "executionAuthority">): boolean {
  return book.executionAuthority?.kind === "server";
}
/** The server gave the book back to its client: nothing may run or be written on the server any more. */
export const isReleasedBook = (book: Pick<BookProject, "executionAuthority">): boolean => !!book.executionAuthority?.releasedAt;
export function assertLocalBook(book: Pick<BookProject, "executionAuthority">): void {
  if (isServerBook(book)) throw new Error("Questo libro appartiene al server personale: la replica locale è di sola lettura. Scollegare il server non autorizza un'esecuzione locale.");
}
