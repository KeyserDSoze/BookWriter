import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "@engine/domain/types";
const { decrypt } = vi.hoisted(() => ({ decrypt: vi.fn() }));
vi.mock("../infrastructure/crypto", () => ({ decryptLocal: decrypt }));
import { callModel } from "@engine/infrastructure/ai";

beforeEach(() => { decrypt.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it("revocation during credential decryption wins before POST, not only before preflight", async () => {
  let release!: (secret: string) => void;
  decrypt.mockReturnValue(new Promise<string>(resolve => { release = resolve; }));
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "synthetic";
  settings.endpoints[0]!.secret = { iv: "test", data: "test" };
  let cancelled = false;
  const result = callModel("brainstorm", "Test", "Test", settings, newBook("Test", "Test", "Test", "Test"),
    new AbortController().signal, { beforeRequest: async () => {
      if (cancelled) throw new DOMException("Retry revocato.", "AbortError");
    } });
  cancelled = true; release("sk-synthetic-never-sent");
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
