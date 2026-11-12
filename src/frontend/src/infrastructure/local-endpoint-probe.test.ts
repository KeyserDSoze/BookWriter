import { afterEach, describe, expect, it, vi } from "vitest";
import { localEndpointTimeoutHint } from "./local-endpoint-probe";
import { ProviderHeaderTimeoutError } from "./ai-header-timeout";

afterEach(() => vi.unstubAllGlobals());

describe("Diagnosi del timeout header su endpoint locale", () => {
  it("se il server risponde a /models lo dichiara occupato, senza credenziali", async () => {
    const fake = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fake);
    const hint = await localEndpointTimeoutHint("http://localhost:1235/v1/");
    expect(hint).toMatch(/risponde alle altre richieste.*occupato/);
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:1235/v1/models");
    expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
  });

  it("se il server non risponde indica accesso alla rete locale, CORS o server spento", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await localEndpointTimeoutHint("http://localhost:1235/v1")).toMatch(/non riesce a raggiungere.*Rete locale/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    expect(await localEndpointTimeoutHint("http://localhost:1235/v1")).toMatch(/non riesce a raggiungere/);
  });

  it("il messaggio del timeout conserva il testo storico e aggiunge la causa", () => {
    const error = new ProviderHeaderTimeoutError(" Causa.");
    expect(error.message).toMatch(/^Tempo scaduto in attesa degli header del provider AI\./);
    expect(error.message.endsWith(" Causa.")).toBe(true);
    expect(error.name).toBe("ProviderHeaderTimeoutError");
  });
});
