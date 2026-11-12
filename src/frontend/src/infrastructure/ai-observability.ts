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
export async function saveAiTrace(trace:AiLocalTrace):Promise<void>{
  const db=await getDb();
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
export function startLiveAi(values:Omit<LiveAiTrace,"stage"|"startedAt"|"textPreview"|"reasoningPreview"|"textCharacters"|"reasoningCharacters"|"transportBytes"|"transportEvents">){
  live={...values,stage:"inviata",startedAt:Date.now(),textPreview:"",reasoningPreview:"",
    textCharacters:0,reasoningCharacters:0,transportBytes:0,transportEvents:0};
  notifyNow();
}
export function markAiHeader(activityId:string){
  if(!live||live.activityId!==activityId)return;
  live={...live,stage:"header"};notifyNow();
}
export function markAiTransport(activityId:string,values:AiTransportStats){
  if(!live || live.activityId!==activityId)return;
  live={...live,transportBytes:values.bytes,transportEvents:values.events};
  notifyLater();
}
export function markNativePhase(activityId:string,value:LmStudioPhase){
  if(!live || live.activityId!==activityId)return;
  live={...live,providerPhase:value.phase,providerProgress:value.progress};
  notifyNow();
}
export function addAiDelta(activityId:string,delta:AiStreamDelta){
  if(!live||live.activityId!==activityId)return;
  if(delta.kind==="text"){
    live={...live,stage:"streaming",
      textCharacters:live.textCharacters+delta.text.length,
      textPreview:live.inspect?limit(live.textPreview+delta.text,MAX_OUTPUT_CHARS):""};
  } else {
    live={...live,stage:"streaming",
      reasoningCharacters:live.reasoningCharacters+delta.text.length,
      reasoningPreview:live.inspect?limit(live.reasoningPreview+delta.text,MAX_REASONING_CHARS):""};
  }
  notifyLater();
}
export function finishLiveAi(activityId:string,status:"completata"|"rifiutata"|"interrotta",error?:string){
  if(!live||live.activityId!==activityId)return;
  live={...live,stage:status,endedAt:Date.now(),error};notifyNow();
}
