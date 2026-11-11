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

  it("interrompe una lettura /models sospesa quando l'autore annulla", async () => {
    const controller = new AbortController();
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({
      cancel(){cancelled=true;},
    });
    const request=vi.fn().mockResolvedValue(new Response(stream,{
      headers:{"content-type":"application/json"},
    }));
    vi.stubGlobal("fetch",request);
    const pending=fetchModels(url,key,controller.signal);
    // The read starts after the mocked fetch headers arrive.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({name:"AbortError"});
    await Promise.resolve();
    expect(cancelled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rispetta la deadline di 12 secondi anche se /models invia gli header ma non termina", async () => {
    vi.useFakeTimers();
    try {
      let cancelled=false;
      const stream=new ReadableStream<Uint8Array>({
        cancel(){cancelled=true;},
      });
      vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(stream,{
        headers:{"content-type":"application/json"},
      })));
      const pending=fetchModels(url,key);
      // Attach the rejection observer before advancing the clock.
      const failure=expect(pending).rejects.toThrow(/Timeout del catalogo modelli/);
      await vi.advanceTimersByTimeAsync(12_001);
      await failure;
      await Promise.resolve();
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("la deadline interrompe anche un fetch che ignora abort prima degli header", async () => {
    vi.useFakeTimers();
    try {
      const request=vi.fn().mockImplementation(()=>new Promise<Response>(()=>{}));
      vi.stubGlobal("fetch",request);
      const pending=fetchModels(url,key);
      const failure=expect(pending).rejects.toThrow(/Timeout del catalogo modelli/);
      await vi.advanceTimersByTimeAsync(12_001);
      await failure;
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("non usa la risposta tardiva dopo timeout e ne cancella lo stream", async () => {
    vi.useFakeTimers();
    try {
      let finishFetch!: (res:Response)=>void;
      const request=vi.fn().mockImplementation(()=>new Promise<Response>(
        resolve=>{finishFetch=resolve;},
      ));
      vi.stubGlobal("fetch",request);
      const pending=fetchModels(url,key);
      const failure=expect(pending).rejects.toThrow(/Timeout del catalogo modelli/);
      await vi.advanceTimersByTimeAsync(12_001);
      await failure;
      let cancelled=false;
      const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
      finishFetch(new Response(stream,{headers:{"content-type":"application/json"}}));
      await Promise.resolve();
      await Promise.resolve();
      expect(cancelled).toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("conserva gli errori di catalogo quando cancel fallisce sincronicamente", async () => {
    for (const failure of ["throw","reject"] as const) {
      const cancel=vi.fn();
      if (failure==="throw")
        cancel.mockImplementation(()=>{throw new Error("segreto del cleanup");});
      else cancel.mockRejectedValue(new Error("segreto del cleanup"));
      const reader={
        read:vi.fn().mockRejectedValue(new Error("contenuto privato")),
        cancel,releaseLock:vi.fn(),
      };
      const response=new Response(null,{headers:{"content-type":"application/json"}});
      Object.defineProperty(response,"body",{value:{getReader:()=>reader}});
      vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response));
      await expect(fetchModels(url,key)).rejects.toThrow(/Catalogo modelli non valido/);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    }
  });

  it("gestisce HTTP 429 e interruzione del chiamante senza divulgare chiavi o body", async () => {
    const rejected=new Response("sk-local-secret-not-in-errors", { status: 429 });
    const cancel=vi.spyOn(rejected.body!, "cancel");
    const requestError=vi.fn().mockResolvedValue(rejected);
    vi.stubGlobal("fetch", requestError);
    let failure: unknown;
    try { await fetchModels(url, key); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/429/);
    expect(JSON.stringify(failure)).not.toContain(key);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(requestError).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(fetchModels(url, key, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
});
