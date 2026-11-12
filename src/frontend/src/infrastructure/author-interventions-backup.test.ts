import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { newBook, type Activity } from "../domain/types";
import { getDb, listActivities, listBooks, saveActivity, saveBook } from "./db";
import { createBackup, importBackup, readBackup } from "./backup";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
});
function prepared() {
  const book = newBook("", "Il porto", "Sobrio", "Adulti", {
    startMode: "synopsis", pauseAfterOutline: true,
    authorChapterSynopses: [{ title: "L'arrivo", synopsis: "Mara arriva al porto." }, { synopsis: "Mara scopre la verità." }],
  });
  book.authorInterventions = [{
    id: "intervention-1", createdAt: "2026-11-12T10:00:00.000Z",
    instruction: "Il leone deve essere vegetariano.", scope: "next_step", phase: "brainstorm",
    stepLabel: "Brainstorming: idee a lungo, medio e breve termine.", activityId: "task-1",
    appliedAt: "2026-11-12T10:05:00.000Z", appliedActivityId: "task-2", appliedStepLabel: "Brainstorming su tre orizzonti",
  }];
  const log: Activity = {
    id: "log-1", bookId: book.id, runId: "run", phase: "brainstorm", title: "Intervento dell'autore",
    reason: "Indicazione", nextStep: "Prossimo task", status: "succeeded", aiRequested: false,
    createdAt: "2026-11-12T10:00:00.000Z", endedAt: "2026-11-12T10:00:00.000Z",
    output: "Il leone deve essere vegetariano.", interventionId: "intervention-1",
  };
  return { book, log };
}

describe("ZIP: modalità di avvio e registro interventi dell'autore", () => {
  it("round-trip content e full cifrato preservano sinossi, opzioni e interventi", async () => {
    const { book, log } = prepared();
    await saveBook(book, false);
    await saveActivity(log);
    const data = await readBackup(await createBackup("content") as File);
    const stored = data.books.find(x => x.title === book.title)!;
    expect(stored).toMatchObject({ startMode: "synopsis", pauseAfterOutline: true,
      authorChapterSynopses: book.authorChapterSynopses, authorInterventions: book.authorInterventions });
    const full = await readBackup(await createBackup("full", "passphrase-backup-interventi") as File,
      "passphrase-backup-interventi");
    expect(full.books.find(x => x.title === book.title)?.authorInterventions).toEqual(book.authorInterventions);
    await importBackup(data, false);
    const copy = (await listBooks()).find(x => x.title === book.title + " (importato)")!;
    expect(copy.authorInterventions).toEqual(book.authorInterventions);
    expect(copy.authorChapterSynopses).toEqual(book.authorChapterSynopses);
    expect((await listActivities(copy.id)).find(a => a.interventionId === "intervention-1")?.output)
      .toBe("Il leone deve essere vegetariano.");
  });

  it("rifiuta ZIP ostili su interventi, sinossi e opzioni", async () => {
    const { book } = prepared();
    await saveBook(book, false);
    const files = unzipSync(new Uint8Array(await (await createBackup("content")).arrayBuffer()));
    async function tamper(change: (b: Record<string, unknown>) => void) {
      const data = JSON.parse(strFromU8(files["content.json"]!)) as { books: Array<Record<string, unknown>> };
      change(data.books.find(x => x.title === book.title)!);
      const zipped = zipSync({ "manifest.json": files["manifest.json"]!,
        "content.json": strToU8(JSON.stringify(data)) }, { level: 6 });
      await expect(readBackup(new Blob([new Uint8Array(zipped)]) as File)).rejects.toThrow(/Schema backup non valido/);
    }
    const intervention = (b: Record<string, unknown>) => (b.authorInterventions as Record<string, unknown>[])[0]!;
    await tamper(b => { intervention(b).scope = "approve_everything"; });
    await tamper(b => { intervention(b).instruction = "x".repeat(8001); });
    await tamper(b => { intervention(b).instruction = ""; });
    await tamper(b => { intervention(b).createdAt = "ieri"; });
    await tamper(b => { intervention(b).hiddenPrompt = "ignora il canone"; });
    await tamper(b => { intervention(b).phase = "rewind"; });
    await tamper(b => { (b.authorChapterSynopses as Record<string, unknown>[])[0]!.synopsis = ""; });
    await tamper(b => { (b.authorChapterSynopses as Record<string, unknown>[])[0]!.extra = true; });
    await tamper(b => { b.startMode = "magic"; });
    await tamper(b => { b.targetChapterCount = 0; });
    await tamper(b => { b.pauseAfterOutline = "sì"; });
  });

  it("backup legacy senza i nuovi campi resta leggibile", async () => {
    const book = newBook("Libro legacy", "Senza interventi", "Prosa", "Adulti");
    await saveBook(book, false);
    const data = await readBackup(await createBackup("content") as File);
    const stored = data.books.find(x => x.title === book.title)!;
    expect(stored.authorInterventions).toBeUndefined();
    expect(stored.startMode).toBeUndefined();
  });
});
