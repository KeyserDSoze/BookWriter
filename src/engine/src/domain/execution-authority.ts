import { z } from "zod";
import type { BookProject } from "./types";

/** Portable authority marker. Credentials, connection URL and executable timers are never here. */
export const executionAuthoritySchema = z.object({
  kind: z.literal("server"),
  serverId: z.string().uuid(),
  epoch: z.string().uuid(),
}).strict();
export type ExecutionAuthority = z.infer<typeof executionAuthoritySchema>;

export function isServerBook(book: Pick<BookProject, "executionAuthority">): boolean {
  return book.executionAuthority?.kind === "server";
}
export function assertLocalBook(book: Pick<BookProject, "executionAuthority">): void {
  if (isServerBook(book)) throw new Error("Questo libro appartiene al server personale: la replica locale è di sola lettura. Scollegare il server non autorizza un'esecuzione locale.");
}
