import { describe, expect, it } from "vitest";
import { newBook } from "../domain/types";
import {
  MAX_SEMANTIC_SCENES, MAX_SCENE_EMBED_CHARS, semanticScenes,
  rankSemanticScenes, relatedSemanticScenes, semanticEmbeddingInput,
} from "./semantic-search";

describe("Ricerca semantica: solo scene canoniche, dati minimizzati",()=>{
  it("esclude bozze e memoria privata, tronca lunghi testi e limita le scene",()=>{
    const book=newBook("Brief riservato","Titolo","Stile","Adulti");
    book.memory.secrets["privato"]="Non spedire";
    book.chapters=[{id:"ch",number:1,title:"Origini",purpose:"Piano",scenes:[
      {id:"draft",number:0,title:"Segreta",objective:"Bozza",text:"bozza da non inviare",status:"draft"},
      ...Array.from({length:MAX_SEMANTIC_SCENES+2},(_,i)=>({
        id:"scene"+i,number:i+1,title:"Scena "+i,objective:"Nessuno",
        text:"testo canonico "+ "a".repeat(2000),status:"canon" as const,
      })),
    ]}];
    const index=semanticScenes(book);
    expect(index.scenes).toHaveLength(MAX_SEMANTIC_SCENES);
    expect(index.omitted).toBe(2);
    expect(index.scenes[0]?.excerpt.length).toBe(MAX_SCENE_EMBED_CHARS);
    expect(JSON.stringify(index)).not.toContain("Non spedire");
    expect(JSON.stringify(index)).not.toContain("bozza da non inviare");
  });
  it("prefix di ricerca soltanto per modelli Nomic Embed Text",()=>{
    expect(semanticEmbeddingInput("il ponte","text-embedding-nomic-embed-text-v1.5",false))
      .toBe("search_document: il ponte");
    expect(semanticEmbeddingInput("il ponte","text-embedding-nomic-embed-text-v1.5",true))
      .toBe("search_query: il ponte");
    expect(semanticEmbeddingInput("il ponte","generic-embedding",true)).toBe("il ponte");
  });
  it("correla scene canoniche dall'indice esistente, esclude quella di partenza",()=>{
    const scene=(id:string)=>({id,chapter:1,chapterTitle:"Capitolo",number:1,title:id,excerpt:id});
    const scenes=[scene("ponte"),scene("custode"),scene("foresta")];
    const vectors=[[1,0,0],[0.9,0.1,0],[0,1,0]];
    const result=relatedSemanticScenes(scenes,vectors,"ponte",5);
    expect(result.map(x=>x.scene.id)).toEqual(["custode","foresta"]);
    expect(result.some(x=>x.scene.id==="ponte")).toBe(false);
    expect(()=>relatedSemanticScenes(scenes,vectors,"inesistente")).toThrow(/non presente/);
    expect(()=>relatedSemanticScenes(scenes,vectors.slice(1),"ponte")).toThrow(/incoerente/);
    expect(()=>relatedSemanticScenes(scenes,[[0,0,0],...vectors.slice(1)],"ponte"))
      .toThrow(/non valido/);
    expect(relatedSemanticScenes([scene("sola")],[[1,2]],"sola")).toEqual([]);
  });
  it("ordina per coseno senza risposte inventate",()=>{
    const scene=(id:string)=>({id,chapter:1,chapterTitle:"Test",number:1,title:id,excerpt:id});
    const result=rankSemanticScenes([scene("ponte"),scene("foresta")],[[1,0,0],[0,1,0]],[0.9,0.1,0]);
    expect(result.map(x=>x.scene.id)).toEqual(["ponte","foresta"]);
    expect(()=>rankSemanticScenes([scene("ponte")],[[1,0]],[1,0,0])).toThrow(/Dimensione/);
    expect(()=>rankSemanticScenes([scene("ponte")],[[0,0]],[1,0])).toThrow(/non valido/);
  });
});
