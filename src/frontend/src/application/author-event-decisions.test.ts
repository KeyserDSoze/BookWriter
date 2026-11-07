import "fake-indexeddb/auto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {newBook,type BookProject} from "../domain/types";
import {extractNarrativeEventCandidates} from "../domain/narrative-event-candidates";
import {confirmedAuthorNarrativeEvents} from "../domain/author-event-decisions";
import {getBook,getDb,listActivities,saveBook} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {decideAuthorNarrativeEvent} from "./author-event-decisions";

const note="Confermo come autore: la consegna è realmente avvenuta davanti al guardiano.";
async function sample():Promise<BookProject>{
  const b=newBook("Un segreto","La chiave","Stile","Adulti");
  b.status="completed";b.phase="completed";
  b.memory.secrets.canon="PRIVATO: la vera chiave è nascosta nel pozzo.";
  b.chapters=[1,2,3].map(n=>({
    id:"ch-"+n,number:n,title:"Capitolo "+n,purpose:"Sviluppo",
    frozenAt:"2026-11-07T10:00:00.000Z",
    summary:"Capitolo "+n+" sintetizzato.",
    bookSummaryAtFreeze:"Sinossi globale fino al capitolo "+n,
    scenes:[{
      id:"s-"+n,number:1,title:"Scene",objective:"Sviluppare",
      text:n===1?"Mara consegna la chiave a Elio. Poi la porta si chiude."
        :"Elio cerca la chiave per aprire la porta.",
      status:"canon" as const,characters:["Elio","Mara"],items:["chiave"],
    }],
  }));
  b.bookSummary="Sinossi globale fino al capitolo 3";
  b.remote={owner:"owner",repository:"book",branch:"main",autoSync:true};
  await saveBook(b);
  return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const)await db.clear(store);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,cb:(lock:object)=>Promise<unknown>
  )=>cb({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
const eventOf=(b:BookProject)=>extractNarrativeEventCandidates(b.chapters[0]!,
  b.chapters[0]!.scenes[0]!)[0]!;

describe("Decisioni autore atomiche e conservatrici",()=>{
  it("conferma solo per consenso, lascia la scena sorgente congelata e riapre la valle",async()=>{
    const b=await sample(),candidate=eventOf(b);
    const spy=vi.fn();vi.stubGlobal("fetch",spy);
    expect(await getOutbox(b.id)).toBeDefined();
    await expect(decideAuthorNarrativeEvent(b.id,b.updatedAt,candidate,
      "confirmed",note,false as true)).rejects.toThrow(/conferma esplicita/);
    expect((await getBook(b.id))?.chapters[0]?.authorEventDecisions).toBeUndefined();
    const result=await decideAuthorNarrativeEvent(b.id,b.updatedAt,candidate,"confirmed",note,true);
    expect(result.downstreamReopened).toBe(2);
    const saved=(await getBook(b.id))!;
    expect(saved.chapters[0]?.frozenAt).toBeDefined();
    expect(saved.chapters[0]?.scenes[0]?.text).toBe(b.chapters[0]?.scenes[0]?.text);
    expect(confirmedAuthorNarrativeEvents(saved.chapters[0]!,saved.chapters[0]!.scenes[0]!))
      .toHaveLength(1);
    expect(saved.chapters.slice(1).every(ch=>!ch.frozenAt)).toBe(true);
    expect(saved.chapters[1]?.continuityRecheck).toMatchObject({
      originChapterId:"ch-1",trigger:"author_event_attestation",originSceneIds:["s-1"],
    });
    expect(saved.editorialCycle).toMatchObject({chapterId:"ch-2",stage:"review"});
    expect(saved.status).toBe("paused");
    expect(saved.bookSummary).toBe("Sinossi globale fino al capitolo 1");
    expect(saved.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect((await listActivities(b.id)).some(x=>
      x.title==="Decisione autore su menzione narrativa"&&
      x.summary?.includes("2 capitoli successivi"))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("respingere un candidato mai confermato NON riapre capitoli validi",async()=>{
    const b=await sample();
    const result=await decideAuthorNarrativeEvent(b.id,b.updatedAt,eventOf(b),
      "rejected","Il guardiano sta riportando una menzogna del protagonista.",true);
    const saved=(await getBook(b.id))!;
    expect(result.downstreamReopened).toBe(0);
    expect(saved.chapters.every(ch=>!!ch.frozenAt)).toBe(true);
    expect(saved.editorialCycle).toBeUndefined();
    expect(saved.chapters[0]?.authorEventDecisions?.[0]?.verdict).toBe("rejected");
    expect(saved.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
  });

  it("blocca scheda concorrente, timestamp vecchio, review in corso e scena obsoleta",async()=>{
    const b=await sample(),event=eventOf(b);
    await expect(decideAuthorNarrativeEvent(b.id,"2024-01-01T00:00:00.000Z",
      event,"confirmed",note,true)).rejects.toThrow(/è cambiato/);
    const afterCas=await getBook(b.id);
    expect(afterCas?.chapters[0]?.authorEventDecisions).toBeUndefined();
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_options:unknown,cb:(lock:null)=>Promise<unknown>
    )=>cb(null)}});
    await expect(decideAuthorNarrativeEvent(b.id,b.updatedAt,event,"confirmed",note,true))
      .rejects.toThrow(/altra scheda/);
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_options:unknown,cb:(lock:object)=>Promise<unknown>
    )=>cb({})}});
    const stored=(await getBook(b.id))!;
    stored.chapters[0]!.scenes[0]!.text=
      "Mara affida la chiave a Elio. Poi la porta si chiude.";
    await saveBook(stored,false);
    await expect(decideAuthorNarrativeEvent(b.id,stored.updatedAt,event,"confirmed",note,true))
      .rejects.toThrow(/obsoleta/);
    expect((await getBook(b.id))?.chapters[0]?.authorEventDecisions).toBeUndefined();
  });
});
