import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { createBackup, importBackup, readBackup } from "./backup";
import { encryptLocal } from "./crypto";
import { getDb, listBooks, saveActivity, saveBook, saveSettings } from "./db";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";

const API_SECRET = "sk-test-backup-must-not-leak";
const passphrase = "test-bookwriter-2026-very-secret";

beforeAll(async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]!.secret = await encryptLocal(API_SECRET);
  settings.defaultRoute.modelId = "test-model";
  await saveSettings(settings);
  const book = newBook("Una trama avvincente e dettagliata.", "Il primo manoscritto", "Narrativo", "Adulti");
  await saveBook(book);
  await saveActivity({
    id: crypto.randomUUID(), bookId: book.id, runId: crypto.randomUUID(),
    phase: "brainstorm", title: "Una prima idea",
    reason: "Brainstorm iniziale", nextStep: "Validare",
    status: "succeeded", createdAt: new Date().toISOString(),
    output: "Proposta narrativa valida.",
  });
});

describe("Backup portabile BookWriter", () => {
  it("esclude per definizione le credenziali dagli archivi di contenuto", async () => {
    const zip = await createBackup("content");
    const parsed = await readBackup(zip as File);
    expect(parsed.kind).toBe("content");
    expect(parsed.settings).toBeUndefined();
    expect(parsed.books).toHaveLength(1);
    expect(parsed.activities).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain(API_SECRET);
  });

  it("rifiuta il backup completo non protetto senza consenso esplicito", async () => {
    await expect(createBackup("full")).rejects.toThrow(/password/i);
  });

  it("recupera le chiavi soltanto con la password corretta", async () => {
    const zip = await createBackup("full", passphrase);
    await expect(readBackup(zip as File, "wrong-password-of-length-20")).rejects.toThrow(/Password errata/);
    const parsed = await readBackup(zip as File, passphrase);
    expect(parsed.kind).toBe("full");
    expect(parsed.settings?.endpoints[0]?.apiKey).toBe(API_SECRET);
  });

  it("importa come copia e non elimina né modifica libri preesistenti", async () => {
    const before = await listBooks();
    const zip = await createBackup("content");
    const parsed = await readBackup(zip as File);
    const count = await importBackup(parsed, false);
    const after = await listBooks();
    expect(count).toBe(1);
    expect(after).toHaveLength(before.length + 1);
    expect(after.some(book => book.id === before[0]!.id)).toBe(true);
    expect(after.some(book => book.title.includes("(importato)"))).toBe(true);
  });
  it("esporta le bozze editoriali nello ZIP e ne importa lo storico senza potere di approvazione", async () => {
    const original = (await listBooks()).find(book => book.title === "Il primo manoscritto")!;
    const draftId = crypto.randomUUID();
    await (await getDb()).put("mergeDrafts", {
      id: draftId, bookId: original.id,
      chapterId: "chapter-1", sceneId: "scene-1",
      localRevision: original.updatedAt, remoteHead: "a".repeat(40),
      localText: "Locale", remoteText: "GitHub", proposedText: "Fusione da revisionare.",
      instruction: "Conserva il segreto", status: "proposed",
      createdAt: new Date().toISOString(), source: "ai", endpointId: "openai", modelId: "Astra",
    }, draftId);
    const zip = await createBackup("content");
    const parsed = await readBackup(zip as File);
    expect(parsed.mergeDrafts?.some(d => d.id === draftId)).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain(API_SECRET);
    const before = new Set((await listBooks()).map(b => b.id));
    await importBackup(parsed, false);
    const copied = (await listBooks()).find(b => !before.has(b.id) &&
      b.title === original.title + " (importato)");
    expect(copied).toBeDefined();
    const drafts = (await (await getDb()).getAll("mergeDrafts")) as Array<{
      id: string; bookId: string; status: string; proposedText: string;
    }>;
    expect(drafts.some(d => d.bookId === copied?.id &&
      d.id !== draftId && d.status === "rejected" &&
      d.proposedText === "Fusione da revisionare.")).toBe(true);
  });

});
