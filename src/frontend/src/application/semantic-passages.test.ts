import { describe, expect, it } from "vitest";
import { newBook } from "../domain/types";
import {
  MAX_SCENE_EMBED_CHARS, MAX_SCENE_EMBED_PASSAGES, MAX_SEMANTIC_PASSAGES,
  MAX_SEMANTIC_SCENES, rankSemanticPassages, relatedSemanticPassages,
  sampleSemanticPassages, semanticScenes, type SemanticScene,
} from "./semantic-search";

const scene = (id:string,passages:string[]):SemanticScene=>({
  id,chapter:1,chapterTitle:"Capitolo",number:1,title:id,
  excerpt:passages[0]!,passages,uncoveredCharacters:0,
});

describe("Campionamento controllato di scene per embedding locale",()=>{
  it("scene brevi: copertura integrale in ordine, senza duplicazioni",()=>{
    const value="La memoria racconta tutto. ".repeat(110);
    const sampled=sampleSemanticPassages(value);
    expect(sampled.passages.length).toBeGreaterThan(1);
    expect(sampled.passages.length).toBeLessThanOrEqual(MAX_SCENE_EMBED_PASSAGES);
    expect(sampled.passages.join("")).toBe(value.trim());
    expect(sampled.uncoveredCharacters).toBe(0);
    expect(sampled.passages.every(p=>p.length<=MAX_SCENE_EMBED_CHARS)).toBe(true);
    expect(sampleSemanticPassages("  ")).toEqual({passages:[],uncoveredCharacters:0});
  });
  it("scene lunghe: incipit, centro e finale inclusi, area saltata dichiarata",()=>{
    const value="INCIPIT "+("prima ".repeat(450))+
      "CENTRO "+("mezzo ".repeat(600))+
      "FINALE "+("ultimo ".repeat(450));
    expect(value.length).toBeGreaterThan(MAX_SCENE_EMBED_CHARS*3);
    const sampled=sampleSemanticPassages(value);
    expect(sampled.passages).toHaveLength(3);
    expect(sampled.passages[0]).toContain("INCIPIT");
    expect(sampled.passages[1]).toContain("mezzo");
    expect(sampled.passages[2]).toContain("ultimo");
    expect(sampled.uncoveredCharacters).toBeGreaterThan(0);
    expect(sampled.uncoveredCharacters+sampled.passages.reduce((sum,p)=>sum+p.length,0))
      .toBe(value.length);
    expect(sampled.passages.every(p=>p.length<=MAX_SCENE_EMBED_CHARS)).toBe(true);
  });
  it("nessun taglio di coppie surrogate per emoji a confine o scene lunghe",()=>{
    const value="🌲".repeat(800)+" passaggio "+"🌊".repeat(1500)+" fine";
    const {passages}=sampleSemanticPassages(value);
    expect(passages).toHaveLength(3);
    for(const passage of passages) {
      expect(passage).not.toMatch(/^[\uDC00-\uDFFF]/u);
      expect(passage).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(passage.length).toBeLessThanOrEqual(MAX_SCENE_EMBED_CHARS);
    }
  });
  it("ai confini UTF-16 più difficili non supera tre passaggi e non duplica campioni",()=>{
    const value="a".repeat(1399)+"🌲"+"b".repeat(1399)+"🌲"+"c".repeat(1398);
    expect(value.length).toBe(MAX_SCENE_EMBED_CHARS*MAX_SCENE_EMBED_PASSAGES);
    const result=sampleSemanticPassages(value);
    expect(result.passages).toHaveLength(3);
    expect(result.passages.every(p=>p.length<=MAX_SCENE_EMBED_CHARS)).toBe(true);
    expect(result.uncoveredCharacters+
      result.passages.reduce((sum,p)=>sum+p.length,0)).toBe(value.length);
    for(const passage of result.passages){
      expect(passage).not.toMatch(/^[\uDC00-\uDFFF]/u);
      expect(passage).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
  });
  it("mantiene solo canon, esclude segreti e limita numero di scene/vettori",()=>{
    const book=newBook("brief privato","Titolo","Genere","Adulti");
    book.memory.secrets["secret"]="TOP SECRET MEMORY";
    const huge="Il castello. ".repeat(500);
    book.chapters=[{id:"ch",number:1,title:"I protagonisti",purpose:"cap",scenes:[
      {id:"draft",number:0,title:"Bozza",objective:"privata",text:"TOP SECRET DRAFT",status:"draft"},
      ...Array.from({length:MAX_SEMANTIC_SCENES+2},(_,i)=>({
        id:"canon"+i,number:i+1,title:"Scena"+i,objective:"test",
        text:huge,status:"canon" as const,
      })),
    ]}];
    const snapshot=semanticScenes(book);
    expect(snapshot.scenes).toHaveLength(MAX_SEMANTIC_SCENES);
    expect(snapshot.omitted).toBe(2);
    expect(snapshot.scenes.flatMap(s=>s.passages??[])).toHaveLength(MAX_SEMANTIC_PASSAGES);
    expect(JSON.stringify(snapshot)).not.toContain("TOP SECRET MEMORY");
    expect(JSON.stringify(snapshot)).not.toContain("TOP SECRET DRAFT");
  });
});
describe("Rilevanza semantica da passaggi, senza ulteriori richieste",()=>{
  it("sceglie il passaggio nel finale come miglior match e mostra una sola voce per scena",()=>{
    const scenes=[scene("scenaA",["incipit generico","ponte segreto finale"]),
      scene("scenaB",["bosco diverso"])];
    const vectors=[[[0,1,0],[1,0,0]],[[0,0,1]]];
    const matches=rankSemanticPassages(scenes,vectors,[1,0,0]);
    expect(matches.map(m=>m.scene.id)).toEqual(["scenaA","scenaB"]);
    expect(matches[0]).toMatchObject({passageNumber:2,matchedExcerpt:"ponte segreto finale",similarity:1});
    expect(matches).toHaveLength(2);
  });
  it("continuità confronta tutti i passaggi, esclude la fonte e non duplicare scene",()=>{
    const scenes=[scene("origine",["paragrafo1","segreto ultimo"]),
      scene("vicina",["inizio","vicina al segreto"]),
      scene("altra",["mare"])];
    const vectors=[[[0,1,0],[1,0,0]],[[0,0,1],[0.95,0.05,0]],[[0,0,1]]];
    const matches=relatedSemanticPassages(scenes,vectors,"origine");
    expect(matches.map(m=>m.scene.id)).toEqual(["vicina","altra"]);
    expect(matches[0]).toMatchObject({passageNumber:2,matchedExcerpt:"vicina al segreto"});
    expect(matches.some(m=>m.scene.id==="origine")).toBe(false);
  });
  it("rifiuta passaggi mancanti, vettori zero e dimensioni incoerenti",()=>{
    const scenes=[scene("a",["inizio","fine"]),scene("b",["solo"])];
    expect(()=>rankSemanticPassages(scenes,[[[1,0]],[[1,0]]],[1,0]))
      .toThrow(/incoerente/);
    expect(()=>rankSemanticPassages(scenes,[[[1,0],[0,1]],[[1,0,0]]],[1,0]))
      .toThrow(/Dimensione/);
    expect(()=>rankSemanticPassages(scenes,[[[1,0],[0,0]],[[1,0]]],[1,0]))
      .toThrow(/non valido/);
    expect(()=>rankSemanticPassages(scenes,[[[1,0],[0,1]],[[1,0]]],[1,0,0]))
      .toThrow(/Vettore/);
    expect(()=>relatedSemanticPassages(scenes,[[[1,0],[0,1]],[[1,0]]],"missing"))
      .toThrow(/non presente/);
  });
});
