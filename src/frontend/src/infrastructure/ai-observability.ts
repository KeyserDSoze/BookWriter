import { getDb } from "./db";
import type { AiStreamDelta } from "./ai-stream";
import type { LmStudioPhase, AiTransportStats } from "./lmstudio-native";
import type { TaskReasoning } from "../domain/types";

/** Sensitive author-consented AI inspection. This metadata store is not
 * included in full/content ZIP, outbox, canon, or GitHub sync. */
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
}
const KEY_PREFIX="ai-trace:";
const MAX_INPUT_CHARS=120_000;
const MAX_OUTPUT_CHARS=120_000;
const MAX_REASONING_CHARS=20_000;
function limit(value:string,max:number):string {return value.slice(0,max);}
export function aiTraceKey(activityId:string):string{return KEY_PREFIX+activityId;}
export async function saveAiTrace(trace:AiLocalTrace,isCurrent:()=>boolean=()=>true):Promise<void>{
  const db=await getDb();
  if(!isCurrent())return;
  await db.put("meta",{
    ...trace,systemPrompt:limit(trace.systemPrompt,MAX_INPUT_CHARS),
    userPrompt:limit(trace.userPrompt,MAX_INPUT_CHARS),
    response:trace.response===undefined?undefined:limit(trace.response,MAX_OUTPUT_CHARS),
    reasoning:trace.reasoning===undefined?undefined:limit(trace.reasoning,MAX_REASONING_CHARS),
    truncated:trace.truncated ||
      trace.systemPrompt.length>MAX_INPUT_CHARS || trace.userPrompt.length>MAX_INPUT_CHARS ||
      (trace.response?.length??0)>MAX_OUTPUT_CHARS ||
      (trace.reasoning?.length??0)>MAX_REASONING_CHARS,
  },aiTraceKey(trace.activityId));
}
export async function loadAiTrace(bookId:string,activityId:string):Promise<AiLocalTrace|null>{
  const db=await getDb();
  const trace=await db.get("meta",aiTraceKey(activityId)) as AiLocalTrace|undefined;
  return trace?.bookId===bookId && trace.activityId===activityId?trace:null;
}
export async function clearAiTraces():Promise<number>{
  disableLiveAiInspection();
  const db=await getDb();
  const tx=db.transaction("meta","readwrite");
  let cursor=await tx.store.openCursor();
  let count=0;
  while(cursor){
    if(typeof cursor.key==="string" && cursor.key.startsWith(KEY_PREFIX)){
      await cursor.delete();count++;
    }
    cursor=await cursor.continue();
  }
  await tx.done;
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
  inspect:boolean;
  requestedReasoning?:TaskReasoning;
  streamDeadlineSeconds?:number;
  transportBytes:number;
  transportEvents:number;
  providerPhase?:LmStudioPhase["phase"];
  providerProgress?:number;
  endedAt?:number;
  error?:string;
}
/** Module-local ephemeral stream, never persisted unless opt-in above. */
let live:LiveAiTrace|null=null;
// Keep concurrent requests separate; finished previews are a small volatile cache,
// not a second persistent history. The consented trace is saved at provider settlement.
const requests=new Map<string,LiveAiTrace>();
let inspectionGeneration=0;
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
export function disableLiveAiInspection():void {
  inspectionGeneration++;
  for(const request of requests.values())updateRequest(request.activityId,item=>({...item,
    inspect:false,textPreview:"",reasoningPreview:"",textTail:"",reasoningTail:""}));
  if(live)live={...live,inspect:false,textPreview:"",reasoningPreview:"",textTail:"",reasoningTail:""};
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
    textTail:request.inspect?((request.textTail??"")+delta.text).slice(-4000):"",
    textPreview:request.inspect?limit(request.textPreview+delta.text,MAX_OUTPUT_CHARS):""}
    :{...request,stage:"streaming",reasoningCharacters:request.reasoningCharacters+delta.text.length,
      reasoningTail:request.inspect?((request.reasoningTail??"")+delta.text).slice(-4000):"",
      reasoningPreview:request.inspect?limit(request.reasoningPreview+delta.text,MAX_REASONING_CHARS):""});
  notifyLater();
}
/** Also covers non-streamed JSON; receiving a reply does not approve its application. */
export function receiveAiResponse(activityId:string,text:string){
  updateRequest(activityId,request=>request.textCharacters>0?request:({...request,textCharacters:text.length,
    textTail:request.inspect?text.slice(-4000):"",
    textPreview:request.inspect?limit(text,MAX_OUTPUT_CHARS):""}));
  notifyNow();
}
export function finishLiveAi(activityId:string,status:"completata"|"rifiutata"|"interrotta",error?:string){
  updateRequest(activityId,request=>({...request,stage:status,endedAt:Date.now(),error}));
  pruneFinishedRequests();notifyNow();
}
