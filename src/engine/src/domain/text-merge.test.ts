import { describe, expect, it } from "vitest";
import { mergeText3 } from "./text-merge";

const base = ["Apertura.", "Il faro era spento.", "Mara salì le scale.", "Parlò con Elio.", "Chiusura."].join("\n");
describe("fusione a tre vie per righe", () => {
  it("prende il lato cambiato quando l'altro è uguale all'antenato", () => {
    expect(mergeText3(base, base, "Altro")).toBe("Altro");
    expect(mergeText3(base, "Altro", base)).toBe("Altro");
    expect(mergeText3(base, "Stesso", "Stesso")).toBe("Stesso");
  });
  it("unisce modifiche in punti lontani", () => {
    const ours = base.replace("Il faro era spento.", "Il faro era spento da anni.");
    const theirs = base.replace("Chiusura.", "Chiusura, di notte.");
    expect(mergeText3(base, ours, theirs)).toBe(
      ["Apertura.", "Il faro era spento da anni.", "Mara salì le scale.", "Parlò con Elio.", "Chiusura, di notte."].join("\n"));
  });
  it("unisce inserimenti e cancellazioni non sovrapposti", () => {
    const ours = base.replace("Mara salì le scale.\n", "");
    const theirs = base.replace("Apertura.", "Prologo.\nApertura.");
    expect(mergeText3(base, ours, theirs)).toBe(
      ["Prologo.", "Apertura.", "Il faro era spento.", "Parlò con Elio.", "Chiusura."].join("\n"));
  });
  it("modifiche identiche non sono un conflitto", () => {
    const edit = base.replace("Parlò con Elio.", "Parlò con Elio, piano.");
    expect(mergeText3(base, edit, edit)).toBe(edit);
  });
  it("la stessa riga cambiata in due modi è un conflitto", () => {
    expect(mergeText3(base, base.replace("Parlò con Elio.", "Tacque."), base.replace("Parlò con Elio.", "Urlò."))).toBeNull();
  });
  it("righe adiacenti modificate da lati diversi sono un conflitto: nessuna ipotesi", () => {
    expect(mergeText3(base, base.replace("Il faro era spento.", "A"), base.replace("Mara salì le scale.", "B"))).toBeNull();
  });
  it("un testo troppo grande per l'allineamento non viene indovinato", () => {
    const long = Array.from({ length: 2500 }, (_, i) => "riga " + i).join("\n");
    expect(mergeText3(long, long.replace("riga 1\n", "x\n"), long.replace("riga 2000\n", "y\n"))).toBeNull();
  });
});
