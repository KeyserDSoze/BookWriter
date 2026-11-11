import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, newBook, type Activity, type AppSettings } from "./types";
import { accountBookAiBudget, accountSessionAiBudget, AiBudgetStop, isBudgetValid, preflightBookAiBudget, snapshotPriceRate } from "./ai-budget";

function fixture(){
  const book = newBook("Premessa","Romanzo","Stile","Adulti");
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "review-model";
  settings.aiPriceRates = [{
    endpointId: "openai", modelId: "review-model",
    inputEurPerMillion: 3, outputEurPerMillion: 9,
  }];
  book.aiBudget = { enabled:true, enabledAt:"2026-11-05T00:00:00.000Z",
    limitEur: 2, maxOutputTokens:8192 };
  return {book,settings};
}
function item(partial: Partial<Activity> = {}): Activity {
  return {
    id:crypto.randomUUID(),bookId:"book",runId:crypto.randomUUID(),
    status:"succeeded",phase:"chapterReview",title:"Lettore",reason:"Test",
    nextStep:"Proseguire",createdAt:"2026-11-05T12:00:00.000Z",
    endpointId:"openai",modelId:"review-model",aiRequested:true,
    inputTokens:500,outputTokens:1000,...partial,
  };
}
describe("Budget AI basato su tariffe inserite dall'autore",()=>{
  it("senza opt-in nessun modello viene limitato",()=>{
    const {book,settings}=fixture();book.aiBudget=undefined;
    expect(preflightBookAiBudget(book,settings,[],"chapterReaders","System","Testo")).toBeUndefined();
  });
  it("riserva la spesa stimata della richiesta e conta solo il periodo attivo",()=>{
    const {book,settings}=fixture();
    const before=item({createdAt:"2026-10-01T00:00:00.000Z",inputTokens:100000});
    const current=item();
    const estimation=preflightBookAiBudget(book,settings,[before,current],"chapterJudge","Giudice","Testo");
    expect(estimation?.estimatedSpentEur).toBeCloseTo(0.0105,6);
    expect(estimation?.countedCalls).toBe(1);
    expect(estimation?.reservedOutputTokens).toBe(8192);
    expect(estimation?.reservedInputTokens).toBeGreaterThan(256);
    expect(estimation?.estimatedNextEur).toBeGreaterThan(0);
  });
  it("non effettua nuove chiamate quando limite e riserva superano la soglia",()=>{
    const {book,settings}=fixture();
    book.aiBudget!.limitEur=0.01;
    expect(()=>preflightBookAiBudget(book,settings,[],"chapterReaders","Persona","Manoscritto"))
      .toThrow(AiBudgetStop);
  });
  it("rifiuta listini mancanti e duplicati, senza inventare prezzi",()=>{
    const {book,settings}=fixture();
    settings.aiPriceRates=[];
    expect(()=>preflightBookAiBudget(book,settings,[],"chapterAudit","X","Y"))
      .toThrow(/Tariffa non configurata/);
    const price={endpointId:"openai",modelId:"review-model",
      inputEurPerMillion:0,outputEurPerMillion:1};
    settings.aiPriceRates=[price,price];
    expect(()=>preflightBookAiBudget(book,settings,[],"chapterAudit","X","Y"))
      .toThrow(/Tariffa non configurata/);
  });
  it("fallisce chiuso quando risposta o errore possono essere stati fatturati senza usage",()=>{
    const {book,settings}=fixture();
    for (const row of [
      item({outputTokens:undefined}),item({status:"failed",inputTokens:undefined,outputTokens:undefined}),
      item({status:"cancelled",inputTokens:undefined,outputTokens:undefined}),
      item({status:"running",inputTokens:undefined,outputTokens:undefined}),
    ]){
      expect(()=>preflightBookAiBudget(book,settings,[row],"chapterAudit","X","Y"))
        .toThrow(/senza usage completo/);
    }
  });
  it("richieste fermate dal guard prima del fetch non vengono conteggiate come spesa ignota",()=>{
    const {book,settings}=fixture();
    const stopped=item({aiRequested:false,status:"failed",inputTokens:undefined,outputTokens:undefined});
    const report=accountBookAiBudget([stopped],settings,book.aiBudget!);
    expect(report.incompleteCount).toBe(0);
    expect(report.countedCalls).toBe(0);
    expect(preflightBookAiBudget(book,settings,[stopped],"chapterReaders","X","Y"))
      .toBeDefined();
  });
  it("non confonde il listino dello stesso modello su endpoint differenti",()=>{
    const {book,settings}=fixture();
    const call=item({endpointId:"other",inputTokens:1000,outputTokens:1000});
    expect(()=>preflightBookAiBudget(book,settings,[call],"chapterReaders","X","Y"))
      .toThrow(/prive di un listino/);
    settings.aiPriceRates?.push({endpointId:"other",modelId:"review-model",
      inputEurPerMillion:12,outputEurPerMillion:23});
    expect(accountBookAiBudget([call],settings,book.aiBudget!).estimatedSpentEur)
      .toBeCloseTo(0.035);
  });
  it("congela la tariffa del tentativo e applica il nuovo listino soltanto al prossimo preflight",()=>{
    const {book,settings}=fixture();
    const quote=snapshotPriceRate(settings,"openai","review-model")!;
    expect(quote).not.toBe(settings.aiPriceRates![0]);
    const logged=item({priceRateSnapshot:quote,inputTokens:2000,outputTokens:1000});
    settings.aiPriceRates=[{endpointId:"openai",modelId:"review-model",
      inputEurPerMillion:50,outputEurPerMillion:70}];
    const before=accountBookAiBudget([logged],settings,book.aiBudget!);
    expect(before.estimatedSpentEur).toBeCloseTo((2000*3+1000*9)/1e6);
    expect(before.legacyPricedCount).toBe(0);
    const next=preflightBookAiBudget(book,settings,[logged],"chapterReaders","S","P")!;
    expect(next.estimatedSpentEur).toBeCloseTo(before.estimatedSpentEur);
    expect(next.estimatedNextEur).toBeGreaterThan(0.5);
    expect(quote.inputEurPerMillion).toBe(3);
  });
  it("prezzi dei log legacy restano ricalcolabili, ma ora sono dichiarati",()=>{
    const {book,settings}=fixture();
    const old=item({inputTokens:2000,outputTokens:1000});
    const fixed=item({inputTokens:2000,outputTokens:1000,
      priceRateSnapshot:snapshotPriceRate(settings,"openai","review-model")});
    settings.aiPriceRates=[{endpointId:"openai",modelId:"review-model",
      inputEurPerMillion:6,outputEurPerMillion:12}];
    const result=accountBookAiBudget([old,fixed],settings,book.aiBudget!);
    expect(result.legacyPricedCount).toBe(1);
    expect(result.unpricedCount).toBe(0);
    expect(result.estimatedSpentEur).toBeCloseTo((2000*6+1000*12+2000*3+1000*9)/1e6);
  });
  it("snapshot presente ma falso, off-route o fuori schema non ricade sulla tariffa nuova",()=>{
    const {book,settings}=fixture();
    const quote=snapshotPriceRate(settings,"openai","review-model")!;
    const rows=[
      item({priceRateSnapshot:{...quote,modelId:"different"}}),
      item({priceRateSnapshot:{...quote,inputEurPerMillion:-3}}),
      item({priceRateSnapshot:null as unknown as typeof quote}),
      item({priceRateSnapshot:{...quote,outputEurPerMillion:"9" as unknown as number}}),
    ];
    const a=accountBookAiBudget(rows,settings,book.aiBudget!);
    expect(a.unpricedCount).toBe(4);
    expect(a.legacyPricedCount).toBe(0);
    expect(a.estimatedSpentEur).toBe(0);
    expect(()=>preflightBookAiBudget(book,settings,rows,"chapterReaders","S","P"))
      .toThrow(/prive di un listino/);
  });
  it("applica il plafond di sessione prima della rete senza disattivare quello del libro",()=>{
    const {book,settings}=fixture();
    book.aiBudget!.sessionLimitEur=0.01;
    expect(()=>preflightBookAiBudget(book,settings,[],"chapterReaders","Sistema","Prompt","run-a"))
      .toThrow(/Budget di sessione stimato raggiunto/);
    book.aiBudget!.sessionLimitEur=1;
    expect(preflightBookAiBudget(book,settings,[],"chapterReaders","Sistema","Prompt","run-a")?.sessionCountedCalls)
      .toBe(0);
    book.aiBudget!.limitEur=0.01;
    expect(()=>preflightBookAiBudget(book,settings,[],"chapterReaders","Sistema","Prompt","run-a"))
      .toThrow(/Budget stimato raggiunto/);
  });
  it("rifiuta la mancanza di runId se il plafond sessione è attivo",()=>{
    const {book,settings}=fixture();
    book.aiBudget!.sessionLimitEur=1;
    expect(()=>preflightBookAiBudget(book,settings,[],"chapterReaders","Sistema","Prompt"))
      .toThrow(/identificativo della sessione assente/);
    book.aiBudget!.sessionLimitEur=undefined;
    expect(preflightBookAiBudget(book,settings,[],"chapterReaders","Sistema","Prompt"))
      .toBeDefined();
  });
  it("accumula soltanto il runId della stessa sessione: resume riparte ma budget libro no",()=>{
    const {book,settings}=fixture();
    const runId="run-123";
    const quote=snapshotPriceRate(settings,"openai","review-model")!;
    const activity=item({bookId:book.id,runId,priceRateSnapshot:quote});
    const cost=(500*3+1000*9)/1e6;
    const reserved=preflightBookAiBudget(book,settings,[],"chapterJudge","S","P",runId)!.estimatedNextEur;
    book.aiBudget!.sessionLimitEur=reserved + cost * 1.5;
    const one=preflightBookAiBudget(book,settings,[activity],"chapterJudge","S","P",runId);
    expect(one?.sessionSpentEur).toBeCloseTo(cost);
    expect(one?.sessionCountedCalls).toBe(1);
    const second={...activity,id:crypto.randomUUID(),createdAt:"2026-11-05T12:01:00.000Z"};
    expect(()=>preflightBookAiBudget(book,settings,[activity,second],"chapterJudge","S","P",runId))
      .toThrow(/Budget di sessione stimato raggiunto/);
    const resumed=preflightBookAiBudget(book,settings,[activity,second],"chapterJudge","S","P","new-run-id");
    expect(resumed?.sessionSpentEur).toBe(0);
    expect(resumed?.sessionCountedCalls).toBe(0);
    expect(resumed?.estimatedSpentEur).toBeCloseTo(cost*2);
    book.aiBudget!.limitEur=reserved + cost*1.5;
    expect(()=>preflightBookAiBudget(book,settings,[activity,second],"chapterJudge","S","P","new-run-id"))
      .toThrow(/Budget stimato raggiunto/);
  });
  it("la sessione isola bookId, runId e data: preflight e manuali esclusi",()=>{
    const {book,settings}=fixture();
    const runId="run-focus";
    const entries=[
      item({bookId:book.id,runId}),
      item({bookId:book.id,runId,createdAt:"2026-10-01T00:00:00.000Z"}),
      item({bookId:book.id,runId:"run-other"}),
      item({bookId:"book-else",runId}),
      item({bookId:book.id,runId,aiRequested:false,inputTokens:undefined,outputTokens:undefined}),
      item({bookId:book.id,runId,endpointId:undefined,modelId:undefined,
        aiRequested:undefined,inputTokens:undefined,outputTokens:undefined}),
    ];
    const result=accountSessionAiBudget(entries,settings,book.aiBudget!,book.id,runId);
    expect(result.countedCalls).toBe(1);
    expect(result.incompleteCount).toBe(0);
    expect(result.estimatedSpentEur).toBeCloseTo(0.0105);
  });
  it("conta usage incompleto e snapshot invalidi nella sessione senza spacciarli per zero",()=>{
    const {book,settings}=fixture();
    const runId="run-unknown";
    const a=item({bookId:book.id,runId,inputTokens:0,outputTokens:undefined});
    const b=item({bookId:book.id,runId,priceRateSnapshot:{
      endpointId:"other",modelId:"review-model",inputEurPerMillion:3,outputEurPerMillion:9,
    }});
    const v=accountSessionAiBudget([a,b],settings,book.aiBudget!,book.id,runId);
    expect(v.incompleteCount).toBe(1);
    expect(v.unpricedCount).toBe(1);
    expect(v.estimatedSpentEur).toBe(0);
    book.aiBudget!.sessionLimitEur=1;
    expect(()=>preflightBookAiBudget(book,settings,[a,b],"chapterJudge","S","P",runId))
      .toThrow(/senza usage completo/);
  });
  it("rifiuta limite sessione malformato, e valida zero non ammesso",()=>{
    const {book}=fixture();
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:0.01})).toBe(true);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:0})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:0.009})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:100001})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:Infinity})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:NaN})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:"1" as unknown as number})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,sessionLimitEur:null as unknown as number})).toBe(false);
  });
  it("non accetta numeri NaN, negativi, output insensati o date invalide",()=>{
    const {book}=fixture();
    expect(isBudgetValid({...book.aiBudget!,limitEur:NaN})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,enabledAt:"not-a-date"})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,maxOutputTokens:123.6})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,maxOutputTokens:32769})).toBe(false);
    expect(isBudgetValid({...book.aiBudget!,limitEur:-5})).toBe(false);
    expect(isBudgetValid(book.aiBudget!)).toBe(true);
  });
});
