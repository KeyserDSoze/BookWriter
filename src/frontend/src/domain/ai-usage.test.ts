import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import { summarizeAiUsage, validTokenCount } from "./ai-usage";

const basic = (input: Partial<Activity>): Activity => ({
  id: crypto.randomUUID(), bookId: crypto.randomUUID(), runId: crypto.randomUUID(),
  phase: "prose", title: "Generazione scena", reason: "Test",
  nextStep: "Continuare", createdAt: new Date().toISOString(),
  status: "succeeded",
  ...input,
});
describe("Telemetria AI trasparente, senza costi o crediti inventati", () => {
  it("somma input/output comunicati dai provider e raggruppa per modello ed endpoint", () => {
    const result = summarizeAiUsage([
      basic({ modelId: "Sol", endpointId: "provider-a", inputTokens: 100, outputTokens: 250 }),
      basic({ modelId: "Sol", endpointId: "provider-a", inputTokens: 70, outputTokens: 50 }),
      basic({ modelId: "Luna", endpointId: "provider-b", inputTokens: 300, outputTokens: 20 }),
    ]);
    expect(result.inputTokens).toBe(470);
    expect(result.outputTokens).toBe(320);
    expect(result.totalTokens).toBe(790);
    expect(result.completeReports).toBe(3);
    expect(result.models).toHaveLength(2);
    expect(result.models.find(x => x.modelId === "Sol")?.inputTokens).toBe(170);
    expect(result.models.find(x => x.modelId === "Sol")?.calls).toBe(2);
  });
  it("conteggia esplicitamente report parziali, mancanti e stati non misurati", () => {
    const data = summarizeAiUsage([
      basic({ modelId: "Astra", endpointId: "provider", inputTokens: 23 }),
      basic({ modelId: "Astra", endpointId: "provider" }),
      basic({ modelId: "Astra", endpointId: "provider", status: "running" }),
      basic({ status: "failed", modelId: "Astra", endpointId: "provider" }),
      basic({ status: "cancelled", title: "Chiamata interrotta" }),
      basic({ status: "succeeded", phase: "revision", title: "Revisione approvata dall'autore" }),
    ]);
    expect(data.inputTokens).toBe(23);
    expect(data.outputTokens).toBe(0);
    expect(data.completeReports).toBe(0);
    expect(data.partialReports).toBe(1);
    expect(data.missingReports).toBe(2);
    expect(data.completedCalls).toBe(3);
    expect(data.runningActivities).toBe(1);
    expect(data.failedActivities).toBe(1);
    expect(data.interruptedActivities).toBe(1);
  });
  it("non attribuisce token fittizi a dati non validi o inventa un saldo", () => {
    expect(validTokenCount(-1)).toBeUndefined();
    expect(validTokenCount(1.5)).toBeUndefined();
    expect(validTokenCount(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(validTokenCount(Number.NaN)).toBeUndefined();
    expect(validTokenCount("123")).toBeUndefined();
    expect(validTokenCount(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
    expect(validTokenCount(0)).toBe(0);
    const result = summarizeAiUsage([
      basic({ modelId: "Sol", inputTokens: -100, outputTokens: Number.NaN }),
      basic({ modelId: "Sol", inputTokens: 0, outputTokens: 0 }),
    ]);
    expect(result.totalTokens).toBe(0);
    expect(result.completeReports).toBe(1);
    expect(result.missingReports).toBe(1);
    expect(Object.keys(result)).not.toContain("creditsRemaining");
    expect(Object.keys(result)).not.toContain("cost");
  });
  it("non somma attività manuali prive di dati di fatturazione del provider", () => {
    const result = summarizeAiUsage([
      basic({ title: "Conferma editoriale della scena", phase: "review" }),
      basic({ title: "Sync GitHub", phase: "review" }),
    ]);
    expect(result.models).toEqual([]);
    expect(result.completedCalls).toBe(0);
  });
});
