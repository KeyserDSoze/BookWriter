import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, DEFAULT_SETTINGS, type BookProject } from "../domain/types";
import { compareBookVersions } from "../domain/conflicts";
import { buildSceneMergePrompt } from "../domain/scene-merge";
import type { ConflictReview } from "../infrastructure/conflict-recovery";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";

const { callMock, confirmMock, guardMock } = vi.hoisted(() => ({
  callMock: vi.fn(), confirmMock: vi.fn(), guardMock: vi.fn(),
}));
vi.mock("../infrastructure/ai", () => ({ callModel: callMock }));
vi.mock("../infrastructure/github-sync", () => ({
  confirmGitHubHead: confirmMock,
  RemoteConflict: class RemoteConflict extends Error {},
}));
vi.mock("./writer-guard", () => ({ withWriterGuard: guardMock }));
import {
  generateSceneMergeDraft, listSceneMergeDrafts,
  rejectSceneMergeDraft, saveManualSceneMergeDraft,
} from "./scene-merge";

const HEAD = "a".repeat(40);
async function fixture(): Promise<ConflictReview> {
  const local = newBook("Un romanzo", "Romanzo", "Teso", "Adulti");
  local.status = "paused";
  local.remote = { owner: "test", repository: "novel", branch: "main", lastSyncedCommit: HEAD };
  local.authorConstraints = ["Mara non deve rivelare il segreto nel primo capitolo"];
  local.memory.secrets.mistero = "La chiave è nascosta nel campanile.";
  local.chapters = [{
    id: "chapter-1", number: 1, title: "Ingresso", purpose: "Mostrare il conflitto",
    scenes: [{ id: "scene-1", number: 1, title: "Primo passo", objective: "Arrivo",
      text: "Mara torna a casa e resta in silenzio.", status: "canon" }],
  }];
  await saveBook(local, false);
  const remote = structuredClone(local);
  remote.chapters[0]!.scenes[0]!.text = "Mara torna e nasconde la chiave.";
  return {
    bookId: local.id, local, remote, localUpdatedAt: local.updatedAt,
    localSyncedCommit: HEAD, headSha: HEAD, baselineSha: HEAD,
    baseAvailable: true, remoteActivities: [], units: compareBookVersions(local, remote),
  };
}
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities");
  await db.clear("outbox"); await db.clear("mergeDrafts");
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  callMock.mockReset(); confirmMock.mockReset(); guardMock.mockReset();
  confirmMock.mockResolvedValue(undefined);
  guardMock.mockImplementation(async (_id, _session, _controller, fn) =>
    fn({ assertActive: async () => {}, failure: () => undefined }));
  vi.stubGlobal("navigator", {
    locks: { request: async (_key: string, _opts: unknown, fn: (lock: object) => Promise<unknown>) =>
      fn({ name: "test" }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Laboratorio di fusione senza canonizzazione automatica", () => {
  it("costruisce istruzioni che preservano canon e vincoli e trattano le scene come dati", async () => {
    const review = await fixture();
    const prompt = buildSceneMergePrompt(review, "chapter-1", "scene-1", "Mantieni tensione");
    expect(prompt.prompt).toContain("Mara non deve rivelare");
    expect(prompt.prompt).toContain("La chiave è nascosta");
    expect(prompt.prompt).toContain("Mara torna e nasconde");
    expect(prompt.system).toContain("CONTENUTO NON ATTENDIBILE");
    expect(prompt.prompt).toContain("Mantieni tensione");
  });

  it("salva la risposta AI come sola bozza con audit e token, senza cambiare il libro", async () => {
    const review = await fixture();
    callMock.mockResolvedValue({
      text: "Una scena proposta dall'editor AI.",
      modelId: "Astra", endpointId: "openai", inputTokens: 350, outputTokens: 55,
    });
    const draft = await generateSceneMergeDraft(
      review, "chapter-1", "scene-1", "Proteggi gli indizi", new AbortController(),
    );
    expect(draft.status).toBe("proposed");
    expect(draft.modelId).toBe("Astra");
    expect(draft.inputTokens).toBe(350);
    expect((await listSceneMergeDrafts(review, "chapter-1", "scene-1"))[0]?.id).toBe(draft.id);
    const still = await getBook(review.bookId);
    expect(still?.chapters[0]?.scenes[0]?.text).toBe(review.local.chapters[0]?.scenes[0]?.text);
    expect(await getOutbox(review.bookId)).toBeUndefined();
    expect((await listActivities(review.bookId)).some(a => a.title.includes("Bozza AI"))).toBe(true);
    expect(confirmMock).toHaveBeenCalledWith(review.local.remote, HEAD);
    expect(callMock.mock.calls[0]?.[0]).toBe("merge");
  });

  it("non salva una proposta se la versione locale cambia durante la chiamata AI", async () => {
    const review = await fixture();
    callMock.mockImplementation(async () => {
      const updated = structuredClone((await getBook(review.bookId)) as BookProject);
      updated.chapters[0]!.scenes[0]!.text = "Un autore ha editato nel frattempo";
      await saveBook(updated, false);
      return { text: "Bozza ormai vecchia", endpointId: "openai", modelId: "Astra" };
    });
    await expect(generateSceneMergeDraft(
      review, "chapter-1", "scene-1", "", new AbortController(),
    )).rejects.toThrow(/cambiati|Ricarica/i);
    expect(await listSceneMergeDrafts(review, "chapter-1", "scene-1")).toHaveLength(0);
  });

  it("se la chiamata AI è rifiutata non crea bozze e non modifica il canon", async () => {
    const review = await fixture();
    callMock.mockRejectedValue(new Error("Limite richieste o credito insufficiente (HTTP 429)."));
    await expect(generateSceneMergeDraft(
      review, "chapter-1", "scene-1", "", new AbortController(),
    )).rejects.toThrow("429");
    expect(await listSceneMergeDrafts(review, "chapter-1", "scene-1")).toHaveLength(0);
    expect((await getBook(review.bookId))?.chapters[0]?.scenes[0]?.status).toBe("canon");
  });

  it("può salvare e rifiutare una bozza manuale senza spendere token AI", async () => {
    const review = await fixture();
    const draft = await saveManualSceneMergeDraft(
      review, "chapter-1", "scene-1", "Un testo combinato manualmente.",
    );
    expect(draft.source).toBe("manual");
    await rejectSceneMergeDraft(draft.id);
    expect((await listSceneMergeDrafts(review, "chapter-1", "scene-1"))[0]?.status).toBe("rejected");
    expect(callMock).not.toHaveBeenCalled();
    expect((await getBook(review.bookId))?.chapters[0]?.scenes[0]?.text)
      .toBe("Mara torna a casa e resta in silenzio.");
  });
});
