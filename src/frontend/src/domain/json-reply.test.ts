import { describe, expect, it } from "vitest";
import { parseJsonReply } from "./json-reply";

const fence = "`".repeat(3);

describe("parseJsonReply", () => {
  it("accetta JSON puro e JSON dentro un blocco di codice", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply(`${fence}json\n{"a":1}\n${fence}`)).toEqual({ a: 1 });
  });
  it("ignora testo aggiunto dopo il JSON (errore «non-whitespace character after JSON»)", () => {
    expect(parseJsonReply('{"a":1}\n\nSpero che vada bene.')).toEqual({ a: 1 });
    expect(parseJsonReply('{"a":1}{"b":2}')).toEqual({ a: 1 });
  });
  it("ignora testo prima del JSON e un blocco di codice chiuso male", () => {
    expect(parseJsonReply('Ecco la memoria aggiornata:\n{"a":[1,2]}')).toEqual({ a: [1, 2] });
    expect(parseJsonReply(`${fence}json\n{"a":1}\nNota finale`)).toEqual({ a: 1 });
  });
  it("non si confonde con parentesi e virgolette dentro le stringhe", () => {
    expect(parseJsonReply('{"t":"chiude } qui \\" e [ qui"} extra')).toEqual({ t: 'chiude } qui " e [ qui' });
  });
  it("salta graffe di prosa che non sono JSON", () => {
    expect(parseJsonReply('Ragiono su {questo} e poi {"a":1}')).toEqual({ a: 1 });
  });
  it("fallisce con l'errore originale se non c'è nessun JSON valido", () => {
    expect(() => parseJsonReply("nessun json qui")).toThrow(SyntaxError);
    expect(() => parseJsonReply('{"a":')).toThrow(SyntaxError);
  });
});
