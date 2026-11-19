import { describe, expect, it } from "vitest";
import { applyFastCheckRoutes, clearFastCheckRoutes, FAST_CHECK_TASKS } from "./model-routing-preset";
import { DEFAULT_SETTINGS } from "./types";

describe("Preset modello veloce per i controlli", () => {
  it("assegna solo i task di controllo e lascia scrittura, piano e direttore sul predefinito", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.taskRoutes.prose = { endpointId: settings.defaultRoute.endpointId, modelId: "grande" };
    const { taskRoutes } = applyFastCheckRoutes(settings, "piccolo");
    for (const kind of FAST_CHECK_TASKS)
      expect(taskRoutes[kind]).toEqual({ endpointId: settings.defaultRoute.endpointId, modelId: "piccolo" });
    expect(taskRoutes.prose?.modelId).toBe("grande");
    expect(taskRoutes.chapterJudge).toBeUndefined();
    expect(taskRoutes.outline).toBeUndefined();
    expect(settings.taskRoutes.chapterAudit).toBeUndefined();
  });
  it("può togliere il preset senza toccare le altre assegnazioni", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const applied = { ...settings, ...applyFastCheckRoutes(settings, "piccolo") };
    applied.taskRoutes.prose = { endpointId: "x", modelId: "m" };
    const cleared = clearFastCheckRoutes(applied).taskRoutes;
    for (const kind of FAST_CHECK_TASKS) expect(cleared[kind]).toBeUndefined();
    expect(cleared.prose).toEqual({ endpointId: "x", modelId: "m" });
  });
});
