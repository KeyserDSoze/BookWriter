import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, newBook, type AppSettings } from "./types";
import { describeReasoningSupport, reasoningLevelSupported, reasoningSupport } from "./model-reasoning";
import { effectiveReasoningEffort, taskReasoningChoice } from "./task-reasoning";
import { recommendedReasoningPreset } from "./reasoning-presets";
import { parseLmStudioReasoningCatalog } from "../infrastructure/lmstudio-models";

function settingsWith(modelReasoning: NonNullable<AppSettings["endpoints"][number]["modelReasoning"]>, modelId = "muse"): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0] = { ...settings.endpoints[0]!, models: [modelId], modelReasoning };
  settings.defaultRoute = { endpointId: settings.endpoints[0]!.id, modelId };
  return settings;
}

describe("Thinking dichiarato dal modello", () => {
  it("distingue sconosciuto, assente e livelli dichiarati; ignora dati malformati", () => {
    const settings = settingsWith({ muse: { options: ["xhigh", "low", "medium", "high"], default: "high" }, plain: null });
    const endpoint = settings.endpoints[0];
    expect(reasoningSupport(endpoint, "muse")).toEqual({ status: "options", options: ["low", "medium", "high", "xhigh"], default: "high" });
    expect(reasoningSupport(endpoint, "plain")).toEqual({ status: "none" });
    expect(reasoningSupport(endpoint, "other")).toEqual({ status: "unknown" });
    expect(reasoningSupport(undefined, "muse")).toEqual({ status: "unknown" });
    const hostile = settingsWith({ muse: { options: "high" } as never, bad: { options: ["turbo"] } as never });
    expect(reasoningSupport(hostile.endpoints[0], "muse")).toEqual({ status: "unknown" });
    expect(reasoningSupport(hostile.endpoints[0], "bad")).toEqual({ status: "none" });
    expect(reasoningLevelSupported({ status: "none" }, "low")).toBe(false);
    expect(reasoningLevelSupported({ status: "none" }, "automatic")).toBe(true);
    expect(reasoningLevelSupported({ status: "unknown" }, "xhigh")).toBe(true);
    expect(describeReasoningSupport(reasoningSupport(endpoint, "muse"), "muse")).toContain("predefinito: High");
    expect(describeReasoningSupport({ status: "unknown" }, "muse")).toContain("non verificati");
  });

  it("non invia un livello che il modello dichiara di non supportare", () => {
    const settings = settingsWith({ muse: { options: ["low", "medium"] }, plain: null });
    const endpoint = settings.endpoints[0]!;
    const book = newBook("Storia", "Titolo", "Stile", "Audience");
    settings.taskReasoningEfforts = { brainstorm: "xhigh", prose: "low" };
    expect(taskReasoningChoice("brainstorm", settings, book, endpoint, "muse")).toBe("automatic");
    expect(effectiveReasoningEffort("brainstorm", settings, book, endpoint, "muse")).toBeUndefined();
    expect(effectiveReasoningEffort("prose", settings, book, endpoint, "muse")).toBe("low");
    expect(effectiveReasoningEffort("prose", settings, book, endpoint, "plain")).toBeUndefined();
    // Without the routed model id (legacy callers) nothing changes.
    expect(effectiveReasoningEffort("brainstorm", settings, book, endpoint)).toBe("xhigh");
  });

  it("il preset consigliato usa solo i livelli letti dal provider e non tocca i modelli sconosciuti", () => {
    const settings = settingsWith({ muse: { options: ["low", "medium"] } });
    settings.taskRoutes = { chapterJudge: { endpointId: settings.endpoints[0]!.id, modelId: "unknown-model" } };
    settings.taskReasoningEfforts = { chapterJudge: "xhigh", prose: "xhigh" };
    const result = recommendedReasoningPreset(settings);
    expect(result.efforts.prose).toBe("low");
    expect(result.efforts.brainstorm).toBe("medium");
    // The judge wants High but the model tops out at Medium.
    expect(recommendedReasoningPreset(settingsWith({ muse: { options: ["low", "medium"] } })).efforts.chapterJudge).toBe("medium");
    expect(result.efforts.chapterJudge).toBe("xhigh"); // unknown model: untouched
    expect(result.unverified).toBe(1);
    expect(result.applied).toBe(14);
    const none = recommendedReasoningPreset(settingsWith({ muse: null }));
    expect(none.withoutReasoning).toBe(15);
    expect(none.efforts).toEqual({});
  });

  it("legge da LM Studio solo modelli llm con capabilities e scarta dati ostili", () => {
    const parsed = parseLmStudioReasoningCatalog({ models: [
      { type: "llm", key: "meta/muse-glimmer", capabilities: { vision: true,
        reasoning: { allowed_options: ["low", "medium", "high", "xhigh", "turbo"], default: "high" } } },
      { type: "llm", key: "plain", capabilities: { trained_for_tool_use: true } },
      { type: "llm", key: "silent" },
      { type: "embedding", key: "nomic", capabilities: {} },
      { type: "llm", key: "__proto__", capabilities: {} },
      { type: "llm", key: 12, capabilities: {} },
      "x", null,
      { type: "llm", key: "weird-default", capabilities: { reasoning: { allowed_options: ["low"], default: "xhigh" } } },
    ] });
    expect(parsed).toEqual({
      "meta/muse-glimmer": { options: ["low", "medium", "high", "xhigh"], default: "high" },
      plain: null,
      "weird-default": { options: ["low"] },
    });
    expect(parseLmStudioReasoningCatalog({ models: "no" })).toBeUndefined();
    expect(parseLmStudioReasoningCatalog(null)).toBeUndefined();
    expect(parseLmStudioReasoningCatalog({ models: [{ type: "llm", key: "silent" }] })).toBeUndefined();
  });
});
