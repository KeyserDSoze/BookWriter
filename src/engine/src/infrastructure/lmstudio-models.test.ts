import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLmStudioReasoningCatalog } from "./lmstudio-models";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
afterEach(() => vi.unstubAllGlobals());

describe("Lettura dei livelli di thinking da LM Studio", () => {
  it("interroga solo /api/v1/models sul loopback, senza credenziali né redirect", async () => {
    const fake = vi.fn(async () => json({ models: [{ type: "llm", key: "muse",
      capabilities: { reasoning: { allowed_options: ["low", "high"], default: "high" } } }] }));
    vi.stubGlobal("fetch", fake);
    await expect(fetchLmStudioReasoningCatalog("http://localhost:1235/v1"))
      .resolves.toEqual({ muse: { options: ["low", "high"], default: "high" } });
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:1235/api/v1/models");
    expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
  });

  it("non contatta host remoti e ignora server che non sono LM Studio", async () => {
    const fake = vi.fn(async () => json({ nope: true }, 404));
    vi.stubGlobal("fetch", fake);
    await expect(fetchLmStudioReasoningCatalog("https://api.openai.com/v1")).resolves.toBeUndefined();
    expect(fake).not.toHaveBeenCalled();
    await expect(fetchLmStudioReasoningCatalog("http://127.0.0.1:1234/v1")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rete"); }));
    await expect(fetchLmStudioReasoningCatalog("http://127.0.0.1:1234/v1")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
    await expect(fetchLmStudioReasoningCatalog("http://127.0.0.1:1234/v1")).resolves.toBeUndefined();
  });
});
