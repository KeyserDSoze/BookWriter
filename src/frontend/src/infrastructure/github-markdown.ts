import { z } from "zod";
import type { BookProject, GitHubRemote } from "../domain/types";
import { projectBook, projectLegacyBook } from "../domain/narrarium";
import { readNarrarium } from "../domain/narrarium-reader";
import { migrateBook } from "../domain/book-format";
import { isCoreNarrativePath, isNarrativePath, MAX_DOCUMENT_BYTES, MAX_MARKDOWN_BYTES, MAX_MARKDOWN_FILES, readMarkdownDocument } from "../domain/markdown-document";

type Get = (suffix: string) => Promise<unknown>;
const sha = z.string().regex(/^[a-f0-9]{40}$/i);
const treeSchema = z.object({ truncated: z.boolean(), tree: z.array(z.object({
  path: z.string().max(1000), type: z.enum(["blob", "tree", "commit"]), mode: z.string(), sha,
})).max(20_000) });

export class MarkdownSnapshotConflict extends Error {
  constructor() {
    super("I Markdown e lo snapshot BookWriter sono diversi. Nessuna versione è stata scelta: importa i Markdown come copia locale separata e confrontali prima di continuare.");
    this.name = "MarkdownSnapshotConflict";
  }
}
export async function narrativeTree(get: Get, ref: string): Promise<Map<string, string>> {
  const parsed = treeSchema.safeParse(await get("/git/trees/" + ref + "?recursive=1"));
  if (!parsed.success || parsed.data.truncated) throw new Error("Elenco dei file GitHub incompleto o non valido: nessun libro importato.");
  const paths = new Set<string>();
  const result = new Map<string, string>();
  for (const entry of parsed.data.tree) {
    if (paths.has(entry.path)) throw new Error("Percorsi GitHub duplicati.");
    paths.add(entry.path);
    if (entry.path.startsWith("chapters/") && /\/(?:chapter|\d+-[^/]+)\.md$/.test(entry.path) && !isCoreNarrativePath(entry.path))
      throw new Error("Percorso capitolo o scena non supportato: usa chapters/NNN-titolo/NNN-scena.md.");
    if (!isNarrativePath(entry.path)) continue;
    if (entry.type !== "blob" || entry.mode !== "100644") throw new Error("Un documento narrativo GitHub non è un file regolare.");
    result.set(entry.path, entry.sha);
  }
  if (result.size > MAX_MARKDOWN_FILES) throw new Error("Troppi documenti Markdown: massimo 1.200.");
  return result;
}

export async function gitBlobSha(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode("blob " + bytes.length + "\0");
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header); object.set(bytes, header.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", object)), n => n.toString(16).padStart(2, "0")).join("");
}

export async function markdownIdentity(root: string, remote: GitHubRemote): Promise<{ id: string; title: string }> {
  const { metadata } = readMarkdownDocument(root);
  if (metadata.type !== "book" || typeof metadata.id !== "string" || metadata.id.length > 300 ||
      !/^book:[a-zA-Z0-9][a-zA-Z0-9_.-]*(?::[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/.test(metadata.id) ||
      typeof metadata.title !== "string" || !metadata.title.trim() || metadata.title.length > 300)
    throw new Error("book.md non segue il contratto Markdown: occorrono type, id e title.");
  const input = ["bookwriter-markdown/v1", remote.owner.toLowerCase(), remote.repository.toLowerCase(), remote.branch, metadata.id];
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))));
  // A deterministic, namespaced local UUID. Never guess identity from the title.
  bytes[6] = (bytes[6]! & 15) | 0x80; bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), n => n.toString(16).padStart(2, "0")).join("");
  return { id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`, title: metadata.title };
}

export async function readGitHubMarkdown(get: Get, ref: string, remote: GitHubRemote, root: string): Promise<BookProject> {
  const identity = await markdownIdentity(root, remote);
  const tree = await narrativeTree(get, ref);
  if (!tree.has("book.md") || await gitBlobSha(root) !== tree.get("book.md")) throw new Error("book.md non corrisponde alla revisione GitHub letta.");
  const files: Record<string, string> = { "book.md": root };
  let total = new TextEncoder().encode(root).byteLength;
  // Serial and bounded. Only GitHub blob SHAs from the pinned tree, no remote URLs.
  for (const [path, sha] of tree) {
    if (path === "book.md") continue;
    const result = z.object({ encoding: z.literal("base64"), content: z.string().max(3 * MAX_DOCUMENT_BYTES),
      size: z.number().int().min(0).max(MAX_DOCUMENT_BYTES) }).safeParse(await get("/git/blobs/" + sha));
    if (!result.success) throw new Error("Documento GitHub mancante, non valido o troppo grande.");
    let bytes: Uint8Array;
    let value: string;
    try {
      const binary = atob(result.data.content.replace(/\s/g, ""));
      bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch { throw new Error("Documento GitHub non codificato in UTF-8 valido."); }
    total += bytes.byteLength;
    if (bytes.byteLength !== result.data.size || total > MAX_MARKDOWN_BYTES || await gitBlobSha(value) !== sha)
      throw new Error("Dimensione o impronta di un documento GitHub non valida.");
    files[path] = value;
  }
  return migrateBook(readNarrarium(files, identity.id, new Date().toISOString()));
}

/** Compare actual Git blobs, not merely metadata or file timestamps. New,
 * removed and changed Markdown all block a stale JSON snapshot. */
export async function assertMarkdownSnapshot(get: Get, ref: string, book: BookProject, format: number): Promise<void> {
  const tree = await narrativeTree(get, ref);
  const expected = format === 0 ? projectLegacyBook(book, []).files : projectBook(book, [], format === 1 ? 1 : format === 2 ? 2 : 3).files;
  const managed = new Map(Object.entries(expected).filter(([path]) => isNarrativePath(path)));
  for (const [path, content] of managed) if (tree.get(path) !== await gitBlobSha(content)) throw new MarkdownSnapshotConflict();
  // New extension documents are also data: an older JSON cannot hide them.
  for (const path of tree.keys()) if (!managed.has(path))
    throw new MarkdownSnapshotConflict();
}
