import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings, type ModelCapability } from "./types";
import {
  assertChatModelCapability, assertModelCapabilitySettings,
  declaredModelCapabilities, withModelCapability,
} from "./model-capabilities";

function fixture(): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0] = {
    ...settings.endpoints[0]!, baseUrl: "http://localhost:1234/v1",
    authMode: "none", models: ["chat-model", "voice-model", "embedding-model"],
  };
  return settings;
}
describe("Ruoli manuali per modello", () => {
  it("consente tag multipli, senza mutare il profilo e senza deduzioni da /models", () => {
    const settings=fixture(), original=settings.endpoints[0]!;
    expect(declaredModelCapabilities(original,"voice-model")).toEqual([]);
    const chat=withModelCapability(original,"chat-model","chat",true);
    const both=withModelCapability(chat,"chat-model","tools",true);
    expect(declaredModelCapabilities(both,"chat-model")).toEqual(["chat","tools"]);
    expect(original.modelCapabilities).toBeUndefined();
    expect(declaredModelCapabilities(both,"embedding-model")).toEqual([]);
    const onlyTools=withModelCapability(both,"chat-model","chat",false);
    expect(declaredModelCapabilities(onlyTools,"chat-model")).toEqual(["tools"]);
    const empty=withModelCapability(onlyTools,"chat-model","tools",false);
    expect(empty.modelCapabilities).toBeUndefined();
  });
  it("conserva il router chat legacy e supporta i predefiniti indipendenti",()=>{
    const settings=fixture();
    settings.defaultRoute={endpointId:"openai",modelId:"chat-model"};
    assertModelCapabilitySettings(settings); // Legacy no tags.
    let endpoint=settings.endpoints[0]!;
    endpoint=withModelCapability(endpoint,"chat-model","chat",true);
    endpoint=withModelCapability(endpoint,"chat-model","tools",true);
    endpoint=withModelCapability(endpoint,"voice-model","voice",true);
    endpoint=withModelCapability(endpoint,"embedding-model","embedding",true);
    settings.endpoints=[endpoint];
    settings.capabilityRoutes={
      tools:{endpointId:"openai",modelId:"chat-model"},
      voice:{endpointId:"openai",modelId:"voice-model"},
      embedding:{endpointId:"openai",modelId:"embedding-model"},
    };
    assertModelCapabilitySettings(settings);
    expect(settings.defaultRoute.modelId).toBe("chat-model");
    expect(settings.capabilityRoutes.voice!.modelId).toBe("voice-model");
    expect(settings.capabilityRoutes.embedding!.modelId).toBe("embedding-model");
    expect(settings.capabilityRoutes.tools!.modelId).toBe("chat-model");
  });
  it("blocca un modello esplicitamente non chat prima del provider",()=>{
    const settings=fixture();
    const endpoint=withModelCapability(settings.endpoints[0]!,"voice-model","voice",true);
    expect(()=>assertChatModelCapability(endpoint,"voice-model"))
      .toThrow(/non è contrassegnato per Chat/);
    expect(()=>assertChatModelCapability(endpoint,"chat-model")).not.toThrow();
    settings.endpoints=[endpoint];
    settings.defaultRoute={endpointId:"openai",modelId:"voice-model"};
    expect(()=>assertModelCapabilitySettings(settings)).toThrow(/non è contrassegnato/);
  });
  it("non considera validi predefiniti non taggati, endpoint sconosciuti o ruoli sconosciuti",()=>{
    const settings=fixture();
    const r={endpointId:"openai",modelId:"voice-model"};
    settings.capabilityRoutes={voice:r};
    expect(()=>assertModelCapabilitySettings(settings)).toThrow(/non possiede il tag/);
    settings.endpoints=[withModelCapability(settings.endpoints[0]!,"voice-model","voice",true)];
    assertModelCapabilitySettings(settings);
    settings.capabilityRoutes={voice:{endpointId:"missing",modelId:"voice-model"}};
    expect(()=>assertModelCapabilitySettings(settings)).toThrow(/non possiede il tag/);
    settings.capabilityRoutes={speech:r} as unknown as AppSettings["capabilityRoutes"];
    expect(()=>assertModelCapabilitySettings(settings)).toThrow(/Predefiniti dei modelli non validi/);
  });
  it("rifiuta tag ostili, duplicati e ID con controllo prima della persistenza",()=>{
    const settings=fixture();
    const bad: unknown[] = [null, [], {"model":["chat","chat"]},
      {"model":["audio"]}, {"model":[]}, {" bad ":["chat"]},
      {"evil\nname":["voice"]}];
    for(const value of bad){
      settings.endpoints[0]!.modelCapabilities=value as Record<string,ModelCapability[]>;
      expect(()=>assertModelCapabilitySettings(settings)).toThrow(/Tag dei modelli non validi/);
    }
  });
});
