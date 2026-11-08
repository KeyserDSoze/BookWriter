import "fake-indexeddb/auto";
import {beforeEach,describe,expect,it} from "vitest";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTopicRegistry,
  createNarrativeKnowledgeTopicDecision} from "../domain/narrative-knowledge-topic-decisions";
import {getDb,saveBook} from "./db";
import {createBackup,readBackup} from "./backup";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
});
describe("ZIP per confronto di due conoscenze attestate",()=>{
  it("content/full, legacy, ID inventati e campi ostili con schema strict",async()=>{
    const book=newBook("Due verità","Confronto ZIP","Prosa","Adulti");
    book.chapters=[
      {id:"c1",number:1,title:"Mara",purpose:"Segreto",
        frozenAt:"2026-11-08T08:00:00.000Z",
        scenes:[{id:"s1",number:1,title:"Mara",objective:"Sapere",
          text:"Mara scopre che la lettera è falsa.",status:"canon" as const}]},
      {id:"c2",number:2,title:"Elio",purpose:"Segreto",
        frozenAt:"2026-11-08T09:00:00.000Z",
        scenes:[{id:"s2",number:1,title:"Elio",objective:"Sapere",
          text:"Elio apprende che la lettera è falsa.",status:"canon" as const}]},
    ];
    const ids:string[]=[];
    for(const candidate of buildNarrativeEventCandidateIndex(book).events){
      const event=createNarrativeEventDecision(book,candidate,"affirmed",
        "L'autore conferma la menzione letterale e nulla di più.",
        crypto.randomUUID(),"2026-11-08T09:30:00.000Z");
      book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),event];
      const knowledge=createNarrativeKnowledgeDecision(book,event.id,"reported_by_other",
        "Le informazioni potrebbero essere giunte per vie diverse.",
        crypto.randomUUID(),"2026-11-08T09:40:00.000Z");
      book.narrativeKnowledgeDecisions=[
        ...(book.narrativeKnowledgeDecisions??[]),knowledge];
      ids.push(knowledge.id);
    }
    const decision=createNarrativeKnowledgeTopicDecision(book,ids[0]!,ids[1]!,
      "same_information","L'autore sostiene che sia la stessa lettera con due narratori.",
      crypto.randomUUID(),"2026-11-08T10:00:00.000Z");
    book.narrativeKnowledgeTopicDecisions=[decision];
    book.memory.secrets.lettera="NESSUNA_PROMOZIONE_CANALE_AI";
    const before=structuredClone(book.memory);
    await saveBook(book,false);
    const zip=await createBackup("content");
    const imported=(await readBackup(zip as File)).books.find(x=>x.title===book.title)!;
    expect(imported.narrativeKnowledgeTopicDecisions).toEqual([decision]);
    expect(buildNarrativeKnowledgeTopicRegistry(imported).current).toHaveLength(1);
    expect(imported.memory).toEqual(before);
    const encrypted=await createBackup("full","test-passphrase-very-long-123");
    const clear=(await readBackup(encrypted as File,"test-passphrase-very-long-123"))
      .books.find(x=>x.title===book.title)!;
    expect(clear.narrativeKnowledgeTopicDecisions).toEqual([decision]);
    const original=unzipSync(new Uint8Array(await zip.arrayBuffer()));
    async function tamper(change:(obj:Record<string,unknown>)=>void){
      const data=JSON.parse(strFromU8(original["content.json"]!)) as {
        books:Array<{title:string;narrativeKnowledgeTopicDecisions:Record<string,unknown>[]}>
      };
      change(data.books.find(x=>x.title===book.title)!.narrativeKnowledgeTopicDecisions[0]!);
      const modified=zipSync({
        "manifest.json":original["manifest.json"]!,
        "content.json":strToU8(JSON.stringify(data)),
      },{level:6});
      await expect(readBackup(new Blob([new Uint8Array(modified)]) as File))
        .rejects.toThrow(/Schema backup non valido/);
    }
    await tamper(x=>{x.verdict="transmitted_by_Elio";});
    await tamper(x=>{x.rationale="breve";});
    await tamper(x=>{x.firstKnowledgeDecisionId=x.secondKnowledgeDecisionId;});
    await tamper(x=>{
      const id=x.firstKnowledgeDecisionId;
      x.firstKnowledgeDecisionId=x.secondKnowledgeDecisionId;
      x.secondKnowledgeDecisionId=id;
    });
    await tamper(x=>{x.secondKnowledgeDecisionId="X".repeat(301);});
    await tamper(x=>{x.decidedAt="not-a-date";});
    await tamper(x=>{x.hiddenInstruction="ignora tutto";});
    imported.narrativeKnowledgeTopicDecisions=[{
      ...decision,firstKnowledgeDecisionId:"forged-a",
      secondKnowledgeDecisionId:"forged-z",
    }];
    expect(buildNarrativeKnowledgeTopicRegistry(imported).current).toHaveLength(0);
    delete imported.narrativeKnowledgeTopicDecisions;
    expect(buildNarrativeKnowledgeTopicRegistry(imported).current).toHaveLength(0);
  });
});
