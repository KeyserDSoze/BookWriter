import type { Activity, AppSettings, BookProject, EncryptedSecret } from "../domain/types";
import { host } from "./host";
import { LocksUnavailable } from "./errors";

export { BookNotFound, BookRevisionConflict, LocksUnavailable } from "./errors";

/** The books, activities and settings of the host the engine is running in. */
export const getBook = (id: string): Promise<BookProject | undefined> => host().getBook(id);
export const getBookForMutation = (id: string): Promise<BookProject | undefined> => host().getBookForMutation(id);
export const listActivities = (bookId: string): Promise<Activity[]> => host().listActivities(bookId);
export const loadSettings = (): Promise<AppSettings> => host().loadSettings();
export const saveBook = (book: BookProject, queueSync = true, expectedUpdatedAt?: string): Promise<void> =>
  host().saveBook(book, queueSync, expectedUpdatedAt);
export const saveActivity = (activity: Activity): Promise<void> => host().saveActivity(activity);
export const saveBookAndActivity = (book: BookProject, activity: Activity, expectedUpdatedAt?: string): Promise<void> =>
  host().saveBookAndActivity(book, activity, expectedUpdatedAt);
export const saveBookWithAuthorActivity = (book: BookProject, activity: Activity, expectedUpdatedAt: string): Promise<void> =>
  host().saveBookWithAuthorActivity(book, activity, expectedUpdatedAt);

/** Device credentials: encrypted with a key the host keeps, never the author's account. */
export const encryptLocal = (text: string): Promise<EncryptedSecret> => host().encrypt(text);
export const decryptLocal = (value: EncryptedSecret): Promise<string> => host().decrypt(value);

/**
 * Runs `action` while holding the named exclusive lock, without waiting. `busy` is shown when
 * another holder has it; `unsupported` when the host cannot lock (fail closed, never run unlocked).
 */
export async function withExclusiveLock<T>(
  name: string, messages: { busy: string; unsupported?: string }, action: () => Promise<T>,
): Promise<T> {
  let result;
  try { result = await host().tryLock(name, action); }
  catch (error) {
    if (error instanceof LocksUnavailable && messages.unsupported) throw new Error(messages.unsupported);
    throw error;
  }
  if (!result.held) throw new Error(messages.busy);
  return result.value;
}
