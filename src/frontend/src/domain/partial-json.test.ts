import { describe, expect, it } from "vitest";
import { entryOf, finalText, openLeaf, parsePartialJson, type PartialNode } from "./partial-json";

/** Plain value of a node, to compare with JSON.parse once everything has arrived. */
function plain(node: PartialNode): unknown {
  switch (node.type) {
    case "string": case "number": case "literal": return node.value;
    case "array": return node.items.map(plain);
    case "object": return Object.fromEntries(node.entries.map(entry => [entry.key, plain(entry.value)]));
  }
}
/** Every finished subtree, keyed by where it is. */
function finished(node: PartialNode, path = "", into = new Map<string, string>()): Map<string, string> {
  if (node.done) into.set(path, JSON.stringify(plain(node)));
  if (node.type === "array") node.items.forEach((item, index) => finished(item, `${path}/${index}`, into));
  if (node.type === "object") node.entries.forEach((entry, index) => finished(entry.value, `${path}/${index}:${entry.key}`, into));
  return into;
}

const SAMPLE = JSON.stringify({
  verdict: "issues", summary: "Due problemi: un cliché e una svista sull'ora. È \"importante\".\nVa a capo.",
  findings: [
    { sceneId: "scene:001:002", category: "Cliché", severity: "minor", evidence: "Il sole tramontava", reason: "Immagine abusata, perché \\ e / e \u00e8 e 😀", remediation: "Variare l'immagine." },
    { sceneId: "scene:001:003", category: "Cronologia", severity: "critical", evidence: "Alle tre del mattino", reason: "Contraddice l'alba.", remediation: "Spostare l'ora.", ratio: 0.5, n: -12, ok: true, none: null },
  ],
  memoryNote: "Mara non sa ancora della lettera.", nested: { a: [[1, 2], [3]], b: {} },
}, null, 2);

describe("lettura tollerante di un JSON ancora in scrittura", () => {
  it("a testo completo coincide con JSON.parse", () => {
    const root = parsePartialJson(SAMPLE)!;
    expect(root.done).toBe(true);
    expect(plain(root)).toEqual(JSON.parse(SAMPLE));
  });
  it("in qualunque punto lo si tagli non lancia mai e ciò che è finito non cambia più", () => {
    const seen = new Map<string, string>();
    for (let end = 0; end <= SAMPLE.length; end++) {
      const root = parsePartialJson(SAMPLE.slice(0, end));
      if (!root) continue;
      for (const [path, value] of finished(root)) {
        // a number at the very end could still grow: it is only «done» once something follows it
        if (seen.has(path)) expect(value, `${path} @${end}`).toBe(seen.get(path));
        seen.set(path, value);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
  });
  it("una stringa aperta conserva il testo ricevuto finora e dice di non essere finita", () => {
    const root = parsePartialJson('{"verdict":"issues","summary":"Il dialo')!;
    expect(entryOf(root, "verdict")).toMatchObject({ value: "issues", done: true });
    expect(entryOf(root, "summary")).toMatchObject({ value: "Il dialo", done: false });
    expect(finalText(entryOf(root, "summary"))).toBeUndefined();
    expect(finalText(entryOf(root, "verdict"))).toBe("issues");
    expect(root.done).toBe(false);
  });
  it("un escape spezzato a metà non produce caratteri strani", () => {
    expect(entryOf(parsePartialJson('{"a":"x\\'), "a")).toMatchObject({ value: "x", done: false });
    expect(entryOf(parsePartialJson('{"a":"x\\u00'), "a")).toMatchObject({ value: "x", done: false });
    expect(entryOf(parsePartialJson('{"a":"x\\u00e8'), "a")).toMatchObject({ value: "xè", done: false });
    expect(entryOf(parsePartialJson('{"a":"\\ud83d'), "a")).toMatchObject({ value: "", done: false }); // half an emoji
    expect(entryOf(parsePartialJson('{"a":"\\ud83d\\ude00'), "a")).toMatchObject({ value: "😀" });
  });
  it("numeri e letterali: finiti solo quando è certo che lo sono", () => {
    expect(entryOf(parsePartialJson('{"n":12'), "n")).toMatchObject({ type: "number", value: 12, done: false });
    expect(entryOf(parsePartialJson('{"n":12,'), "n")).toMatchObject({ value: 12, done: true });
    expect(entryOf(parsePartialJson('{"n":-'), "n")).toMatchObject({ done: false });
    for (const partial of ['{"n":0.', '{"n":0.5', '{"n":1e', '{"n":1e+', '{"n":1.5e3'])
      expect(entryOf(parsePartialJson(partial), "n"), partial).toMatchObject({ type: "number", done: false });
    expect(entryOf(parsePartialJson('{"n":0.5,'), "n")).toMatchObject({ value: 0.5, done: true });
    expect(entryOf(parsePartialJson('{"n":1e3}'), "n")).toMatchObject({ value: 1000, done: true });
    expect(entryOf(parsePartialJson('{"b":tr'), "b")).toMatchObject({ type: "literal", done: false });
    expect(entryOf(parsePartialJson('{"b":true'), "b")).toMatchObject({ value: true, done: true });
    expect(entryOf(parsePartialJson('{"b":nul'), "b")).toMatchObject({ done: false });
  });
  it("una chiave già scritta ma senza valore è «in attesa»", () => {
    expect(parsePartialJson('{"verdict":"pass","findings"')).toMatchObject({ pendingKey: "findings" });
    expect(parsePartialJson('{"verdict":"pass","findi')).toMatchObject({ pendingKey: "findi" });
    expect(parsePartialJson('{"verdict":"pass","findings":')).toMatchObject({ pendingKey: "findings" });
    expect(parsePartialJson("{")).toMatchObject({ type: "object", entries: [], done: false });
  });
  it("salta la frase o il blocco di codice prima dell'oggetto, senza farsi ingannare da parentesi nel testo", () => {
    const withFence = 'Ecco il rapporto {come richiesto}:\n```json\n{"verdict":"pass","summary":"Tutto bene.","findings":[]}\n```';
    expect(plain(parsePartialJson(withFence)!)).toEqual({ verdict: "pass", summary: "Tutto bene.", findings: [] });
    expect(parsePartialJson("Sto pensando a {qualcosa} ma non scrivo ancora JSON")).toBeNull();
    expect(parsePartialJson("")).toBeNull();
    expect(parsePartialJson("solo testo")).toBeNull();
  });
  it("graffe e virgolette dentro le stringhe non rompono nulla", () => {
    const root = parsePartialJson('{"a":"} ] { [ \\" ,","b":2}')!;
    expect(plain(root)).toEqual({ a: '} ] { [ " ,', b: 2 });
  });
  it("testo invalido: si ferma dove non capisce e tiene ciò che ha letto", () => {
    const root = parsePartialJson('{"a":"ok","b":nonsense,"c":"mai letto"}')!;
    expect(entryOf(root, "a")).toMatchObject({ value: "ok", done: true });
    expect(entryOf(root, "c")).toBeUndefined();
    expect(parsePartialJson('{"a":1 "b":2}')).toBeTruthy();
    expect(parsePartialJson('{"a":"\\q"}')).toBeTruthy();
    expect(parsePartialJson("{'a':1}")).toBeNull(); // single quotes: not the start of a JSON object
  });
  it("una chiave pericolosa è solo una chiave: nessun prototipo viene toccato", () => {
    const root = parsePartialJson('{"__proto__":{"polluted":true},"constructor":"x"}')!;
    expect(entryOf(root, "__proto__")).toBeDefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(plain(root) as object)).toBe(Object.prototype);
  });
  it("limita la profondità e la lunghezza, senza lanciare", () => {
    const deep = '{"a":'.repeat(60) + "1" + "}".repeat(60);
    expect(() => parsePartialJson(deep)).not.toThrow();
    const long = '{"a":"' + "x".repeat(600_000);
    const root = parsePartialJson(long)!;
    expect((entryOf(root, "a") as { value: string }).value.length).toBeLessThanOrEqual(400_000);
  });
  it("openLeaf indica cosa si sta scrivendo adesso", () => {
    const text = '{"verdict":"issues","findings":[{"category":"Cliché","reason":"Immagine abu';
    const leaf = openLeaf(parsePartialJson(text));
    expect(leaf?.path).toEqual(["findings", 0, "reason"]);
    expect(leaf?.node).toMatchObject({ type: "string", value: "Immagine abu", done: false });
    expect(openLeaf(parsePartialJson('{"verdict":"issues","findings":[{"a":"b"},'))?.path).toEqual(["findings"]);
    expect(openLeaf(parsePartialJson('{"verdict":"pass","findi'))?.path).toEqual(["findi"]);
    expect(openLeaf(parsePartialJson('{"verdict":"pass"}'))).toBeUndefined();
    expect(openLeaf(null)).toBeUndefined();
  });
});
