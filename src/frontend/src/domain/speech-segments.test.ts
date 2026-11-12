import { describe, expect, it } from "vitest";
import { speechSegments, SPEECH_CHUNK_CHARACTERS, SPEECH_MAX_SCENE_CHARACTERS } from "./speech-segments";

describe("Segmentazione reversibile per la lettura integrale delle scene canoniche",()=>{
  it("non tronca un'intera scena lunga e non perde né duplica caratteri",()=>{
    const input=`  ${"Il testimone torna sul ponte. ".repeat(250)}\nUltima frase.`;
    const chunks=speechSegments(input);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every(chunk=>Array.from(chunk).length<=SPEECH_CHUNK_CHARACTERS)).toBe(true);
    expect(chunks.join("")).toBe(input.trim());
    expect(chunks.join("")).toContain("Ultima frase.");
    expect(chunks.every(chunk=>chunk.length>0)).toBe(true);
  });
  it("conserva punteggiatura e a capo e sceglie i confini tra frasi quando esistono",()=>{
    const input="L'inizio della storia. " + "Seconda frase. ".repeat(7)+
      "\nTerza frase con altre parole per superare un blocco.";
    const chunks=speechSegments(input,64);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(input);
    expect(chunks[0]).toMatch(/[.!?…]$/u);
  });
  it("rispetta i codepoint Unicode e parole senza separatori",()=>{
    const input="🥰💠📚".repeat(450)+" tutti i personaggi.";
    const chunks=speechSegments(input,65);
    expect(chunks.join("")).toBe(input);
    expect(chunks.every(chunk=>Array.from(chunk).length<=65)).toBe(true);
    for(const chunk of chunks)
      expect([...chunk].every(ch=>!/^[\uD800-\uDFFF]$/u.test(ch))).toBe(true);
  });
  it("ignora input vuoto, limita scene estreme e parametri ostili senza troncare",()=>{
    expect(speechSegments("  \n")).toEqual([]);
    expect(()=>speechSegments("a".repeat(SPEECH_MAX_SCENE_CHARACTERS+1)))
      .toThrow(/Scena troppo lunga/);
    for(const size of [0,12,2.5,Infinity,5000])
      expect(()=>speechSegments("testo",size)).toThrow(/Dimensione del blocco/);
  });
});
