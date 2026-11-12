import { describe, expect, it } from "vitest";
import { assertScenePlausible } from "./prose-sanity";

describe("Sanità della prosa generata", () => {
  it("accetta prosa normale, anche breve, e rifiuta vuoto, JSON e blocchi di codice", () => {
    expect(() => assertScenePlausible("Mara aprì la porta.")).not.toThrow();
    expect(() => assertScenePlausible("   ")).toThrow(/vuota/);
    expect(() => assertScenePlausible('{"scene":"x"}')).toThrow(/JSON/);
    expect(() => assertScenePlausible("```\ntesto\n```")).toThrow(/codice/);
    expect(() => assertScenePlausible("[Mara] parlò piano.")).not.toThrow();
  });
  it("rifiuta riscritture che perdono più della metà di una scena lunga", () => {
    const draft = "Il fantasma volò sopra il fiume. ".repeat(40);
    expect(() => assertScenePlausible(draft.slice(0, 500), draft)).toThrow(/più corta/);
    expect(() => assertScenePlausible(draft.slice(0, 900), draft)).not.toThrow();
    expect(() => assertScenePlausible("breve", "bozza corta")).not.toThrow();
  });
});
