import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "../domain/types";
import { createEditorialCycle } from "../domain/editorial-board";

// A writer/import can commit AFTER the runner's post-provider getBook and
// BEFORE the AI transaction. Web Locks do not protect against all imports.
const hooks = vi.hoisted(() => ({
  injectOnce: false,
  savedToken: undefined as string | undefined,
  attemptedSuccesses: 0,
  competitorText: "SEGRETO NUOVO DELL'AUTORE - NON DIVULGARE",
}));
const { modelCall, writerGuard } = vi.hoisted(() => ({
  modelCall: vi.fn(), writerGuard: vi.fn(),
}));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
vi.mock("../infrastructure/db", async importOriginal => {
  const real = await importOriginal<typeof import("../infrastructure/db")>();
  return {
    ...real,
    saveBookAndActivity: async (...args: Parameters<typeof real.saveBookAndActivity>) => {
      if (args[1].status === "succeeded") {
        hooks.attemptedSuccesses++;
        hooks.savedToken = args[2];
        if (hooks.injectOnce) {
          hooks.injectOnce = false;
          const changed = await real.getBook(args[0].id);
          if (!changed) throw new Error("Fixture concorrente mancante");
          changed.memory.secrets.chiave = hooks.competitorText;
          changed.status = "paused"; // an author has explicitly stopped the run
          await real.saveBook(changed, false);
        }
      }
      return real.saveBookAndActivity(...args);
    },
  };
});
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner } from "./autopilot";

function book(): BookProject {
  const b = newBook("Una storia di un castello.", "Romanzo", "Sobrio", "Adulti");
  b.phase = "chapterReview";
  b.status = "paused";
  b.memory.secrets.chiave = "La chiave apre il varco originale.";
  b.chapters = [{
    id: "ch-1", number: 1, title: "Il castello", purpose: "Inizio",
    scenes: [{
      id: "scene-1", number: 1, title: "Ingresso", objective: "Presentazione",
      text: "Mara saluta il guardiano e passa la porta.",
      status: "canon",
    }],
  }];
  b.editorialCycle = createEditorialCycle("ch-1");
  return b;
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  hooks.injectOnce = false; hooks.savedToken = undefined; hooks.attemptedSuccesses = 0;
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_bookId, _runId, _controller, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
});

describe("Commit CAS delle risposte AI nel runner", () => {
  it("non sovrascrive canone, stop autore, segreti o outbox quando la revisione cambia prima del commit", async () => {
    const initial = book();
    await saveBook(initial, false);
    hooks.injectOnce = true;
    modelCall.mockResolvedValue({
      text: JSON.stringify({
        verdict: "pass",
        summary: "Il revisore non ha trovato rilievi nella scena.",
        memoryNote: "La scena è stata letta senza osservazioni.",
        findings: [],
      }),
      endpointId: "test", modelId: "Audit", inputTokens: 80, outputTokens: 34,
    });
    await new AutopilotRunner().run(initial.id, async () => undefined);
    const current = (await getBook(initial.id))!;
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(hooks.attemptedSuccesses).toBe(1);
    expect(hooks.savedToken).toEqual(expect.any(String));
    expect(current.updatedAt).not.toBe(hooks.savedToken);
    expect(current.status).toBe("paused");
    expect(current.memory.secrets.chiave).toBe(hooks.competitorText);
    expect(current.editorialCycle).toMatchObject({ stage: "review", reports: [] });
    expect(current.chapters[0]!.scenes[0]!.status).toBe("canon");
    expect(current.chapters[0]!.frozenAt).toBeUndefined();
    expect(await (await getDb()).getAll("outbox")).toHaveLength(0);
    const attempts = (await listActivities(initial.id)).filter(a => a.aiRequested);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "cancelled", aiRequested: true,
      inputTokens: 80, outputTokens: 34,
    });
    expect(attempts[0]!.error).toMatch(/libro è cambiato durante il salvataggio AI/);
    expect(attempts[0]!.error).not.toContain(hooks.competitorText);
    expect(attempts[0]!.output).toBeUndefined();
    expect(attempts[0]!.summary).toBeUndefined();
  });
});
