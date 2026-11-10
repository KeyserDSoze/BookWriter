import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { accountBookAiBudget, preflightBookAiBudget } from "../domain/ai-budget";
import { EmptyProviderContentError, MalformedProviderContentError } from "../infrastructure/ai-provider-error";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";

const { callMock, guardMock } = vi.hoisted(() => ({
  callMock: vi.fn(), guardMock: vi.fn(),
}));
vi.mock("../infrastructure/ai", () => ({ callModel: callMock }));
vi.mock("./writer-guard", () => ({ withWriterGuard: guardMock }));
import { AutopilotRunner } from "./autopilot";

beforeEach(async () => {
  const db=await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  callMock.mockReset(); guardMock.mockReset();
  guardMock.mockImplementation(async (_id, _run, _controller, work) =>
    work({ assertActive:async()=>{}, failure:()=>undefined }));
});
afterEach(() => vi.clearAllMocks());

async function specimen() {
  const book=newBook("Il romanzo","Il libro","Teso","Adulti");
  book.status="paused";book.phase="chapterReview";
  book.chapters=[{
    id:"ch-1",number:1,title:"Il portone",purpose:"Mara incontra un guardiano.",
    scenes:[{id:"sc-1",number:1,title:"L'incontro",objective:"Mostrare un mistero",
      text:"Mara incontra il guardiano davanti al portone del castello.",status:"canon"}],
  }];
  book.editorialCycle={
    chapterId:"ch-1",round:1,stage:"review",reports:[],repairCursor:0,priorRounds:[],
  };
  book.aiBudget={enabled:true,enabledAt:new Date(Date.now()-60_000).toISOString(),
    limitEur:5,maxOutputTokens:8192};
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId="review-model";
  settings.aiPriceRates=[{endpointId:"openai",modelId:"review-model",
    inputEurPerMillion:3,outputEurPerMillion:9}];
  await saveSettings(settings);
  await saveBook(book,false);
  return {book,settings};
}

describe("Accounting del provider separato dalla validità narrativa", () => {
  it("HTTP 200 con testo vuoto: conserva usage noto nonostante callModel lanci", async () => {
    const {book,settings}=await specimen();
    callMock.mockRejectedValue(new EmptyProviderContentError("openai","review-model",{
      prompt_tokens:243,completion_tokens:72,
    }));
    await new AutopilotRunner().run(book.id,async()=>{});
    const current=(await getBook(book.id))!;
    const records=await listActivities(book.id);
    expect(current.status).toBe("error");
    expect(current.editorialCycle?.reports).toHaveLength(0);
    expect(current.chapters).toEqual(book.chapters);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({status:"failed",aiRequested:true,
      inputTokens:243,outputTokens:72});
    const counted=accountBookAiBudget(records,settings,book.aiBudget!);
    expect(counted.incompleteCount).toBe(0);
    expect(counted.estimatedSpentEur).toBeCloseTo((243*3+72*9)/1_000_000);
    expect(preflightBookAiBudget(current,settings,records,
      "chapterAudit","System","Nuovo prompt")).toBeDefined();
  });
  it("un provider con content array malformato conserva token ma non modifica scene o report",async()=>{
    const {book,settings}=await specimen();
    callMock.mockRejectedValue(new MalformedProviderContentError("openai","review-model",{
      prompt_tokens:243,completion_tokens:72,
    }));
    await new AutopilotRunner().run(book.id,async()=>{});
    const current=(await getBook(book.id))!;
    const rows=await listActivities(book.id);
    expect(current.status).toBe("error");
    expect(current.editorialCycle?.reports).toHaveLength(0);
    expect(current.chapters).toEqual(book.chapters);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({status:"failed",aiRequested:true,
      inputTokens:243,outputTokens:72,priceRateSnapshot:{
        endpointId:"openai",modelId:"review-model",inputEurPerMillion:3,outputEurPerMillion:9,
      }});
    expect(accountBookAiBudget(rows,settings,book.aiBudget!).incompleteCount).toBe(0);
    expect(accountBookAiBudget(rows,settings,book.aiBudget!).estimatedSpentEur)
      .toBeCloseTo((243*3+72*9)/1_000_000);
    expect(rows[0]?.error).not.toContain("sk-test");
  });
  it("HTTP 200 vuoto con usage parziale resta budget incerto", async () => {
    const {book,settings}=await specimen();
    callMock.mockRejectedValue(new EmptyProviderContentError("openai","review-model",{
      prompt_tokens:300,
    }));
    await new AutopilotRunner().run(book.id,async()=>{});
    const rows=await listActivities(book.id);
    expect(rows[0]).toMatchObject({status:"failed",inputTokens:300});
    expect(rows[0]?.outputTokens).toBeUndefined();
    expect(accountBookAiBudget(rows,settings,book.aiBudget!).incompleteCount).toBe(1);
    expect(()=>preflightBookAiBudget(book,settings,rows,
      "chapterAudit","System","Nuovo prompt")).toThrow(/senza usage completo/);
  });

  it("mantiene i token già osservati se il report del revisore non è JSON valido", async () => {
    const {book,settings}=await specimen();
    callMock.mockResolvedValue({
      text:"Questo non è il JSON del revisore.",
      endpointId:"openai",modelId:"review-model",
      inputTokens:243,outputTokens:72,
    });
    await new AutopilotRunner().run(book.id, async()=>{});
    const saved=(await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.editorialCycle?.stage).toBe("review");
    expect(saved.editorialCycle?.reports).toHaveLength(0);
    expect(saved.chapters).toEqual(book.chapters);
    expect(callMock).toHaveBeenCalledTimes(1);
    const activities=await listActivities(book.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      status:"failed",aiRequested:true,endpointId:"openai",modelId:"review-model",
      inputTokens:243,outputTokens:72,
      priceRateSnapshot:{endpointId:"openai",modelId:"review-model",
        inputEurPerMillion:3,outputEurPerMillion:9},
    });
    const accounted=accountBookAiBudget(activities,settings,book.aiBudget!);
    expect(accounted.countedCalls).toBe(1);
    expect(accounted.incompleteCount).toBe(0);
    expect(accounted.unpricedCount).toBe(0);
    expect(accounted.estimatedSpentEur).toBeCloseTo((243*3+72*9)/1_000_000);
    const repriced=structuredClone(settings);
    repriced.aiPriceRates=[{endpointId:"openai",modelId:"review-model",
      inputEurPerMillion:30,outputEurPerMillion:90}];
    expect(accountBookAiBudget(activities,repriced,book.aiBudget!).estimatedSpentEur)
      .toBeCloseTo(accounted.estimatedSpentEur);
    expect(preflightBookAiBudget(saved,settings,activities,
      "chapterAudit","Il prossimo ruolo","Prova")).toBeDefined();
  });

  it("non nasconde usage parziale né spesa sconosciuta dopo un report rifiutato", async () => {
    const {book,settings}=await specimen();
    callMock.mockResolvedValue({
      text:"Testo del revisore senza formato JSON.",
      endpointId:"openai",modelId:"review-model",inputTokens:500,
    });
    await new AutopilotRunner().run(book.id,async()=>{});
    const history=await listActivities(book.id);
    expect(history[0]).toMatchObject({status:"failed",aiRequested:true,inputTokens:500});
    expect(history[0]?.outputTokens).toBeUndefined();
    expect(accountBookAiBudget(history,settings,book.aiBudget!).incompleteCount).toBe(1);
    expect(()=>preflightBookAiBudget(book,settings,history,
      "chapterAudit","System","Prosa")).toThrow(/senza usage completo/);
    expect((await getBook(book.id))!.editorialCycle?.reports).toHaveLength(0);
  });

  it("registra usage se il manoscritto cambia dopo la risposta del provider", async () => {
    const {book,settings}=await specimen();
    callMock.mockImplementation(async () => {
      const changed=(await getBook(book.id))!;
      changed.chapters[0]!.scenes[0]!.text="Il portone è stato modificato da una seconda operazione.";
      await saveBook(changed,false);
      return {text:JSON.stringify({
        verdict:"pass",summary:"Esame del segmento completato senza anomalie.",
        findings:[],memoryNote:"Nessuna osservazione.",
      }),endpointId:"openai",modelId:"review-model",inputTokens:350,outputTokens:41};
    });
    await new AutopilotRunner().run(book.id,async()=>{});
    const saved=(await getBook(book.id))!;
    expect(saved.editorialCycle?.reports).toHaveLength(0);
    const history=await listActivities(book.id);
    expect(history[0]).toMatchObject({
      status:"cancelled",aiRequested:true,inputTokens:350,outputTokens:41,
    });
    expect(accountBookAiBudget(history,settings,book.aiBudget!).incompleteCount).toBe(0);
    expect(saved.chapters[0]!.scenes[0]!.text).toContain("seconda operazione");
  });
});
