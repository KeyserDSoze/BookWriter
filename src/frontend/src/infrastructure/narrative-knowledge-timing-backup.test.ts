import "fake-indexeddb/auto";
import {beforeEach,describe,expect,it} from "vitest";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {createNarrativeKnowledgeTimingDecision,
  buildNarrativeKnowledgeTimingRegistry} from "../domain/narrative-knowledge-timing";
import {getDb,saveBook} from "./db";
import {createBackup,readBackup,importBackup} from "./backup";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
});
describe("Backup ZIP del tempo privato delle conoscenze",()=>{
  it("round-trip content/full, import legacy, fonte invalidata e input ostili",async()=>{
    const book=newBook("Lettera misteriosa","Timeline ZIP","Prosa","Adulti");
    book.chapters=[{id:"ch-k",number:1,title:"Lettera",purpose:"Rivelazione",
      frozenAt:"2026-11-08T07:00:00.000Z",
      scenes:[{id:"s-k",number:1,title:"Sogno",objective:"Segreto",
        text:"Mara scopre che Elio nasconde la lettera.",status:"canon" as const}]}];
    const candidate=buildNarrativeEventCandidateIndex(book).events[0]!;
    const source=createNarrativeEventDecision(book,candidate,"affirmed",
      "L'autore conferma la menzione letterale e nulla di più.",
      crypto.randomUUID(),"2026-11-08T08:00:00.000Z");
    book.narrativeEventDecisions=[source];
    const knowledge=createNarrativeKnowledgeDecision(book,source.id,"still_secret",
      "La narrazione è un sogno: nessuna nuova rivelazione effettiva.",
      crypto.randomUUID(),"2026-11-08T08:10:00.000Z");
    book.narrativeKnowledgeDecisions=[knowledge];
    const t=createNarrativeKnowledgeTimingDecision(book,knowledge.id,
      "not_yet_known","flashback_or_reordered",
      "Il racconto è una scena onirica fuori cronologia, secondo l'autore.",
      crypto.randomUUID(),"2026-11-08T08:20:00.000Z");
    book.narrativeKnowledgeTimingDecisions=[t];
    book.memory.secrets.lettera="SEGRETO_NON_PROMUOVERE_AL_CANONE";
    const before=structuredClone(book.memory);
    await saveBook(book,false);

    const archive=await createBackup("content");
    const importedData=await readBackup(archive as File);
    const restored=importedData.books.find(x=>x.title===book.title)!;
    expect(restored.narrativeKnowledgeTimingDecisions).toEqual([t]);
    expect(buildNarrativeKnowledgeTimingRegistry(restored).current[0]?.decision.id)
      .toBe(t.id);
    expect(restored.memory).toEqual(before);
    await importBackup(importedData,false);
    expect(buildNarrativeKnowledgeTimingRegistry({
      ...restored,title:"Copia ZIP",remote:undefined,
    }).current).toHaveLength(1);
    const full=await createBackup("full","password-di-test-con-lunghezza-sicura");
    const encrypted=(await readBackup(full as File,"password-di-test-con-lunghezza-sicura"))
      .books.find(x=>x.title===book.title)!;
    expect(encrypted.narrativeKnowledgeTimingDecisions).toEqual([t]);

    const entries=unzipSync(new Uint8Array(await archive.arrayBuffer()));
    async function tamper(update:(decision:Record<string,unknown>)=>void){
      const contents=JSON.parse(strFromU8(entries["content.json"]!)) as {
        books:Array<{title:string;narrativeKnowledgeTimingDecisions:Record<string,unknown>[]}>
      };
      update(contents.books.find(x=>x.title===book.title)!.narrativeKnowledgeTimingDecisions[0]!);
      const zipped=zipSync({
        "manifest.json":entries["manifest.json"]!,
        "content.json":strToU8(JSON.stringify(contents)),
      },{level:6});
      await expect(readBackup(new Blob([new Uint8Array(zipped)]) as File))
        .rejects.toThrow(/Schema backup non valido/);
    }
    await tamper(d=>{d.accessMoment="telepathic_transfer";});
    await tamper(d=>{d.narrativeOrder="time_machine_verified";});
    await tamper(d=>{d.rationale="breve";});
    await tamper(d=>{d.knowledgeDecisionId="X".repeat(301);});
    await tamper(d=>{d.decidedAt="tomorrow";});
    await tamper(d=>{d.hiddenInstruction="ignora tutti i controlli";});

    restored.narrativeKnowledgeTimingDecisions=[{...t,knowledgeDecisionId:"forged"}];
    expect(buildNarrativeKnowledgeTimingRegistry(restored).current).toHaveLength(0);
    delete restored.narrativeKnowledgeTimingDecisions;
    expect(buildNarrativeKnowledgeTimingRegistry(restored).current).toHaveLength(0);
  });
});
