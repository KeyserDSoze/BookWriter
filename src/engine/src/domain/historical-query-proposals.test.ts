import { describe, expect, it } from "vitest";
import { normalizeResearchQueries } from "./historical-research";
import { proposeHistoricalQueriesLocally } from "./historical-query-proposals";

describe("Proposte di ricerca storica soltanto locali",()=>{
  it("propone temi pubblici e anno esplicito, mai nomi o frasi di trama",()=>{
    const proposals=proposeHistoricalQueriesLocally([
      {text:"Nel 1848 Mara spedisce un dispaccio dal telegrafo elettrico. " +
        "La chiave segreta è custodita sotto la scala, nessuno deve sapere di Alina."},
      {text:"Nel 1850 arriva un treno attraverso la valle, mentre Alina osserva da lontano."},
    ]);
    expect(proposals).toEqual(["Telegrafo elettrico 1848","Trasporti ferroviari 1850"]);
    const serialized=proposals.join(" ");
    for(const secret of ["Mara","Alina","chiave","scala","dispaccio","segreta"])
      expect(serialized).not.toContain(secret);
    expect(normalizeResearchQueries(proposals)).toEqual(proposals);
  });

  it("non inventa una data se assente o fuori contesto",()=>{
    expect(proposeHistoricalQueriesLocally([{text:"La protagonista usa un telegrafo."}]))
      .toEqual(["Telegrafo elettrico storia"]);
    expect(proposeHistoricalQueriesLocally([
      {text:"Nel 1848 la protagonista trova un diario. " +
        "Questa è una lunga parentesi senza relazione storica. ".repeat(5) +
        "Poi un telegrafo squilla in una stanza."},
    ])).toEqual(["Telegrafo elettrico storia"]);
    expect(proposeHistoricalQueriesLocally([{text:"Nel 1280 usa un telegrafo."}]))
      .toEqual(["Telegrafo elettrico storia"]);
  });

  it("non confonde la parola Telegram con la tecnologia telegrafica",()=>{
    expect(proposeHistoricalQueriesLocally([
      {text:"Mara usa Telegram per scrivere a un amico; un codice top secret."},
    ])).toEqual([]);
  });

  it("produce al massimo cinque temi distinti, in ordine di prima comparsa",()=>{
    const text="Nel 1848 compaiono un treno, un telegrafo, un dagherrotipo, " +
      "la vaccinazione, i lampioni a gas e una locomotiva; poi il cinematografo.";
    const result=proposeHistoricalQueriesLocally([
      {text},{text:"Nel 1900 il telegrafo funziona ancora."},
    ]);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("Trasporti ferroviari 1848");
    expect(result[1]).toBe("Telegrafo elettrico 1848");
    expect(new Set(result).size).toBe(5);
  });

  it("non restituisce testo non controllato in presenza di input ostile, date o segreti",()=>{
    const malicious=[
      "sk-verysecret00000000000", "https://example.com/private",
      "Mara Alina LordSegreto", "-----BEGIN PRIVATE KEY-----",
      "Il diario contiene un indizio inedito e una password.",
    ].join(" ");
    const proposal=proposeHistoricalQueriesLocally([{text:malicious+" Nel 1848 compare un telegrafo."}]);
    expect(proposal).toEqual(["Telegrafo elettrico 1848"]);
    expect(proposal.join(" ")).not.toMatch(/sk-|https?:|mara|alina|password|secret|private/i);
  });

  it("resta limitato e sicuro anche per scene importate incomplete",()=>{
    expect(proposeHistoricalQueriesLocally([])).toEqual([]);
    expect(proposeHistoricalQueriesLocally([{}])).toEqual([]);
    expect(proposeHistoricalQueriesLocally([{text:""}])).toEqual([]);
    expect(proposeHistoricalQueriesLocally([
      ...Array.from({length:16},()=>({text:"Un diario senza temi storici riconoscibili."})),
      {text:"Nel 1850 un treno parte dalla stazione."},
    ])).toEqual([]);
    expect(proposeHistoricalQueriesLocally(
      [{text:"x".repeat(24_001)+" Telegrafo del 1848"}])).toEqual([]);
  });
});
