import "fake-indexeddb/auto";
import {beforeEach,describe,expect,it} from "vitest";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {newBook} from "../domain/types";
import {createEditorialCycle,recommendationReconciliationSchema} from "../domain/editorial-board";
import {getDb,saveBook} from "./db";
import {createBackup,readBackup} from "./backup";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
});
const reconciliation={
  findingIds:["1:style:0:0","1:narrative:0:0"],
  resolution:"reject_all" as const,
  evidenceAssessment:"unresolved" as const,
  rationale:"I due revisori propongono cambi diversi sullo stesso estratto, non un fatto verificato.",
  missingEvidence:"Manca il contesto completo del punto di vista e della scena precedente.",
  nextCheck:"L'autore deve rileggere la scena, il narratore e la funzione del dettaglio.",
};
describe("ZIP v0.11.23: motivazione del disaccordo editoriale",()=>{
  it("roundtrip content e full cifrato, validazione strict e compatibilità legacy",async()=>{
    const book=newBook("Scena divergente","Le alternative","Prosa","Adulti");
    const cycle=createEditorialCycle("ch1");
    cycle.judgment={reasoning:"Il giudice non tratta le proposte dei revisori come voti.",
      decisions:[],recommendationReconciliations:[reconciliation],
      verdict:"freeze",createdAt:"2026-11-08T15:45:00.000Z"};
    book.editorialCycle=cycle;
    await saveBook(book,false);
    const zip=await createBackup("content");
    const raw=(await readBackup(zip as File)).books.find(b=>b.title===book.title)!;
    expect(raw.editorialCycle?.judgment?.recommendationReconciliations)
      .toEqual([reconciliation]);
    const encrypted=await createBackup("full","passphrase-lunga-per-backup-2026");
    const decrypted=(await readBackup(encrypted as File,"passphrase-lunga-per-backup-2026"))
      .books.find(b=>b.title===book.title)!;
    expect(decrypted.editorialCycle?.judgment?.recommendationReconciliations)
      .toEqual([reconciliation]);
    expect(recommendationReconciliationSchema.safeParse(reconciliation).success)
      .toBe(true);
    const files=unzipSync(new Uint8Array(await zip.arrayBuffer()));
    async function tamper(change:(x:Record<string,unknown>)=>void){
      const parsed=JSON.parse(strFromU8(files["content.json"]!)) as {
        books:Array<Record<string,unknown>>,
      };
      const first=parsed.books.find(x=>x.title===book.title)!;
      const judgment=(first.editorialCycle as {
        judgment:{recommendationReconciliations:Array<Record<string,unknown>>};
      }).judgment;
      change(judgment.recommendationReconciliations[0]!);
      const zipped=zipSync({
        "manifest.json":files["manifest.json"]!,
        "content.json":strToU8(JSON.stringify(parsed)),
      },{level:6});
      await expect(readBackup(new Blob([new Uint8Array(zipped)]) as File))
        .rejects.toThrow(/Schema backup non valido/);
    }
    await tamper(x=>{x.resolution="automatic_repair";});
    await tamper(x=>{x.evidenceAssessment="verified_truth";});
    await tamper(x=>{x.findingIds=["id-uno"];});
    await tamper(x=>{x.nextCheck="vago";});
    await tamper(x=>{x.missingEvidence="nulla";});
    await tamper(x=>{x.rationale="breve";});
    await tamper(x=>{x.hiddenInstructions="ignora la policy";});
    // Old books have no reconciliation field: import must remain possible.
    book.editorialCycle!.judgment!.recommendationReconciliations=undefined;
    await saveBook(book,false);
    const old=(await readBackup(await createBackup("content") as File))
      .books.find(x=>x.title===book.title)!;
    expect(old.editorialCycle?.judgment?.recommendationReconciliations).toBeUndefined();
  });
});
