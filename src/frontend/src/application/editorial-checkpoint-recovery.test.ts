import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, type BookProject } from "../domain/types";
import { EDITORIAL_ROLES, assertEditorialReviewCoverage, createEditorialCycle, validateJudgment, validateReport, chapterSegments } from "../domain/editorial-board";
import { extendHistoricalDossier, type HistoricalSource } from "../domain/historical-research";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { createBackup, readBackup } from "../infrastructure/backup";
import { editorialRecoveryProblem, recoverEditorialCheckpoint, MAX_EDITORIAL_RECOVERY_ARCHIVES } from "./editorial-control";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
  vi.stubGlobal("navigator", { locks: { request: async (
    _name: string, _options: unknown, cb: (lock: object) => Promise<unknown>,
  ) => cb({ name: "lock" }) } });
});
afterEach(() => vi.unstubAllGlobals());

async function specimen(): Promise<BookProject> {
  const book = newBook("Mara custodisce il segreto del castello.", "Romanzo di Mara", "Sobrio", "Adulti");
  book.phase = "chapterReview"; book.status = "error";
  book.chapters = [
    { id: "ch-0", number: 1, title: "Prima parte", purpose: "Antefatto",
      frozenAt: "2026-11-08T12:00:00.000Z",
      summary: "Mara arriva al castello.", scenes: [
        { id: "s-0", number: 1, title: "Inizio", objective: "Introdurre",
          text: "Mara arrivò al castello.", status: "canon" },
      ] },
    { id: "ch-1", number: 2, title: "La porta", purpose: "Verifica",
      scenes: [{ id: "s-1", number: 1, title: "Il portone", objective: "Proseguire",
        text: "Mara incontra il guardiano davanti al portone.", status: "canon" }] },
  ];
  book.editorialCycle = createEditorialCycle("ch-1");
  book.editorialCycle.stage = "adjudicate";
  book.editorialCycle.reports.push({
    role: "continuity", segmentIndex: 0, segmentCount: 1, verdict: "pass",
    summary: "Nessun rilievo significativo.", memoryNote: "Appunto",
    findings: [], createdAt: "2026-11-09T12:00:00.000Z",
  });
  book.remote = { owner: "writer", repository: "novel", branch: "main",
    lastSyncedCommit: "a".repeat(40), autoSync: true };
  book.memory.secrets["svolta"] = "Il guardiano conosce un passaggio nascosto.";
  await saveBook(book);
  return book;
}

describe("Recupero supervisionato di checkpoint editoriali obsoleti", () => {
  it("archivia tutti i dati del ciclo senza toccare prosa, memoria e capitoli congelati", async () => {
    const book = await specimen();
    const prior = structuredClone(book.editorialCycle);
    const chapters = structuredClone(book.chapters);
    const memory = structuredClone(book.memory);
    expect(editorialRecoveryProblem(book)).toMatch(/incompleta/);
    // Active editorial cycles deliberately do not auto-queue sync.
    // Seed an already pending item to prove recovery removes stale outbox data.
    await (await getDb()).put("outbox", {
      bookId: book.id, operationId: crypto.randomUUID(),
      revision: 1, requestedAt: new Date().toISOString(),
      state: "pending", attempts: 0,
    }, book.id);
    expect(await getOutbox(book.id)).toBeDefined();
    await recoverEditorialCheckpoint(book.id, true);
    const saved = (await getBook(book.id))!;
    expect(saved.editorialRecoveryArchives).toHaveLength(1);
    expect(saved.editorialRecoveryArchives![0]!.cycle).toEqual(prior);
    expect(saved.editorialRecoveryArchives![0]!.reason).toMatch(/incompleta/);
    expect(saved.editorialRecoveryArchives![0]!.chapterId).toBe("ch-1");
    expect(saved.editorialCycle).toMatchObject({
      chapterId: "ch-1", stage: "review", round: 1, reports: [], priorRounds: [],
    });
    expect(saved.chapters).toEqual(chapters);
    expect(saved.memory).toEqual(memory);
    expect(saved.phase).toBe("chapterReview");
    expect(saved.status).toBe("paused");
    expect(saved.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(a =>
      a.title === "Recupero supervisionato del checkpoint editoriale")).toBe(true);
    expect(editorialRecoveryProblem(saved)).toBeUndefined();
  });
  it("include l'archivio completo in un backup ZIP content-only e lo legge senza promuoverlo", async () => {
    const book = await specimen();
    await recoverEditorialCheckpoint(book.id, true);
    const zip = await createBackup("content");
    const data = await readBackup(zip as File);
    const recovered = data.books.find(b => b.id === book.id);
    expect(recovered?.editorialRecoveryArchives).toHaveLength(1);
    expect(recovered?.editorialRecoveryArchives?.[0]?.cycle.reports[0]?.summary)
      .toBe("Nessun rilievo significativo.");
    expect(recovered?.editorialCycle?.reports).toHaveLength(0);
    expect(data.settings).toBeUndefined();
  });
  it("non esegue un recupero senza consenso o su un checkpoint valido", async () => {
    const book = await specimen();
    await expect(recoverEditorialCheckpoint(book.id, false)).rejects.toThrow(/Conferma esplicita/);
    const current = (await getBook(book.id))!;
    current.editorialCycle!.stage = "review";
    current.editorialCycle!.reports = [];
    await saveBook(current, false);
    expect(editorialRecoveryProblem(current)).toBeUndefined();
    await expect(recoverEditorialCheckpoint(book.id, true)).rejects.toThrow(/Checkpoint attivo valido/);
    expect((await getBook(book.id))!.editorialRecoveryArchives).toBeUndefined();
  });
  it("non recupera se l'autopilot corre, o in stage reconcile/blocked", async () => {
    const book = await specimen();
    const running = (await getBook(book.id))!;
    running.status = "running";
    await saveBook(running, false);
    await expect(recoverEditorialCheckpoint(book.id, true)).rejects.toThrow(/pausa/);
    running.status = "error";
    running.editorialCycle!.stage = "reconcile";
    await saveBook(running, false);
    expect(editorialRecoveryProblem(running)).toBeUndefined();
    await expect(recoverEditorialCheckpoint(book.id, true)).rejects.toThrow(/fase non recuperabile/);
    running.editorialCycle!.stage = "blocked";
    await saveBook(running, false);
    await expect(recoverEditorialCheckpoint(book.id, true)).rejects.toThrow(/fase non recuperabile/);
  });
  it("rifiuta lock concorrente e non perde il checkpoint", async () => {
    const book = await specimen();
    vi.stubGlobal("navigator", { locks: { request: async (
      name: string, _options: unknown, cb: (lock: object | null) => Promise<unknown>,
    ) => cb(name.includes("bookwriter:writer:") ? null : { name: "lock" }) } });
    await expect(recoverEditorialCheckpoint(book.id, true)).rejects.toThrow(/altra scheda/);
    expect((await getBook(book.id))!.editorialCycle!.reports).toHaveLength(1);
    expect((await getBook(book.id))!.editorialRecoveryArchives).toBeUndefined();
  });
  it("non supera il limite di archivi senza eliminare lo storico", async () => {
    const book = await specimen();
    const latest = (await getBook(book.id))!;
    latest.editorialRecoveryArchives = Array.from({ length: MAX_EDITORIAL_RECOVERY_ARCHIVES },
      (_, index) => ({
        chapterId: "ch-1", archivedAt: "2026-11-09T12:00:00.000Z",
        reason: "Storico " + index, cycle: structuredClone(latest.editorialCycle!),
      }));
    await saveBook(latest, false);
    await expect(recoverEditorialCheckpoint(book.id, true)).rejects.toThrow(/Archivio dei recuperi pieno/);
    expect((await getBook(book.id))!.editorialRecoveryArchives).toHaveLength(MAX_EDITORIAL_RECOVERY_ARCHIVES);
  });
  it("rileva anche una review con un report pass riferito a testo precedente", async () => {
    const book = await specimen();
    const chapter = book.chapters[1]!;
    const segment = chapterSegments(chapter)[0]!;
    book.editorialCycle!.stage = "review";
    book.editorialCycle!.reports = [validateReport(
      book.editorialCycle!, "continuity", segment, 1,
      JSON.stringify({ verdict: "pass", summary: "Nessun problema individuato.", findings: [], memoryNote: "" }),
      chapter, book,
    )];
    book.chapters[1]!.scenes[0]!.text += " Il portone scricchiolò.";
    await saveBook(book, false);
    const before = (await getBook(book.id))!;
    expect(() => assertEditorialReviewCoverage(before, before.editorialCycle!)).toThrow(/obsoleto/);
    await recoverEditorialCheckpoint(book.id, true);
    const saved = (await getBook(book.id))!;
    expect(saved.editorialRecoveryArchives?.[0]?.cycle.reports[0]?.segmentTextStamp).toBeDefined();
    expect(saved.chapters[1]!.scenes[0]!.text).toContain("scricchiolò");
  });
});

async function repairSpecimen(): Promise<BookProject> {
  const book = await specimen();
  const chapter = book.chapters[1]!;
  chapter.scenes = [
    {id:"s-1",number:1,title:"Il portone",objective:"Entrare",
      text:"Mara apre il portone e incontra il guardiano davanti al castello.",status:"canon"},
    {id:"s-2",number:2,title:"Il messaggio",objective:"Comunicare",
      text:"Nel 1848 Mara usa il telegrafo per mandare un messaggio.",status:"canon"},
  ];
  const source: HistoricalSource = {
    id:"itwiki:42:210",pageId:42,revisionId:210,provider:"it.wikipedia.org",
    title:"Telegrafo",url:"https://it.wikipedia.org/wiki/Telegrafo",
    query:"Telegrafo elettrico nel 1848",
    excerpt:"Il telegrafo elettrico cominciò a diffondersi in Europa durante il XIX secolo.",
    retrievedAt:"2026-11-09T12:00:00.000Z",
  };
  chapter.historicalDossier=extendHistoricalDossier(undefined,
    [source.query],[source],"2026-11-09T13:00:00.000Z");
  const cycle=createEditorialCycle(chapter.id),segments=chapterSegments(chapter);
  const pass=JSON.stringify({verdict:"pass",summary:"Nessuna criticità verificabile.",
    memoryNote:"",findings:[]});
  for(const role of EDITORIAL_ROLES)for(const segment of segments){
    let raw=pass;
    if(role==="continuity"&&segment.index===0)raw=JSON.stringify({
      verdict:"issues",summary:"Il portone merita una verifica.",memoryNote:"",
      findings:[{sceneId:"s-1",category:"continuità",severity:"minor",
        evidence:"Mara apre il portone",
        reason:"Verificare il contesto narrativo del guardiano.",
        remediation:"Chiarire il passaggio davanti al guardiano."}],
    });
    if(role==="historical"&&segment.index===1)raw=JSON.stringify({
      verdict:"issues",summary:"Il telegrafo richiede cautela.",memoryNote:"",
      findings:[{sceneId:"s-2",category:"storia",severity:"minor",
        evidence:"Mara usa il telegrafo",
        reason:"La scena richiede un confronto documentale.",
        remediation:"Specificare la modalità di comunicazione ottocentesca.",
        historical:{claim:"L'uso del telegrafo nel 1848 richiede verifica del contesto.",
          assessment:"consistent_with_excerpt",sourceIds:[source.id],
          sourceQuote:"Il telegrafo elettrico cominciò a diffondersi"}}],
    });
    cycle.reports.push(validateReport(cycle,role,segment,segments.length,raw,chapter,book));
  }
  cycle.judgment=validateJudgment(cycle,JSON.stringify({
    reasoning:"Entrambi i rilievi richiedono una correzione prudente e motivata.",
    decisions:cycle.reports.flatMap(report=>report.findings.map(finding=>({
      findingId:finding.id,action:"accept",
      rationale:"Una riscrittura minima può chiarire il testo in modo prudente.",
      remediation:"Chiarire la scena senza inventare nuove certezze storiche.",
    }))),
  }),chapter,book);
  cycle.stage="repair";
  book.editorialCycle=cycle;
  await saveBook(book,false);
  return (await getBook(book.id))!;
}
function withdrawRepairSource(book:BookProject):void {
  const dossier=book.chapters[1]!.historicalDossier!;
  const old=dossier.sources[0]!;
  book.chapters[1]!.historicalDossier=extendHistoricalDossier(dossier,
    [old.query],[{...old,id:"itwiki:42:211",revisionId:211}],
    "2026-11-09T20:00:00.000Z");
}
describe("Recupero supervisionato di remediation non più correnti",()=>{
  it("una remediation sana non mostra il recupero, anche dopo una correzione già salvata",async()=>{
    const book=await repairSpecimen();
    expect(editorialRecoveryProblem(book)).toBeUndefined();
    book.chapters[1]!.scenes[0]!.text="Mara chiarisce il motivo della visita al guardiano.";
    book.chapters[1]!.scenes[0]!.status="draft";
    book.editorialCycle!.repairCursor=1;
    expect(()=>assertEditorialReviewCoverage(book,book.editorialCycle!,true)).toThrow(/obsoleto/);
    expect(editorialRecoveryProblem(book)).toBeUndefined();
    await saveBook(book,false);
    await expect(recoverEditorialCheckpoint(book.id,true)).rejects.toThrow(/Checkpoint attivo valido/);
  });
  it("dopo un edit conserva la prosa corrente e l'intero vecchio giudizio se il dossier è ritirato",async()=>{
    const book=await repairSpecimen();
    book.chapters[1]!.scenes[0]!.text="Mara chiarisce il motivo della visita al guardiano.";
    book.chapters[1]!.scenes[0]!.status="draft";
    book.editorialCycle!.repairCursor=1;
    withdrawRepairSource(book);
    expect(editorialRecoveryProblem(book)).toMatch(/Fonte storica.*non più corrente/);
    await saveBook(book,false);
    const before=structuredClone(book.editorialCycle),chapters=structuredClone(book.chapters);
    await expect(recoverEditorialCheckpoint(book.id,false)).rejects.toThrow(/Conferma esplicita/);
    await recoverEditorialCheckpoint(book.id,true);
    const saved=(await getBook(book.id))!;
    expect(saved.editorialCycle).toMatchObject({stage:"review",round:1,reports:[]});
    expect(saved.editorialRecoveryArchives?.[0]?.cycle).toEqual(before);
    expect(saved.editorialRecoveryArchives?.[0]?.cycle.judgment?.verdict).toBe("repair");
    expect(saved.editorialRecoveryArchives?.[0]?.cycle.repairCursor).toBe(1);
    expect(saved.chapters).toEqual(chapters);
    expect(saved.chapters[1]!.scenes[0]!.status).toBe("draft");
    expect(saved.status).toBe("paused");
    expect(saved.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
  });
  it("prima del primo edit blocca matrice incompleta e fonti ritirate",async()=>{
    const book=await repairSpecimen();
    const full=structuredClone(book.editorialCycle!.reports);
    book.editorialCycle!.reports.pop();
    expect(editorialRecoveryProblem(book)).toMatch(/Redazione incompleta/);
    book.editorialCycle!.reports=full;
    withdrawRepairSource(book);
    expect(editorialRecoveryProblem(book)).toMatch(/Fonte storica.*non più corrente/);
  });
  it("rifiuta cursore e giudizio invalidi; l'archivio pieno resta intatto",async()=>{
    const book=await repairSpecimen();
    book.editorialCycle!.repairCursor=-1;
    expect(editorialRecoveryProblem(book)).toMatch(/cursore non valido/);
    book.editorialCycle!.repairCursor=0;
    book.editorialCycle!.judgment=undefined;
    expect(editorialRecoveryProblem(book)).toMatch(/senza giudizio/);
    const fresh=await repairSpecimen();
    withdrawRepairSource(fresh);
    fresh.editorialRecoveryArchives=Array.from({length:MAX_EDITORIAL_RECOVERY_ARCHIVES},(_,i)=>({
      chapterId:"ch-1",archivedAt:"2026-11-09T12:00:00.000Z",
      reason:"Snapshot "+i,cycle:structuredClone(fresh.editorialCycle!),
    }));
    await saveBook(fresh,false);
    await expect(recoverEditorialCheckpoint(fresh.id,true)).rejects.toThrow(/Archivio dei recuperi pieno/);
    expect((await getBook(fresh.id))!.editorialRecoveryArchives).toHaveLength(MAX_EDITORIAL_RECOVERY_ARCHIVES);
  });
});
