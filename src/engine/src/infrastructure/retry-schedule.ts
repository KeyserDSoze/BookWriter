import type { Activity, BookProject, EndpointProfile } from "../domain/types";
import { BookRevisionConflict } from "../core/errors";
import { host } from "../core/host";
import { narrativeStateJson } from "../core/narrative-state";
import { readLongTermRetry, restrictRetryPolicy, retryIsDue, retryScheduleSchema, retryStamp, type RetrySchedule } from "../core/retry-policy";

export const retryScheduleKey = (bookId: string) => "retry-schedule:v1:" + bookId;
export class RetryScheduleNotReady extends Error {
  constructor() { super("Ripartenza non più autorizzata o non ancora dovuta. Controlla il libro e riprendi manualmente."); }
}
function parse(value: unknown): RetrySchedule | undefined {
  if (value === undefined) return undefined;
  const result = retryScheduleSchema.safeParse(value);
  if (!result.success) throw new Error("Attesa di retry non verificabile: riprendi manualmente dopo aver controllato il task.");
  return result.data;
}
export async function getRetrySchedule(bookId: string): Promise<RetrySchedule | undefined> {
  return parse(await host().readRetrySchedule(bookId));
}
export async function clearRetrySchedule(bookId: string, generation?: string): Promise<void> {
  await host().transaction(bookId, record => {
    if (generation && record.retrySchedule?.generation !== generation) return;
    delete record.retrySchedule;
    // Operational cleanup only: no narrative checkpoint and no outbox request.
    if (record.book.status === "paused" && record.book.previousError?.startsWith("In attesa di retry long-term:"))
      delete record.book.previousError;
  });
}

export async function saveFailedRetry(book: BookProject, activity: Activity, expected: string, plan: RetrySchedule): Promise<void> {
  retryScheduleSchema.parse(plan);
  if (plan.bookId !== book.id || activity.bookId !== book.id || activity.runId !== plan.runId ||
      activity.status !== "failed" || activity.aiRequested !== true || book.status !== "paused" ||
      retryStamp(narrativeStateJson(book)) !== plan.bookStamp)
    throw new Error("Identità del retry non valida.");
  await host().transaction(book.id, record => {
    if (record.book.updatedAt !== expected) throw new BookRevisionConflict();
    const next = structuredClone(book);
    next.updatedAt = new Date(Math.max(Date.now(), Date.parse(expected) + 1)).toISOString();
    record.book = next;
    record.activities = [...record.activities.filter(a => a.id !== activity.id), structuredClone(activity)];
    record.retrySchedule = structuredClone(plan);
  }, { activities: true });
}
function currentPlan(plan: RetrySchedule, book: BookProject, endpoints: EndpointProfile[], generation: string, force: boolean): boolean {
  const policy = readLongTermRetry(endpoints.find(e => e.id === plan.endpointId)?.longTermRetry);
  const effective = restrictRetryPolicy(plan.policy, policy);
  return plan.generation === generation && retryIsDue(plan, Date.now(), force) &&
    book.status === "paused" && retryStamp(narrativeStateJson(book)) === plan.bookStamp &&
    effective.enabled && (effective.maxCycles === null || plan.cyclesUsed < effective.maxCycles) &&
    (force || Date.now() >= Date.parse(plan.scheduledAt) + effective.intervalMinutes * 60_000);
}
function revokedPlan(plan: RetrySchedule, book: BookProject, endpoints: EndpointProfile[]): boolean {
  const policy = restrictRetryPolicy(plan.policy,
    readLongTermRetry(endpoints.find(e => e.id === plan.endpointId)?.longTermRetry));
  return book.status !== "paused" || retryStamp(narrativeStateJson(book)) !== plan.bookStamp ||
    !policy.enabled || policy.maxCycles !== null && plan.cyclesUsed >= policy.maxCycles;
}

/** Called while holding the REAL writer lock. An abandoned claimed plan is never replayed. */
export async function claimRetrySchedule(bookId: string, generation: string, force = false): Promise<RetrySchedule> {
  const settings = await host().loadSettings();
  const claimed = await host().transaction(bookId, record => {
    const plan = parse(record.retrySchedule);
    const stillRunning = !!plan && record.activities.some(a => a.runId === plan.runId && a.status === "running");
    if (!plan || !currentPlan(plan, record.book, settings.endpoints, generation, force) || stillRunning) {
      if (plan?.generation === generation && plan.state === "waiting" &&
          (revokedPlan(plan, record.book, settings.endpoints) || stillRunning))
        delete record.retrySchedule;
      return undefined;
    }
    plan.state = "claimed"; record.retrySchedule = plan; return structuredClone(plan);
  }, { activities: true });
  if (!claimed) throw new RetryScheduleNotReady();
  return claimed;
}

export async function assertRetryClaim(plan: RetrySchedule): Promise<void> {
  const current = await getRetrySchedule(plan.bookId);
  if (current?.generation !== plan.generation || current.state !== "claimed")
    throw new DOMException("Ripartenza annullata.", "AbortError");
  // Revocation in another tab must win before the network call as well.
  const settings = await host().loadSettings();
  const policy = restrictRetryPolicy(plan.policy,
    readLongTermRetry(settings.endpoints.find(e => e.id === plan.endpointId)?.longTermRetry));
  if (!policy.enabled || policy.maxCycles !== null && plan.cyclesUsed >= policy.maxCycles)
    throw new DOMException("Retry long-term disattivato.", "AbortError");
  const book = await host().getBook(plan.bookId);
  if (!book || retryStamp(narrativeStateJson(book)) !== plan.bookStamp)
    throw new DOMException("Il libro è cambiato durante la ripartenza.", "AbortError");
  // Last awaited read: cancellation while settings/book were being checked must win.
  const final = await getRetrySchedule(plan.bookId);
  if (final?.generation !== plan.generation || final.state !== "claimed")
    throw new DOMException("Ripartenza annullata prima della richiesta.", "AbortError");
}
