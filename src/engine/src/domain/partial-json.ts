/** Tolerant reader for a JSON object that is still being written by a model.
 *
 * A reply such as {"verdict":"issues","findings":[{"category":"Cliché","reason":"Il dial
 * is not valid JSON yet, but most of it is already known: the verdict is final, the first
 * finding may be complete, the second is half written. This reader says exactly that: every
 * value carries `done`, and a string that is still open keeps the text received so far.
 *
 * Pure, total and bounded: it never throws, never evaluates anything, never builds an
 * object keyed by untrusted names (entries are a list, so `__proto__` is just a key). */
export type PartialNode =
  | { type: "string"; value: string; done: boolean }
  | { type: "number"; value: number; done: boolean }
  | { type: "literal"; value: boolean | null; done: boolean }
  | { type: "array"; items: PartialNode[]; done: boolean }
  | { type: "object"; entries: PartialEntry[]; pendingKey?: string; done: boolean };
export interface PartialEntry { key: string; value: PartialNode }

const MAX_DEPTH = 24;
const MAX_CHARS = 400_000;
const MAX_START_POINTS = 40;
class Invalid extends Error {}

const isSpace = (code: number) => code === 32 || code === 10 || code === 13 || code === 9;
const LITERALS: ReadonlyArray<[string, boolean | null]> = [["true", true], ["false", false], ["null", null]];
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "\"": "\"", "\\": "\\", "/": "/" };
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** A high surrogate alone at the end is half of a character still arriving. */
function withoutDanglingSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

function parseAt(text: string, start: number): PartialNode | null {
  let pos = start;
  let root: PartialNode | null = null;
  const skip = () => { while (pos < text.length && isSpace(text.charCodeAt(pos))) pos++; };

  function readString(): { value: string; done: boolean } {
    pos++; // opening quote
    let out = "";
    while (pos < text.length) {
      const ch = text[pos]!;
      if (ch === "\"") { pos++; return { value: out, done: true }; }
      if (ch !== "\\") { out += ch; pos++; continue; }
      if (pos + 1 >= text.length) break;
      const next = text[pos + 1]!;
      if (next === "u") {
        const hex = text.slice(pos + 2, pos + 6);
        if (hex.length < 4) break; // the escape itself is still arriving
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Invalid();
        out += String.fromCharCode(parseInt(hex, 16));
        pos += 6;
        continue;
      }
      const decoded = ESCAPES[next];
      if (decoded === undefined || !Object.hasOwn(ESCAPES, next)) throw new Invalid();
      out += decoded;
      pos += 2;
    }
    pos = text.length;
    return { value: withoutDanglingSurrogate(out), done: false };
  }

  function readValue(depth: number, sink: (node: PartialNode) => void): PartialNode | null {
    skip();
    if (pos >= text.length) return null;
    if (depth > MAX_DEPTH) throw new Invalid();
    const ch = text[pos]!;
    if (ch === "{") return readObject(depth, sink);
    if (ch === "[") return readArray(depth, sink);
    if (ch === "\"") {
      const node: PartialNode = { type: "string", value: "", done: false };
      sink(node);
      const read = readString();
      node.value = read.value; node.done = read.done;
      return node;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const node: PartialNode = { type: "number", value: Number.NaN, done: false };
      sink(node);
      NUMBER.lastIndex = pos;
      const match = NUMBER.exec(text);
      if (!match) {
        if (ch === "-" && pos + 1 >= text.length) { pos = text.length; return node; }
        throw new Invalid();
      }
      pos += match[0].length;
      node.value = Number(match[0]);
      // «12» may still become «123», and «0.» or «1e+» are only the start of the number.
      const rest = text.slice(pos);
      if (rest === "" || /^(?:\.|[eE][+-]?)$/.test(rest)) { pos = text.length; return node; }
      node.done = true;
      return node;
    }
    for (const [literal, value] of LITERALS) {
      if (text.startsWith(literal, pos)) {
        const node: PartialNode = { type: "literal", value, done: true };
        sink(node);
        pos += literal.length;
        return node;
      }
      const rest = text.slice(pos);
      if (rest.length < literal.length && literal.startsWith(rest)) {
        const node: PartialNode = { type: "literal", value, done: false };
        sink(node);
        pos = text.length;
        return node;
      }
    }
    throw new Invalid();
  }

  function readObject(depth: number, sink: (node: PartialNode) => void): PartialNode {
    const node: Extract<PartialNode, { type: "object" }> = { type: "object", entries: [], done: false };
    sink(node);
    pos++;
    for (;;) {
      skip();
      if (pos >= text.length) return node;
      const ch = text[pos]!;
      if (ch === "}") { pos++; node.done = true; return node; }
      if (ch === ",") { pos++; continue; }
      if (ch !== "\"") throw new Invalid();
      const key = readString();
      if (!key.done) { node.pendingKey = key.value; return node; }
      skip();
      if (pos >= text.length) { node.pendingKey = key.value; return node; }
      if (text[pos] !== ":") throw new Invalid();
      pos++;
      skip();
      if (pos >= text.length) { node.pendingKey = key.value; return node; }
      const child = readValue(depth + 1, created => node.entries.push({ key: key.value, value: created }));
      if (!child) { node.pendingKey = key.value; return node; }
      if (!child.done) return node;
    }
  }

  function readArray(depth: number, sink: (node: PartialNode) => void): PartialNode {
    const node: Extract<PartialNode, { type: "array" }> = { type: "array", items: [], done: false };
    sink(node);
    pos++;
    for (;;) {
      skip();
      if (pos >= text.length) return node;
      const ch = text[pos]!;
      if (ch === "]") { pos++; node.done = true; return node; }
      if (ch === ",") { pos++; continue; }
      const child = readValue(depth + 1, created => node.items.push(created));
      if (!child || !child.done) return node;
    }
  }

  try { readValue(0, node => { root = node; }); } catch (error) { if (!(error instanceof Invalid)) throw error; }
  return root;
}

/** The first object in `raw` that starts the way a JSON object does: «{» then «"» or «}».
 * Models often put a sentence or a code fence before it. Returns null when there is none yet. */
export function parsePartialJson(raw: string): PartialNode | null {
  const text = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;
  let tried = 0;
  for (let at = text.indexOf("{"); at >= 0 && tried < MAX_START_POINTS; at = text.indexOf("{", at + 1)) {
    tried++;
    let next = at + 1;
    while (next < text.length && isSpace(text.charCodeAt(next))) next++;
    if (next < text.length && text[next] !== "\"" && text[next] !== "}") continue;
    const node = parseAt(text, at);
    return node && node.type === "object" ? node : null;
  }
  return null;
}

export function entryOf(node: PartialNode | null | undefined, key: string): PartialNode | undefined {
  return node?.type === "object" ? node.entries.find(entry => entry.key === key)?.value : undefined;
}
/** The text of a string value, only once it is complete. */
export function finalText(node: PartialNode | null | undefined): string | undefined {
  return node?.type === "string" && node.done ? node.value : undefined;
}

export type PathStep = string | number;
/** The value being written right now: follows the last, unfinished child down to a leaf.
 * `path` names where it is (["findings", 1, "reason"]). Undefined when nothing is open. */
export function openLeaf(root: PartialNode | null): { path: PathStep[]; node: PartialNode } | undefined {
  const path: PathStep[] = [];
  let node = root;
  while (node && !node.done) {
    if (node.type === "object") {
      const last = node.entries[node.entries.length - 1];
      if (!last || last.value.done) {
        if (node.pendingKey !== undefined) path.push(node.pendingKey);
        return { path, node };
      }
      path.push(last.key);
      node = last.value;
    } else if (node.type === "array") {
      const last = node.items[node.items.length - 1];
      if (!last || last.done) return { path, node };
      path.push(node.items.length - 1);
      node = last;
    } else return { path, node };
  }
  return undefined;
}
