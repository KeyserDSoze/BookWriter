import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type EndpointProfile } from "../domain/types";
import { isCurrentModelInventoryRequest } from "./model-inventory";

function fixture() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const endpoint = settings.endpoints[0]!;
  const check = (draft = "new-key", currentDraft = draft, attempt = 1, latest = 1) =>
    isCurrentModelInventoryRequest(endpoint, settings, draft, currentDraft, attempt, latest);
  return { settings, endpoint, check };
}
describe("Fencing cataloghi modello richiesti in precedenza", () => {
  it("accetta solo lo stesso profilo e la stessa chiave della richiesta più recente", () => {
    const {settings, endpoint, check} = fixture();
    expect(check()).toBe(true);
    // An unrelated global router setting does not invalidate this endpoint.
    settings.theme = "dark";
    expect(check()).toBe(true);
    expect(check("new-key", "changed-key")).toBe(false);
    expect(check("new-key", "new-key", 2, 3)).toBe(false);
    expect(check("new-key", "new-key", 0, 0)).toBe(false);
    expect(check("new-key", "new-key", 2, undefined as unknown as number)).toBe(false);
    expect(settings.endpoints[0]).toBe(endpoint);
  });

  it("scarta URL, nome, chiave cifrata o lista manuale alterati, anche se riportati indietro", () => {
    for (const patch of [
      {baseUrl:"https://different.example/v1"},
      {name:"Nuovo profilo"},
      {secret:{iv:"iv-cambiato",data:"dato-cifrato"}},
      {models:["manually-selected"]},
      {baseUrl:"https://api.openai.com/v1"},
    ] satisfies Array<Partial<EndpointProfile>>) {
      const {settings, endpoint, check} = fixture();
      settings.endpoints[0]={...endpoint,...patch};
      expect(check()).toBe(false);
      // Even restoring the same visible values is a distinct edit.
      settings.endpoints[0]=endpoint;
      expect(check()).toBe(true);
    }
  });

  it("scarta endpoint rimossi, anche se un nuovo profilo riusa lo stesso ID", () => {
    const {settings, endpoint, check} = fixture();
    settings.endpoints=[];
    expect(check()).toBe(false);
    settings.endpoints=[{...endpoint}];
    expect(check()).toBe(false);
  });
});
