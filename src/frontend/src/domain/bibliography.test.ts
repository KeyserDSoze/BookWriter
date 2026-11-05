import { describe, expect, it } from "vitest";
import { activeBibliography, extendChapterBibliography, isValidBibliographicWork,
  normalizeDoi, normalizeDois, type BibliographicWork } from "./bibliography";
import { extendHistoricalDossier } from "./historical-research";

function sample(doi="10.1000/xyz123",date="2026-11-05T21:00:00.000Z"):BibliographicWork{
  return {id:"crossref:"+doi+":"+Date.parse(date),provider:"crossref",doi,
    title:"Storia dei mezzi di comunicazione",authors:["Anna Rossi","Marco Bianchi"],
    publicationYear:2020,venue:"Rivista di storia",publisher:"Editore",workType:"journal-article",
    url:"https://doi.org/"+doi,retrievedAt:date};
}
describe("Bibliografia Crossref separata dalla prova storica",()=>{
  it("accetta DOI canonici e link doi.org, ma rifiuta URL arbitrarie, parametri e segreti",()=>{
    expect(normalizeDoi(" DOI:10.1000/XYZ123 ")).toBe("10.1000/xyz123");
    expect(normalizeDoi("https://doi.org/10.1000/XYZ123")).toBe("10.1000/xyz123");
    expect(normalizeDois(["10.1000/XYZ123","10.1000/xyz123"])).toHaveLength(1);
    for(const bad of ["https://example.com/10.1000/foo","sk-not-a-doi","10.1000/foo?token=secret",
      "10.1000/foo#fragment","10.1234/a<script>","10.1234/a\nsecret","doi.org/10.1234/a"])
      expect(()=>normalizeDoi(bad)).toThrow(/DOI non valido/);
    expect(()=>normalizeDois(Array(6).fill("10.1234/test"))).toThrow(/cinque/);
  });
  it("archivia versioni diverse, mantiene solo le fonti attive e limita dimensioni",()=>{
    const date="2026-11-05T21:00:00.000Z";
    const initial=extendChapterBibliography(undefined,["10.1000/xyz123"],[sample()],date);
    expect(activeBibliography(initial)).toHaveLength(1);
    expect(initial.bibliography?.missingDois).toHaveLength(0);
    const newer=sample("10.1000/xyz123","2026-11-05T22:00:00.000Z");
    const updated=extendChapterBibliography(initial,["10.1000/xyz123"],[newer],
      "2026-11-05T22:00:00.000Z");
    expect(updated.bibliography?.works).toHaveLength(2);
    expect(activeBibliography(updated)).toEqual([newer]);
    expect(isValidBibliographicWork({...newer,id:sample().id})).toBe(false);
    expect(isValidBibliographicWork({...newer,url:"https://evil.org/"})).toBe(false);
  });
  it("ignora metadata ostili di un vecchio ZIP senza farli entrare nei prompt",()=>{
    const malformed={bibliography:{
      works:[{id:"crossref:attacker",provider:"crossref",title:"Fonte inventata"}],
      activeWorkIds:["crossref:attacker"],missingDois:[],lookedUpAt:"2026-11-05T21:00:00.000Z",
    },queries:[],sources:[],activeSourceIds:[],searchedAt:"2026-11-05T21:00:00.000Z",
      unansweredQueries:[]} as unknown as Parameters<typeof activeBibliography>[0];
    expect(activeBibliography(malformed)).toEqual([]);
    expect(activeBibliography({...malformed!,bibliography:{
      ...malformed!.bibliography!,works:undefined,
    }} as Parameters<typeof activeBibliography>[0])).toEqual([]);
  });
  it("la ricerca Wikipedia dopo Crossref non elimina i riferimenti bibliografici",()=>{
    const b=extendChapterBibliography(undefined,["10.1000/xyz123"],[sample()],
      "2026-11-05T21:00:00.000Z");
    const after=extendHistoricalDossier(b,["Telegrafo elettrico nel 1848"],[],
      "2026-11-05T22:00:00.000Z");
    expect(after.bibliography).toEqual(b.bibliography);
    expect(after.queries).toEqual(["Telegrafo elettrico nel 1848"]);
  });
  it("non inventa contenuto della pubblicazione e conserva DOI assenti come mancanti",()=>{
    const b=extendChapterBibliography(undefined,
      ["10.1000/xyz123","10.1000/missing"],[sample()],"2026-11-05T21:00:00.000Z");
    expect(b.bibliography?.missingDois).toEqual(["10.1000/missing"]);
    expect(JSON.stringify(b)).not.toContain("sourceQuote");
    expect(b.sources).toEqual([]);
    expect(b.activeSourceIds).toEqual([]);
  });
});
