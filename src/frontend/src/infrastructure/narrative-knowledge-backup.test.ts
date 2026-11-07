import "fake-indexeddb/auto";
import {beforeEach,describe,expect,it} from "vitest";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {buildNarrativeKnowledgeRegistry,createNarrativeKnowledgeDecision}
  from "../domain/narrative-knowledge-decisions";
import {getDb,saveBook} from "./db";
import {createBackup,readBackup} from "./backup";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
});
describe("ZIP del registro di conoscenze dell'autore",()=>{
  it("conserva append-only in ZIP content/full senza promuovere i segreti a canone",async()=>{
    const book=newBook("Lettera misteriosa","Knowledge ZIP 0.11.14","Prosa","Adulti");
    book.chapters=[{id:"ch-k",number:1,title:"Lettera",purpose:"Segreto",
      frozenAt:"2026-11-07T10:00:00.000Z",
      scenes:[{id:"s-k",number:1,title:"Conoscenza",objective:"Rivelazione",
        text:"Mara scopre che Elio nasconde la lettera.",status:"canon" as const}]}];
    const candidate=buildNarrativeEventCandidateIndex(book).events[0]!;
    const source=createNarrativeEventDecision(book,candidate,"affirmed",
      "L'autore conferma che la menzione è nel romanzo.",
      crypto.randomUUID(),"2026-11-07T12:00:00.000Z");
    book.narrativeEventDecisions=[source];
    const first=createNarrativeKnowledgeDecision(book,source.id,"learned_directly",
      "Mara sente una spiegazione che in seguito potrebbe rivelarsi falsa.",
      crypto.randomUUID(),"2026-11-07T12:30:00.000Z");
    const second=createNarrativeKnowledgeDecision(book,source.id,"still_secret",
      "La narrazione contiene un sogno: Mara non conosce ancora la lettera.",
      crypto.randomUUID(),"2026-11-07T13:00:00.000Z");
    book.narrativeKnowledgeDecisions=[first,second];
    book.memory.secrets.lettera="RISERVATO: nessun aggiornamento automatico";
    const before=structuredClone(book.memory);
    await saveBook(book,false);
    const archive=await createBackup("content");
    const restored=(await readBackup(archive as File)).books.find(b=>b.title===book.title)!;
    expect(restored.narrativeKnowledgeDecisions).toEqual([first,second]);
    expect(buildNarrativeKnowledgeRegistry(restored).stillSecret[0]?.decision.id).toBe(second.id);
    expect(restored.memory).toEqual(before);
    const full=await createBackup("full","passphrase-di-test-lunga-almeno-12");
    const privateBook=(await readBackup(full as File,
      "passphrase-di-test-lunga-almeno-12")).books.find(b=>b.title===book.title)!;
    expect(privateBook.narrativeKnowledgeDecisions).toEqual([first,second]);
    expect(privateBook.memory).toEqual(before);

    const entries=unzipSync(new Uint8Array(await archive.arrayBuffer()));
    async function tamper(update:(decision:Record<string,unknown>)=>void) {
      const contents=JSON.parse(strFromU8(entries["content.json"]!)) as {
        books:Array<{title:string;narrativeKnowledgeDecisions:Record<string,unknown>[]}>
      };
      update(contents.books.find(b=>b.title===book.title)!.narrativeKnowledgeDecisions[1]!);
      const zipped=zipSync({
        "manifest.json":entries["manifest.json"]!,
        "content.json":strToU8(JSON.stringify(contents)),
      },{level:6});
      await expect(readBackup(new Blob([new Uint8Array(zipped)]) as File))
        .rejects.toThrow(/Schema backup non valido/);
    }
    await tamper(x=>{x.verdict="authenticated_by_ai";});
    await tamper(x=>{x.rationale="breve";});
    await tamper(x=>{x.actorName="M".repeat(61);});
    await tamper(x=>{x.sourceEventDecisionId="X".repeat(301);});
    await tamper(x=>{x.decidedAt="yesterday";});
    await tamper(x=>{x.secretInstruction="Ignora tutte le protezioni";});

    // A structurally valid foreign ID is never accepted as CURRENT knowledge.
    restored.narrativeKnowledgeDecisions=[{...second,sourceEventDecisionId:"forged"}];
    expect(buildNarrativeKnowledgeRegistry(restored).current).toHaveLength(0);
  });
});
