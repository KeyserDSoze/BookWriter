import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type TaskKind } from "../domain/types";

const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner, MAX_LOCAL_AUTO_RETRIES } from "./autopilot";

async function setup(options: { retry: boolean; local: boolean }) {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0] = { ...settings.endpoints[0]!, baseUrl: "http://localhost:1234/v1", secret: null,
    authMode: options.local ? "none" : "api_key", localAutoRetry: options.retry };
  await saveSettings(settings);
  const book = newBook("Due scimmie e un leone.", "La favola", "Ironico", "Bambini");
  book.status = "paused";
  await saveBook(book, false);
  return book;
}
beforeEach(() => {
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_b, _r, _c, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
});
const ok = (text: string) => ({ text, endpointId: "openai", modelId: "m", inputTokens: 1, outputTokens: 1 });

describe("Ritentativo automatico limitato su endpoint locale", () => {
  it("riprova lo stesso task dopo un errore e poi prosegue senza fermarsi in errore", async () => {
    const book = await setup({ retry: true, local: true });
    const runner = new AutopilotRunner();
    let n = 0;
    modelCall.mockImplementation(async (_kind: TaskKind) => {
      n++;
      if (n <= 2) throw new Error("Il provider non ha inviato dati per troppo tempo.");
      runner.stopAfterCurrent();
      return ok("Idee LONG MID SHORT");
    });
    await runner.run(book.id, async () => undefined);
    expect(modelCall).toHaveBeenCalledTimes(3);
    const saved = (await getBook(book.id))!;
    expect(saved.phase).toBe("validate");
    expect(saved.status).toBe("paused");
    const statuses = (await listActivities(book.id)).filter(a => a.aiRequested)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(a => a.status);
    expect(statuses).toEqual(["failed", "failed", "succeeded"]);
  });

  it("si ferma in errore dopo il numero massimo di tentativi", async () => {
    const book = await setup({ retry: true, local: true });
    modelCall.mockRejectedValue(new Error("rete"));
    await new AutopilotRunner().run(book.id, async () => undefined);
    expect(modelCall).toHaveBeenCalledTimes(1 + MAX_LOCAL_AUTO_RETRIES);
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.phase).toBe("brainstorm");
  });

  it("non ritenta senza consenso né su endpoint con chiave (possibile addebito)", async () => {
    for (const options of [{ retry: false, local: true }, { retry: true, local: false }]) {
      modelCall.mockReset();
      const book = await setup(options);
      modelCall.mockRejectedValue(new Error("rete"));
      await new AutopilotRunner().run(book.id, async () => undefined);
      expect(modelCall).toHaveBeenCalledTimes(1);
      expect((await getBook(book.id))!.status).toBe("error");
    }
  });
});
