import { z } from "zod";

/** Shared by the browser and Node hosts. A missing policy never grants permission. */
export const longTermRetrySchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(10_080),
  maxCycles: z.number().int().min(1).max(1000).nullable(),
}).strict();
export type LongTermRetryPolicy = z.infer<typeof longTermRetrySchema>;
export const DEFAULT_LONG_TERM_RETRY: LongTermRetryPolicy = { enabled: false, intervalMinutes: 15, maxCycles: 3 };

export const retryScheduleSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), bookId: z.string().min(1).max(300),
  runId: z.string().uuid(), generation: z.string().uuid(),
  endpointId: z.string().min(1).max(300), modelId: z.string().min(1).max(300),
  taskKey: z.string().regex(/^\d+:[a-f0-9]{8}$/),
  bookStamp: z.string().regex(/^\d+:[a-f0-9]{8}$/),
  policy: longTermRetrySchema,
  authorizedPolicies: z.record(z.string().max(300), longTermRetrySchema)
    .refine(value => Object.keys(value).length <= 50),
  cyclesUsed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  scheduledAt: z.string().datetime(), nextRetryAt: z.string().datetime(),
  state: z.enum(["waiting", "claimed"]),
}).strict().superRefine((value, context) => {
  const scheduled = Date.parse(value.scheduledAt);
  const due = Date.parse(value.nextRetryAt);
  if (!value.policy.enabled || due !== scheduled + value.policy.intervalMinutes * 60_000 ||
      !value.authorizedPolicies[value.endpointId]?.enabled ||
      value.policy.maxCycles !== null && value.cyclesUsed >= value.policy.maxCycles)
    context.addIssue({ code: "custom", message: "Piano di retry non valido." });
});
export type RetrySchedule = z.infer<typeof retryScheduleSchema>;

/** Accidental-staleness marker, not a signature or a copy of private text. */
export function retryStamp(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function readLongTermRetry(value: unknown): LongTermRetryPolicy {
  if (value === undefined) return { ...DEFAULT_LONG_TERM_RETRY };
  const result = longTermRetrySchema.safeParse(value);
  if (!result.success) throw new Error("Retry long-term non valido: minuti da 1 a 10080 e massimo da 1 a 1000, oppure illimitato esplicito.");
  return result.data;
}

/** Settings may revoke/tighten a grant, never silently enlarge an existing run's grant. */
export function restrictRetryPolicy(authorized: LongTermRetryPolicy, current: LongTermRetryPolicy): LongTermRetryPolicy {
  const caps = [authorized.maxCycles, current.maxCycles].filter((n): n is number => n !== null);
  return {
    enabled: authorized.enabled && current.enabled,
    intervalMinutes: Math.max(authorized.intervalMinutes, current.intervalMinutes),
    maxCycles: caps.length ? Math.min(...caps) : null,
  };
}

export function makeRetrySchedule(input: {
  bookId: string; runId: string; endpointId: string; modelId: string;
  taskKey: string; bookStamp: string; policy: LongTermRetryPolicy; cyclesUsed: number; now: number;
  authorizedPolicies: Record<string, LongTermRetryPolicy>;
}): RetrySchedule | undefined {
  const policy = readLongTermRetry(input.policy);
  if (!policy.enabled || policy.maxCycles !== null && input.cyclesUsed >= policy.maxCycles) return undefined;
  return retryScheduleSchema.parse({
    version: 1, id: crypto.randomUUID(), generation: crypto.randomUUID(),
    bookId: input.bookId, runId: input.runId, endpointId: input.endpointId, modelId: input.modelId,
    taskKey: input.taskKey, bookStamp: input.bookStamp, policy, cyclesUsed: input.cyclesUsed,
    authorizedPolicies: input.authorizedPolicies,
    scheduledAt: new Date(input.now).toISOString(),
    nextRetryAt: new Date(input.now + policy.intervalMinutes * 60_000).toISOString(), state: "waiting",
  });
}

export function retryIsDue(schedule: RetrySchedule, now: number, force = false): boolean {
  return schedule.state === "waiting" && Number.isFinite(now) &&
    now >= Date.parse(schedule.scheduledAt) && (force || now >= Date.parse(schedule.nextRetryAt));
}
