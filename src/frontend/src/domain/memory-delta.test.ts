import { describe, expect, it } from "vitest";
import { applyMemoryResponse, assertCompactionShrinks, DELTA_REPLY_RULE, DELTA_REPLY_RULE_NO_SUMMARY,
  memoryNeedsCompaction } from "./memory-delta";
import { newBook } from "./types";

const base = () => {
  const memory = structuredClone(newBook("T", "B", "S", "A").memory);
  memory.characters = { Mara: "Spaventata", Ivo: "Guardiano" };
  memory.secrets = { chiave: "Apre la stanza segreta" };
  memory.timeline = ["Mara arriva"];
  memory.currentState = "Inizio";
  return memory;
};

describe("Aggiornamento della memoria a delta", () => {
  it("fonde modifiche, rimozioni, timeline e riassunto senza toccare ciò che non cambia", () => {
    const previous = base();
    const result = applyMemoryResponse(previous, {
      mode: "delta", sceneSummary: "Mara scopre la chiave e la nasconde a Ivo.",
      characters: { Mara: "Decisa", Lena: "Nuova alleata" }, remove: { characters: ["Ivo"] },
      secrets: { chiave: "Nascosta da Mara" }, timelineAdd: ["Mara nasconde la chiave"], currentState: "Tensione",
    });
    expect(result.mode).toBe("delta");
    expect(result.sceneSummary).toMatch(/Mara scopre/);
    expect(result.memory.characters).toEqual({ Mara: "Decisa", Lena: "Nuova alleata" });
    expect(result.memory.secrets.chiave).toBe("Nascosta da Mara");
    expect(result.memory.timeline).toEqual(["Mara arriva", "Mara nasconde la chiave"]);
    expect(result.memory.currentState).toBe("Tensione");
    expect(previous.characters.Ivo).toBe("Guardiano");
  });
  it("un delta vuoto lascia la memoria invariata e il formato completo resta accettato", () => {
    const previous = base();
    expect(applyMemoryResponse(previous, { mode: "delta" }).memory).toEqual(previous);
    const full = { characters: { A: "x" }, locations: {}, factions: {}, items: {}, secrets: {}, timeline: ["e"],
      currentState: "s", sceneSummary: "Riassunto della scena molto breve ma valido." };
    const result = applyMemoryResponse(previous, full);
    expect(result.mode).toBe("full");
    expect(result.memory.characters).toEqual({ A: "x" });
    expect(result.sceneSummary).toMatch(/Riassunto/);
  });
  it("rifiuta voci troppo lunghe, chiavi pericolose e risposte malformate senza troncare", () => {
    const previous = base();
    expect(() => applyMemoryResponse(previous, { mode: "delta", characters: { Mara: "x".repeat(901) } })).toThrow();
    const hostile = applyMemoryResponse(previous, JSON.parse('{"mode":"delta","characters":{"__proto__":"x","Ok":"y"}}'));
    expect(Object.prototype.hasOwnProperty.call(hostile.memory.characters, "__proto__")).toBe(false);
    expect(hostile.memory.characters.Ok).toBe("y");
    expect(() => applyMemoryResponse(previous, { mode: "delta", timelineAdd: "evento" })).toThrow();
    expect(() => applyMemoryResponse(previous, { characters: {} })).toThrow();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it("segnala quando la memoria è troppo grande e pretende che la compattazione riduca davvero", () => {
    const big = base();
    expect(memoryNeedsCompaction(big)).toBe(false);
    big.characters = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["P" + i, "x".repeat(450)]));
    expect(memoryNeedsCompaction(big)).toBe(true);
    const slightly = structuredClone(big);
    delete slightly.characters.P0;
    expect(() => assertCompactionShrinks(big, slightly)).toThrow(/15%/);
    const small = base();
    expect(() => assertCompactionShrinks(big, small)).not.toThrow();
  });
  it("le istruzioni al modello descrivono il formato delta", () => {
    expect(DELTA_REPLY_RULE).toContain('"mode":"delta"');
    expect(DELTA_REPLY_RULE).toContain("sceneSummary");
    expect(DELTA_REPLY_RULE_NO_SUMMARY).not.toContain("sceneSummary");
  });
});
