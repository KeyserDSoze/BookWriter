/** Optional copy of the AI conversations (prompt + reply) inside the book's GitHub
 * repository. Written only when the author turned it on twice: «keep forever» and «write
 * to GitHub». The conversations hold the manuscript and the narrative secrets that were
 * sent to the model: use private repositories. Pure: no I/O. */
export const CONVERSATIONS_DIR = ".bookwriter/conversations/";
export const CONVERSATIONS_INDEX = CONVERSATIONS_DIR + "index.json";
/** The whole operation is limited to 12 MiB: conversations never take more than this. */
export const CONVERSATIONS_BUDGET_BYTES = 6 * 1024 * 1024;
export const CONVERSATIONS_MAX_FILES = 400;

export interface ConversationRecord {
  activityId: string; bookId: string; createdAt: string; endpointId: string; modelId: string;
  systemPrompt: string; userPrompt: string; response?: string; reasoning?: string; truncated: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
export function conversationPath(activityId: string): string | null {
  return ID.test(activityId) ? CONVERSATIONS_DIR + activityId + ".json" : null;
}
/** Paths that BookWriter itself wrote here: the only ones it may delete from the repository. */
export function isConversationPath(path: string): boolean {
  return path.startsWith(CONVERSATIONS_DIR) && path.endsWith(".json") &&
    !path.includes("..") && /^[A-Za-z0-9_./-]+$/.test(path);
}

/** Size of one entry exactly as the push measures it (JSON of the tree entry). */
function entrySize(path: string, content: string): number {
  return JSON.stringify({ path, mode: "100644", type: "blob", content }).length + 1;
}

export interface ConversationProjection {
  files: Record<string, string>;
  included: number;
  /** Conversations of this book kept on the device but left out (older, or over the budget). */
  omitted: number;
}

/** `traces` must be sorted newest first. Takes as many as fit in `budgetBytes`, never a
 * partial one, and declares how many were left out. */
export function projectConversations(
  bookId: string, traces: readonly ConversationRecord[], omittedBefore: number, budgetBytes: number,
): ConversationProjection {
  const files: Record<string, string> = {};
  const listed: Array<{ activityId: string; createdAt: string; endpointId: string; modelId: string }> = [];
  let used = 0;
  for (const trace of traces) {
    if (trace.bookId !== bookId) continue;
    const path = conversationPath(trace.activityId);
    if (!path) continue;
    const content = JSON.stringify({
      schemaVersion: 1, kind: "ai-conversation", activityId: trace.activityId, bookId: trace.bookId,
      createdAt: trace.createdAt, endpointId: trace.endpointId, modelId: trace.modelId,
      truncated: trace.truncated, systemPrompt: trace.systemPrompt, userPrompt: trace.userPrompt,
      ...(trace.response === undefined ? {} : { response: trace.response }),
      ...(trace.reasoning === undefined ? {} : { reasoning: trace.reasoning }),
    }) + "\n";
    const size = entrySize(path, content);
    if (used + size > budgetBytes) break;
    used += size;
    files[path] = content;
    listed.push({ activityId: trace.activityId, createdAt: trace.createdAt, endpointId: trace.endpointId, modelId: trace.modelId });
  }
  const omitted = omittedBefore + (traces.length - listed.length);
  if (!listed.length && !omitted) return { files, included: 0, omitted: 0 };
  files[CONVERSATIONS_INDEX] = JSON.stringify({
    schemaVersion: 1, kind: "ai-conversations-index", bookId, count: listed.length, omitted,
    note: "Copia facoltativa di richieste e risposte AI, scritta perché l'autore lo ha chiesto. Contiene testo del romanzo " +
      "e segreti narrativi. BookWriter non le rilegge da qui: servono a consultarle e archiviarle.",
    conversations: listed,
  }, null, 2) + "\n";
  return { files, included: listed.length, omitted };
}
