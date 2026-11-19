import {describe,expect,it} from "vitest";
import {AiTraceReadFence} from "./ai-trace-read-fence";

describe("Fence delle letture sensibili IndexedDB",()=>{
  it("una seconda ispezione rende obsoleto il completamento della prima",async()=>{
    const fence=new AiTraceReadFence();
    const first=fence.begin();
    let complete:(value:string)=>void=()=>undefined;
    const slow=new Promise<string>(resolve=>{complete=resolve;});
    const second=fence.begin();
    expect(fence.isCurrent(first)).toBe(false);
    expect(fence.isCurrent(second)).toBe(true);
    complete("SEGRETO_LIBRO_PRECEDENTE");
    const late=await slow;
    expect(late).toBe("SEGRETO_LIBRO_PRECEDENTE");
    expect(fence.isCurrent(first)).toBe(false);
    expect(fence.isCurrent(second)).toBe(true);
  });
  it("cambio libro, revoca consenso e unmount annullano tutte le richieste pendenti",()=>{
    const fence=new AiTraceReadFence();
    const fromBookA=fence.begin();
    fence.invalidate(); // change book
    expect(fence.isCurrent(fromBookA)).toBe(false);
    const fromBookB=fence.begin();
    fence.invalidate(); // opt-out
    expect(fence.isCurrent(fromBookB)).toBe(false);
    const afterOptIn=fence.begin();
    fence.invalidate(); // unmount
    expect(fence.isCurrent(afterOptIn)).toBe(false);
    expect(fence.isCurrent(0)).toBe(false);
    expect(fence.isCurrent(NaN)).toBe(false);
  });
});
