import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { createBackup, importBackup, readBackup } from "./backup";
import { encryptLocal } from "./crypto";
import { listBooks, saveActivity, saveBook, saveSettings } from "./db";
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
});
