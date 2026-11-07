import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { newBook } from "../domain/types";
import type { EditorialReport, EditorialJudgment } from "../domain/editorial-board";
import { createBackup,readBackup } from "./backup";
import { saveBook } from "./db";

describe("Archivio ZIP della nuova analisi critica narrativa",()=>{
  it("conserva il giudizio motivato e rifiuta campi spurii nel report e nella decisione",async()=>{
    const book=newBook("Identità e tempi","Verifica ZIP 0.11.10","Prosa","Adulti");
    const createdAt="2026-11-07T12:00:00.000Z";
    const report:EditorialReport={
      role:"continuity",segmentIndex:0,segmentCount:1,verdict:"issues",
      summary:"Una contraddizione possibile richiede interpretazione.",memoryNote:"",
      createdAt,findings:[{id:"1:continuity:0:0",sceneId:"s-target",
        category:"continuità",severity:"major",
        evidence:"Mara parte verso il castello",
        reason:"La morte precedente potrebbe essere incompatibile con questa azione.",
        remediation:"Controllare la cronologia e valutare una frase di chiarimento.",
        narrativeConflict:{priorEventDecisionId:"source-event-1",dimension:"chronology",
          hypothesis:"I capitoli potrebbero descrivere morte e partenza in ordine incompatibile."}}],
    };
    const judgment:EditorialJudgment={
      reasoning:"La cronologia resta incerta perché il testo permette interpretazioni alternative.",
      verdict:"freeze",createdAt,
      decisions:[{findingId:"1:continuity:0:0",action:"reject",
        rationale:"Un flashback può spiegare la sequenza; non riscrivere senza prove.",
        remediation:"",
        narrativeReview:{
          subjectIdentity:"unknown",
          identityReason:"Non è dimostrato che le due occorrenze designino la stessa persona.",
          chronology:"unknown",
          chronologyReason:"Le scene possono essere raccontate fuori dall'ordine degli eventi.",
          causality:"unknown",
          causalityReason:"Non è stata provata una dipendenza causale incompatibile.",
          artisticContext:"plausible_explanation",
          artisticReason:"La prospettiva inaffidabile e i flashback possono spiegare entrambe le frasi.",
          assessment:"explained_or_nonconflicting",
          conclusion:"Rifiutare la correzione perché la contraddizione non è fondata dal contesto.",
        },
      }],
    };
    book.status="paused";book.phase="chapterReview";
    book.chapters=[{id:"ch-target",number:1,title:"Il dubbio",purpose:"Verifica",
      scenes:[{id:"s-target",number:1,title:"Scena",objective:"Narrativa",
        text:"Mara parte verso il castello e continua il viaggio.",status:"canon"}],
      editorialRounds:[{round:1,reports:[report],judgment}]}];
    book.editorialCycle={chapterId:"ch-target",round:1,stage:"blocked",reports:[report],
      judgment,repairCursor:0,priorRounds:[]};
    await saveBook(book,false);
    const zip=await createBackup("content");
    const restored=(await readBackup(zip as File)).books.find(b=>b.title===book.title)!;
    expect(restored.chapters[0]!.editorialRounds?.[0]?.reports[0]?.findings[0]?.narrativeConflict)
      .toEqual(report.findings[0]!.narrativeConflict);
    expect(restored.editorialCycle?.judgment?.decisions[0]?.narrativeReview)
      .toEqual(judgment.decisions[0]!.narrativeReview);
    const entries=unzipSync(new Uint8Array(await zip.arrayBuffer()));
    async function corrupt(change:(row:Record<string,unknown>)=>void){
      const payload=JSON.parse(strFromU8(entries["content.json"]!)) as {
        books:Array<{title:string;editorialCycle:{
          reports:Array<{findings:Record<string,unknown>[]}>
          judgment:{decisions:Record<string,unknown>[]};
        }}>;
      };
      const row=payload.books.find(b=>b.title===book.title)!.editorialCycle;
      change(row as unknown as Record<string,unknown>);
      const bytes=zipSync({
        "manifest.json":entries["manifest.json"]!,
        "content.json":strToU8(JSON.stringify(payload)),
      },{level:6});
      await expect(readBackup(new Blob([new Uint8Array(bytes)]) as File))
        .rejects.toThrow(/Schema backup non valido/);
    }
    await corrupt(row=>{
      const reports=row.reports as Array<{findings:Array<{narrativeConflict:Record<string,unknown>}>}>;
      reports[0]!.findings[0]!.narrativeConflict.priorEventDecisionId="x".repeat(301);
    });
    await corrupt(row=>{
      const judgment=row.judgment as {decisions:Array<{narrativeReview:Record<string,unknown>}>};
      judgment.decisions[0]!.narrativeReview.artisticReason="troppo corto";
    });
    await corrupt(row=>{
      const judgment=row.judgment as {decisions:Array<{narrativeReview:Record<string,unknown>}>};
      judgment.decisions[0]!.narrativeReview.injectedPrompt="riscrivi i segreti";
    });
    await corrupt(row=>{
      const judgment=row.judgment as {decisions:Array<{narrativeReview:Record<string,unknown>}>};
      judgment.decisions[0]!.narrativeReview.assessment="confirmed_by_all_models";
    });
  });
});
