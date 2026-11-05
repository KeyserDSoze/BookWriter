import { describe, expect, it } from "vitest";
import { diffSceneText } from "./scene-diff";

describe("Diff testuale mobile-safe", () => {
  it("mostra inserimenti ed eliminazioni senza perdere le parole o gli spazi", () => {
    const local = "Mara apre la porta. Poi fugge.";
    const remote = "Mara apre lentamente la porta. Poi resta.";
    const result = diffSceneText(local, remote);
    expect(result.mode).toBe("words");
    expect(result.pieces.filter(x => x.kind !== "remote").map(x => x.text).join("")).toBe(local);
    expect(result.pieces.filter(x => x.kind !== "local").map(x => x.text).join("")).toBe(remote);
    expect(result.pieces.some(x => x.kind === "remote" && x.text.includes("lentamente"))).toBe(true);
    expect(result.pieces.some(x => x.kind === "local" && x.text.includes("fugge"))).toBe(true);
  });
  it("non modifica una scena identica", () => {
    expect(diffSceneText("Nessuna differenza.", "Nessuna differenza.").pieces)
      .toEqual([{ kind: "same", text: "Nessuna differenza." }]);
  });
  it("usa il fallback per paragrafi su testi lunghi evitando matrici enormi", () => {
    const local = "Paragrafo 1\n\n" + "x ".repeat(1200) + "\n\nUltimo";
    const remote = "Paragrafo 1\n\n" + "y ".repeat(1200) + "\n\nUltimo";
    const result = diffSceneText(local, remote);
    expect(result.fallback).toBe(true);
    expect(result.pieces.filter(x => x.kind !== "remote").map(x => x.text).join("")).toBe(local);
    expect(result.pieces.filter(x => x.kind !== "local").map(x => x.text).join("")).toBe(remote);
  });
  it("non prova diff quadratici quando la scena ha più di 240 blocchi", () => {
    const local = Array.from({ length: 350 }, (_, i) => "Riga " + i + "\n\n").join("");
    const remote = local.replace("Riga 200", "Riga DUECENTO");
    const result = diffSceneText(local, remote);
    expect(result.mode).toBe("whole");
    expect(result.pieces[0]?.kind).toBe("local");
    expect(result.pieces[1]?.kind).toBe("remote");
  });
});
