import { getDb } from "./db";
import type { AiStreamDelta } from "./ai-stream";
import type { LmStudioPhase, AiTransportStats } from "./lmstudio-native";
import type { TaskReasoning } from "../domain/types";
import { expiredAiTraceIds, type AiTraceMetaEntry, type AiTraceRetention } from "../domain/ai-trace-policy";

/** Prompt and reply of one AI task. Sensitive: they hold the manuscript and the
 * narrative secrets sent to the model. Stored only in the IndexedDB `meta` store of
 * this browser, never in a ZIP backup, in the outbox or in `Activity.output`. They
 * reach GitHub only when the author turned on the separate GitHub option. */
export interface AiLocalTrace {
  activityId: string;
  bookId: string;
  createdAt: string;
  endpointId: string;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  response?: string;
  reasoning?: string;
  truncated: boolean;
  /** false = temporary, deleted by the retention policy. true, or missing (traces of
   * versions before 0.15), = kept until the author deletes it. */
  kept?: boolean;
}
const KEY_PREFIX="ai-trace:";
const META_PREFIX="ai-trace-meta:";
const MAX_INPUT_CHARS=120_000;
const MAX_OUTPUT_CHARS=120_000;
const MAX_REASONING_CHARS=20_000;
function limit(value:string,max:number):string {return value.slice(0,max);}
export function aiTraceKey(activityId:string):string{return KEY_PREFIX+activityId;}
export function aiTraceMetaKey(activityId:string):string{return META_PREFIX+activityId;}
// ':' sorts right before ';': these ranges cover exactly the keys with each prefix.
const traceRange=()=>IDBKeyRange.bound(KEY_PREFIX,"ai-trace;");
const metaRange=()=>IDBKeyRange.bound(META_PREFIX,"ai-trace-meta;");

/** Writes the conversation and its small metadata record in ONE transaction. The
 * `isCurrent` fence and the writes are adjacent: no await between them. */
export async function saveAiTrace(trace:AiLocalTrace,isCurrent:()=>boolean=()=>true):Promise<void>{
  const db=await getDb();
  const kept=trace.kept!==false;
  const stored:AiLocalTrace={
    ...trace,kept,systemPrompt:limit(trace.systemPrompt,MAX_INPUT_CHARS),
    userPrompt:limit(trace.userPrompt,MAX_INPUT_CHARS),
    response:trace.response===undefined?undefined:limit(trace.response,MAX_OUTPUT_CHARS),
    reasoning:trace.reasoning===undefined?undefined:limit(trace.reasoning,MAX_REASONING_CHARS),
    truncated:trace.truncated ||
      trace.systemPrompt.length>MAX_INPUT_CHARS || trace.userPrompt.length>MAX_INPUT_CHARS ||
      (trace.response?.length??0)>MAX_OUTPUT_CHARS ||
      (trace.reasoning?.length??0)>MAX_REASONING_CHARS,
  };
  const meta:AiTraceMetaEntry={activityId:trace.activityId,bookId:trace.bookId,createdAt:trace.createdAt,kept};
  const tx=db.transaction("meta","readwrite");
  void tx.done.catch(()=>undefined);
  if(!isCurrent()){tx.abort();return;}
  await Promise.all([
    tx.store.put(stored,aiTraceKey(trace.activityId)),
    tx.store.put(meta,aiTraceMetaKey(trace.activityId)),
    tx.done,
  ]);
}
export async function loadAiTrace(bookId:string,activityId:string):Promise<AiLocalTrace|null>{
  const db=await getDb();
  const trace=await db.get("meta",aiTraceKey(activityId)) as AiLocalTrace|undefined;
  return trace?.bookId===bookId && trace.activityId===activityId?trace:null;
}

/** Traces written before 0.15 have no metadata record. The author had asked to keep
 * them, so they become «kept»: nothing the author chose to keep is deleted by surprise. */
export async function adoptLegacyAiTraces():Promise<number>{
  const db=await getDb();
  const [traceKeys,metaKeys]=await Promise.all([
    db.getAllKeys("meta",traceRange()),db.getAllKeys("meta",metaRange()),
  ]);
  const known=new Set(metaKeys.map(String));
  let adopted=0;
  for(const key of traceKeys.map(String)){
    const id=key.slice(KEY_PREFIX.length);
    if(known.has(aiTraceMetaKey(id)))continue;
    const trace=await db.get("meta",key) as AiLocalTrace|undefined;
    if(!trace||typeof trace.bookId!=="string"||typeof trace.createdAt!=="string")continue;
    await db.put("meta",{activityId:id,bookId:trace.bookId,createdAt:trace.createdAt,kept:true} satisfies AiTraceMetaEntry,
      aiTraceMetaKey(id));
    adopted++;
  }
  return adopted;
}

/** Deletes the temporary conversations that exceed the retention. Reads only the small
 * metadata records, never the texts. A request still in flight is never pruned. */
export async function pruneAiTraces(retention:AiTraceRetention,now=Date.now()):Promise<number>{
  const db=await getDb();
  const metas=(await db.getAll("meta",metaRange()) as unknown[]).filter((entry):entry is AiTraceMetaEntry=>
    !!entry&&typeof entry==="object"&&typeof (entry as AiTraceMetaEntry).activityId==="string");
  const inFlight=new Set([...requests.values()].filter(item=>item.endedAt===undefined).map(item=>item.activityId));
  const ids=expiredAiTraceIds(metas,retention,now,inFlight);
  if(!ids.length)return 0;
  const tx=db.transaction("meta","readwrite");
  await Promise.all([
    ...ids.flatMap(id=>[tx.store.delete(aiTraceKey(id)),tx.store.delete(aiTraceMetaKey(id))]),
    tx.done,
  ]);
  return ids.length;
}

export interface AiTraceInventory { temporary:number; kept:number }
export async function summarizeAiTraces():Promise<AiTraceInventory>{
  const db=await getDb();
  const metas=await db.getAll("meta",metaRange()) as AiTraceMetaEntry[];
  const kept=metas.filter(entry=>entry.kept).length;
  return {temporary:metas.length-kept,kept};
}

/** Newest first, within `budgetBytes` of serialised text and `maxFiles` conversations.
 * Used to write the kept conversations of one book to GitHub. */
export async function collectKeptAiTraces(
  bookId:string,budgetBytes:number,maxFiles:number,
):Promise<{traces:AiLocalTrace[];omitted:number}>{
  const db=await getDb();
  const metas=(await db.getAll("meta",metaRange()) as AiTraceMetaEntry[])
    .filter(entry=>entry.kept&&entry.bookId===bookId)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.activityId.localeCompare(b.activityId));
  const traces:AiLocalTrace[]=[];
  let used=0;
  for(const entry of metas){
    if(traces.length>=maxFiles)break;
    const trace=await db.get("meta",aiTraceKey(entry.activityId)) as AiLocalTrace|undefined;
    if(!trace||trace.bookId!==bookId||trace.activityId!==entry.activityId)continue;
    const size=JSON.stringify(trace).length;
    if(used+size>budgetBytes)break;
    used+=size;traces.push(trace);
  }
  return {traces,omitted:metas.length-traces.length};
}

/** Explicit «delete everything»: stored conversations AND the text still in memory.
 * A request in flight stops saving; its text keeps arriving on screen from now on. */
export async function clearAiTraces():Promise<number>{
  discardLiveAiPreviews();
  const db=await getDb();
  const count=await db.count("meta",traceRange());
  const tx=db.transaction("meta","readwrite");
  await Promise.all([tx.store.delete(traceRange()),tx.store.delete(metaRange()),tx.done]);
  return count;
}

export interface LiveAiTrace {
  bookId:string;
  activityId:string;
  title:string;
  endpointId:string;
  modelId:string;
  stage:"inviata"|"header"|"streaming"|"completata"|"rifiutata"|"interrotta";
  startedAt:number;
  textPreview:string;
  reasoningPreview:string;
  /** Small moving tails continue beyond the bounded full transcript preview. */
  textTail?:string;
  reasoningTail?:string;
  textCharacters:number;
  reasoningCharacters:number;
  /** Set when the author deleted the previews while this request was running. */
  previewClearedAt?:number;
  requestedReasoning?:TaskReasoning;
  streamDeadlineSeconds?:number;
  transportBytes:number;
  transportEvents:number;
  providerPhase?:LmStudioPhase["phase"];
  providerProgress?:number;
  endedAt?:number;
  error?:string;
}
/** Module-local ephemeral stream: the text arriving from the model is always kept here
 * (bounded) so it can be shown while it arrives. What is stored afterwards is decided by
 * the retention policy. */
let live:LiveAiTrace|null=null;
// Keep concurrent requests separate; finished previews are a small volatile cache,
// not a second persistent history. The stored trace is saved at provider settlement.
const requests=new Map<string,LiveAiTrace>();
let inspectionGeneration=0;
/** Bumped when the author deletes conversations: a request that started before cannot save. */
export function aiInspectionGeneration():number{return inspectionGeneration;}
const listeners=new Set<()=>void>();
let notifyTimer:ReturnType<typeof setTimeout>|undefined;
function notifyNow(){
  if(notifyTimer!==undefined){clearTimeout(notifyTimer);notifyTimer=undefined;}
  for(const listener of listeners)listener();
}
function notifyLater(){
  if(notifyTimer!==undefined)return;
  notifyTimer=setTimeout(notifyNow,100);
}
export function subscribeLiveAi(listener:()=>void):()=>void{
  listeners.add(listener);return ()=>{listeners.delete(listener);};
}
export function currentLiveAi():LiveAiTrace|null {return live;}
export function currentTaskAi(bookId:string,activityId:string):LiveAiTrace|null {
  const request=requests.get(activityId);
  return request?.bookId===bookId?request:null;
}
const BLANK_PREVIEWS={textPreview:"",reasoningPreview:"",textTail:"",reasoningTail:""};
/** Drops the text kept in memory and blocks the pending saves of requests already started. */
export function discardLiveAiPreviews():void {
  inspectionGeneration++;
  const clearedAt=Date.now();
  for(const request of requests.values())
    updateRequest(request.activityId,item=>({...item,...BLANK_PREVIEWS,previewClearedAt:clearedAt}));
  if(live)live={...live,...BLANK_PREVIEWS,previewClearedAt:clearedAt};
  notifyNow();
}
function updateRequest(activityId:string,update:(request:LiveAiTrace)=>LiveAiTrace):void {
  const previous=requests.get(activityId);
  if(!previous)return;
  const next=update(previous);
  requests.set(activityId,next);
  if(live?.activityId===activityId)live=next;
}
function pruneFinishedRequests():void {
  const finished=[...requests.values()].filter(item=>item.endedAt!==undefined);
  for(const item of finished.slice(0,Math.max(0,finished.length-8)))requests.delete(item.activityId);
}
export function startLiveAi(values:Omit<LiveAiTrace,"stage"|"startedAt"|"textPreview"|"reasoningPreview"|"textCharacters"|"reasoningCharacters"|"transportBytes"|"transportEvents">,foreground=true){
  const existing=currentTaskAi(values.bookId,values.activityId);
  const request=existing??{...values,stage:"inviata" as const,startedAt:Date.now(),textPreview:"",reasoningPreview:"",
    textCharacters:0,reasoningCharacters:0,transportBytes:0,transportEvents:0};
  requests.set(values.activityId,request);
  if(foreground)live=request;
  pruneFinishedRequests();
  notifyNow();
}
export function markAiHeader(activityId:string){
  updateRequest(activityId,request=>({...request,stage:"header"}));notifyNow();
}
export function markAiTransport(activityId:string,values:AiTransportStats){
  updateRequest(activityId,request=>({...request,transportBytes:values.bytes,transportEvents:values.events}));
  notifyLater();
}
export function markNativePhase(activityId:string,value:LmStudioPhase){
  updateRequest(activityId,request=>({...request,providerPhase:value.phase,providerProgress:value.progress}));
  notifyNow();
}
export function addAiDelta(activityId:string,delta:AiStreamDelta){
  updateRequest(activityId,request=>delta.kind==="text"?{...request,stage:"streaming",
    textCharacters:request.textCharacters+delta.text.length,
    textTail:((request.textTail??"")+delta.text).slice(-4000),
    textPreview:limit(request.textPreview+delta.text,MAX_OUTPUT_CHARS)}
    :{...request,stage:"streaming",reasoningCharacters:request.reasoningCharacters+delta.text.length,
      reasoningTail:((request.reasoningTail??"")+delta.text).slice(-4000),
      reasoningPreview:limit(request.reasoningPreview+delta.text,MAX_REASONING_CHARS)});
  notifyLater();
}
/** Also covers non-streamed JSON; receiving a reply does not approve its application. */
export function receiveAiResponse(activityId:string,text:string){
  updateRequest(activityId,request=>request.textCharacters>0?request:({...request,textCharacters:text.length,
    textTail:text.slice(-4000),
    textPreview:limit(text,MAX_OUTPUT_CHARS)}));
  notifyNow();
}
export function finishLiveAi(activityId:string,status:"completata"|"rifiutata"|"interrotta",error?:string){
  updateRequest(activityId,request=>({...request,stage:status,endedAt:Date.now(),error}));
  pruneFinishedRequests();notifyNow();
}
