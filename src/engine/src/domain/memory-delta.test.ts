import { describe, expect, it } from "vitest";
import { applyMemoryResponse, applyTimelineCompaction, assertCompactionShrinks, compactionStage, DELTA_REPLY_RULE,
  DELTA_REPLY_RULE_NO_SUMMARY, memoryNeedsCompaction, withoutRepeatedEvents } from "./memory-delta";
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
    expect(DELTA_REPLY_RULE_NO_SUMMARY).toContain('"timeline":[');
    expect(DELTA_REPLY_RULE).toMatch(/SCHEDA DI STATO/);
    // The format example can never be applied by mistake: it is not valid JSON.
    const example = DELTA_REPLY_RULE.slice(DELTA_REPLY_RULE.indexOf("{"), DELTA_REPLY_RULE.lastIndexOf("}") + 1);
    expect(() => JSON.parse(example)).toThrow();
  });
});

describe("Cronologia senza copie e compattazione a stadi", () => {
  it("non aggiunge di nuovo un evento già registrato, anche con punteggiatura o maiuscole diverse", () => {
    const previous = base();
    previous.timeline = ["Kaza non ruggisce, si sposta di lato a testa bassa"];
    const result = applyMemoryResponse(previous, { mode: "delta", timelineAdd: [
      "kaza non ruggisce si sposta di lato a testa bassa.", "Bomo posa la prima pietra sulla ghiaia",
      "Bomo posa la prima pietra sulla ghiaia!", "Mara arriva", "Mara arriva"] });
    expect(result.memory.timeline).toEqual(["Kaza non ruggisce, si sposta di lato a testa bassa",
      "Bomo posa la prima pietra sulla ghiaia", "Mara arriva", "Mara arriva"]);
  });
  it("toglie gli eventi resi falsi indicati dal modello e poi aggiunge la nuova versione", () => {
    const previous = base();
    previous.timeline = ["Mara arriva", "Kaza zoppica per una ferita alla zampa", "Ivo chiude il porto"];
    const result = applyMemoryResponse(previous, { mode: "delta",
      remove: { timeline: ["kaza zoppica per una ferita alla zampa", "Evento inesistente"] },
      timelineAdd: ["Kaza cammina sano e controlla il suono"] });
    expect(result.memory.timeline).toEqual(["Mara arriva", "Ivo chiude il porto", "Kaza cammina sano e controlla il suono"]);
  });
  it("la compattazione locale toglie solo le copie identiche e tiene la prima", () => {
    const memory = base();
    memory.timeline = ["Bomo allinea le pietre sulla ghiaia", "Mara arriva", "Bomo allinea le pietre sulla ghiaia.",
      "Mara arriva", "BOMO ALLINEA LE PIETRE SULLA GHIAIA"];
    const local = withoutRepeatedEvents(memory);
    expect(local.removed).toBe(2);
    expect(local.memory.timeline).toEqual(["Bomo allinea le pietre sulla ghiaia", "Mara arriva", "Mara arriva"]);
    expect(memory.timeline).toHaveLength(5);
    expect(withoutRepeatedEvents(local.memory).removed).toBe(0);
  });
  it("sceglie prima la cronologia quando è troppo lunga, poi le schede", () => {
    const memory = base();
    expect(compactionStage(memory)).toBe("entries");
    memory.timeline = Array.from({ length: 61 }, (_, i) => "Evento numero " + i + " della storia");
    expect(compactionStage(memory)).toBe("timeline");
  });
  it("sceglie la cronologia anche con pochi eventi se sono loro a pesare più delle schede", () => {
    const memory = base();
    memory.timeline = Array.from({ length: 50 }, (_, i) => `Evento ${i}: ` + "Mara cerca il padre nel porto vecchio. ".repeat(9));
    expect(compactionStage(memory)).toBe("timeline");
    // Within the compacted size the entries are the problem again: no second timeline stage.
    memory.timeline = memory.timeline.slice(0, 40);
    expect(compactionStage(memory)).toBe("entries");
    memory.timeline = Array.from({ length: 50 }, (_, i) => "Evento numero " + i);
    memory.characters = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["P" + i, "x".repeat(800)]));
    expect(compactionStage(memory)).toBe("entries");
  });
  it("accetta una cronologia compattata solo se è davvero più breve e senza numerazione", () => {
    const memory = base();
    memory.timeline = Array.from({ length: 90 }, (_, i) => "Evento numero " + i + " della lunga storia del porto");
    const essential = Array.from({ length: 6 }, (_, i) => "Fase " + (i + 1) + " della ricerca del padre");
    const compacted = applyTimelineCompaction(memory, { timeline: ["1. Mara arriva al porto e incontra Ivo", "2) Ivo chiude il porto", ...essential] });
    expect(compacted.timeline).toEqual(["Mara arriva al porto e incontra Ivo", "Ivo chiude il porto", ...essential]);
    expect(compacted.characters).toEqual(memory.characters);
    expect(memory.timeline).toHaveLength(90);
    expect(() => applyTimelineCompaction(memory, { timeline: ["Mara arriva al porto", "Ivo chiude il porto"] })).toThrow(/almeno 8/);
    expect(() => applyTimelineCompaction(memory, { timeline: [] })).toThrow(/vuota/);
    expect(() => applyTimelineCompaction(memory, { timeline: Array.from({ length: 61 }, (_, i) => "Evento " + i) }))
      .toThrow(/al massimo 40/);
    expect(() => applyTimelineCompaction(memory, { timeline: ["x".repeat(401)] })).toThrow(/400 caratteri/);
    expect(() => applyTimelineCompaction(memory, { events: ["a"] })).toThrow(/timeline/);
  });
  it("una riduzione minore del 15% basta solo se risolve davvero il problema", () => {
    const before = base();
    before.characters = { ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => ["P" + i, "x".repeat(800)])),
      Lungo: "y".repeat(1700) };
    const after = structuredClone(before);
    after.characters.Lungo = "y".repeat(800);
    expect(() => assertCompactionShrinks(before, after)).not.toThrow();
    const stillLong = structuredClone(before);
    stillLong.characters.Lungo = "y".repeat(1500);
    expect(() => assertCompactionShrinks(before, stillLong)).toThrow(/15%/);
    expect(() => assertCompactionShrinks(before, structuredClone(before))).toThrow(/15%/);
  });
});
