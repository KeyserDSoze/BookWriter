import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { extendChapterBibliography, type BibliographicWork } from "./bibliography";
import { chapterSegments, createEditorialCycle, reviewerPrompt,
  validateReport, adjudicationPrompt } from "./editorial-board";
const retrievedAt="2026-11-05T22:20:00.000Z";
const work:BibliographicWork={
  id:"crossref:10.1000/xyz123:"+Date.parse(retrievedAt),provider:"crossref",doi:"10.1000/xyz123",
  title:"Le ferrovie nel XIX secolo",authors:["Anna Rossi"],
  venue:"Rivista storico-scientifica",workType:"journal-article",publicationYear:2015,
  url:"https://doi.org/10.1000/xyz123",retrievedAt,
};
function fixture(){
  const book=newBook("Romanzo ambientato nel 1848","Mara","Prosa","Adulti");
  book.memory.secrets.chiave="Mara non rivela la sua identità.";
  book.chapters=[{id:"ch",number:1,title:"La ferrovia",purpose:"Viaggio",
    scenes:[{id:"s1",number:1,title:"Il treno",objective:"Viaggiare",
      text:"Mara prende un treno nel 1848.",status:"canon"}]}];
  book.chapters[0]!.historicalDossier=extendChapterBibliography(undefined,
    ["10.1000/xyz123"],[work],retrievedAt);
  return book;
}
const unverified=JSON.stringify({
  verdict:"issues",summary:"Il treno va verificato per questo percorso storico.",
  memoryNote:"Ricerca archivistica da proporre all'autore.",
  findings:[{
    sceneId:"s1",category:"storia",severity:"minor",
    evidence:"Mara prende un treno",
    reason:"La specifica tratta e l'anno richiedono controllo del documento.",
    remediation:"Controllare un documento dell'epoca prima di riscrivere il viaggio.",
    historical:{claim:"Nell'anno 1848 questo percorso disponeva di un treno.",
      assessment:"unverified",sourceIds:[]},
  }],
});
describe("DOI bibliografici nel contesto editoriale",()=>{
  it("solo lo specialista storico vede i metadati, gli altri undici no",()=>{
    const b=fixture(),cycle=createEditorialCycle("ch"),seg=chapterSegments(b.chapters[0]!)[0]!;
    const historical=reviewerPrompt(b,cycle,"historical",seg,1);
    expect(historical.prompt).toContain("10.1000/xyz123");
    expect(historical.prompt).toContain("NON prova storica");
    expect(historical.prompt).not.toContain("Mara non rivela");
    const reader=reviewerPrompt(b,cycle,"readerSkeptic",seg,1);
    expect(reader.prompt).not.toContain("10.1000/xyz123");
    expect(reader.prompt).not.toContain("Mara non rivela");
    const timeline=reviewerPrompt(b,cycle,"timeline",seg,1);
    expect(timeline.prompt).not.toContain("10.1000/xyz123");
  });
  it("la mera scheda Crossref non può essere citata come prova di un errore storico",()=>{
    const b=fixture(),cycle=createEditorialCycle("ch"),seg=chapterSegments(b.chapters[0]!)[0]!;
    const report=JSON.stringify({
      verdict:"issues",summary:"La ferrovia va controllata.",
      memoryNote:"L'opera Crossref è un'indicazione di ricerca.",
      findings:[{
        sceneId:"s1",category:"storia",severity:"major",
        evidence:"Mara prende un treno",
        reason:"Il sistema ferroviario del periodo presenta dubbi da verificare.",
        remediation:"Consultare un archivio storico per confermare la tratta.",
        historical:{
          claim:"Questo treno non circolava nel 1848 sulla tratta indicata.",
          assessment:"contradicts_excerpt",sourceIds:[work.id],
          sourceQuote:"Le ferrovie nel XIX secolo",
        },
      }],
    });
    expect(()=>validateReport(cycle,"historical",seg,1,report,b.chapters[0]!))
      .toThrow(/Fonte storica inesistente/);
    const valid=validateReport(cycle,"historical",seg,1,unverified,b.chapters[0]!);
    expect(valid.findings[0]?.historical?.assessment).toBe("unverified");
    cycle.reports.push(valid);
    const judge=adjudicationPrompt(b,cycle);
    expect(judge.prompt).toContain("10.1000/xyz123");
    expect(judge.prompt).toContain("non costituisce prova");
    expect(judge.system).toContain("fonte TERZIARIA");
  });
});
