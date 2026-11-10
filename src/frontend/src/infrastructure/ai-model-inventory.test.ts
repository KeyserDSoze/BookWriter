import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels } from "./ai";

const url = "https://models.example.test/v1";
const key = "sk-local-secret-not-in-errors";
function reply(data: unknown, headers: Record<string,string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { "content-type": "application/json", ...headers },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("Inventario modelli AI non attendibile", () => {
  it("ordina e deduplica gli ID validi senza inviare cookie o consentire redirect", async () => {
    const request = vi.fn().mockResolvedValue(reply({
      data: [{ id: "zeta" }, { id: "alpha" }, { id: "zeta" }],
    }));
    vi.stubGlobal("fetch", request);
    expect(await fetchModels(url, key)).toEqual(["alpha", "zeta"]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe(url + "/models");
    const options = request.mock.calls[0]![1] as RequestInit;
    expect(options).toMatchObject({
      method: "GET", mode: "cors", credentials: "omit",
      redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
    });
    expect(options.headers).toEqual({ Authorization: "Bearer " + key });
  });

  it("rifiuta cataloghi vuoti, envelope falsi e righe malformate senza valori parziali", async () => {
    const bad = [
      {}, null, [], { data: null }, { data: [] }, { data: [null] },
      { data: [42] }, { data: ["text"] },
      { data: [{ id: 17 }] }, { data: [{ id: {} }] },
      { data: [{ id: "" }] }, { data: [{ id: "   " }] },
      { data: [{ id: " leading" }] }, { data: [{ id: "a\nb" }] },
      { data: [{ id: "a\u0000b" }] }, { data: [{ id: "x".repeat(257) }] },
      { data: [{ id: "valid" }, { id: null }] },
      { data: Array.from({ length: 2_001 }, () => ({ id: "valid" })) },
    ];
    for (const payload of bad) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(payload)));
      await expect(fetchModels(url, key)).rejects.toThrow(/Catalogo modelli non valido/);
    }
  });

  it("rifiuta JSON corrotto, mime HTML e risposte senza streaming limitabile", async () => {
    for (const response of [
      new Response("{invalid", { status: 200, headers: { "content-type": "application/json" } }),
      new Response("<html>secret</html>", { status: 200, headers: { "content-type": "text/html" } }),
      new Response(null, { status: 200 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(fetchModels(url, key)).rejects.toThrow(/Catalogo modelli non valido/);
    }
  });

  it("blocca prima della lettura un Content-Length troppo grande", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({
      data: [{ id: "model" }],
    }, { "content-length": "500000" })));
    await expect(fetchModels(url, key)).rejects.toThrow(/troppo grande/);
  });

  it("blocca lo stream oltre il limite anche con header Content-Length assente o falso", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(180_000));
        controller.enqueue(new Uint8Array(90_000));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, {
      status: 200, headers: { "content-type": "application/json", "content-length": "1" },
    })));
    await expect(fetchModels(url, key)).rejects.toThrow(/troppo grande/);
  });

  it("gestisce HTTP 429 e interruzione del chiamante senza divulgare chiavi o body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "sk-local-secret-not-in-errors", { status: 429 },
    )));
    let failure: unknown;
    try { await fetchModels(url, key); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/429/);
    expect(JSON.stringify(failure)).not.toContain(key);
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(fetchModels(url, key, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
});
