import { describe, expect, it, vi } from "vitest";
const { saved } = vi.hoisted(() => ({ saved: [] as Array<{ id: string; status: string; inputTokens?: number }> }));
vi.mock("../core/store", () => ({
  listActivities: vi.fn(), saveActivity: vi.fn(async (activity: { id: string; status: string; inputTokens?: number }) => {
    if (activity.id === "primo") throw new Error("Scrittura non riuscita.");
    saved.push({ ...activity });
  }),
}));
import { ReviewCallPool, type PooledCall } from "./model-call";
import type { Activity } from "../domain/types";

function entry(id: string, promise: Promise<unknown>): PooledCall {
  const started = { id, bookId: "b", runId: "r", phase: "chapterReview", status: "running", title: id, reason: "", nextStep: "",
    createdAt: new Date().toISOString(), aiRequested: true } as Activity;
  return { key: id, system: "s", user: "u", started, abort: new AbortController(), promise: promise as PooledCall["promise"] };
}

describe("ReviewCallPool.drain", () => {
  it("ferma tutte le chiamate, conserva l'usage osservato e prova ogni registrazione anche se una scrittura fallisce", async () => {
    const pool = new ReviewCallPool();
    const first = entry("primo", Promise.resolve({ text: "x", endpointId: "e", modelId: "m", inputTokens: 5, outputTokens: 2 }));
    const second = entry("secondo", Promise.resolve({ text: "y", endpointId: "e", modelId: "m", inputTokens: 7, outputTokens: 3 }));
    pool.add(first); pool.add(second);
    await expect(pool.drain()).rejects.toThrow("Scrittura non riuscita.");
    expect(first.abort.signal.aborted && second.abort.signal.aborted).toBe(true);
    expect(saved).toEqual([expect.objectContaining({ id: "secondo", status: "cancelled", inputTokens: 7 })]);
    expect(pool.size).toBe(0);
    await expect(pool.drain()).resolves.toBeUndefined();
  });
});
