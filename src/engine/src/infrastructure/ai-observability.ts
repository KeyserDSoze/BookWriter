import { host } from "../core/host";
import type { AiStreamDelta } from "./ai-stream";
import type { LmStudioPhase, AiTransportStats } from "./lmstudio-native";
import type { TaskReasoning } from "../domain/types";
import type { AiTraceRetention } from "../domain/ai-trace-policy";

/** Prompt and reply of one AI task. Sensitive: they hold the manuscript and the
 * narrative secrets sent to the model. Stored only by the device that sent them (the
 * browser keeps them in its IndexedDB `meta` store), never in a ZIP backup, in the outbox or in `Activity.output`. They
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
const MAX_INPUT_CHARS=120_000;
const MAX_OUTPUT_CHARS=120_000;
const MAX_REASONING_CHARS=20_000;
function limit(value:string,max:number):string {return value.slice(0,max);}

/** The conversation as it may be stored: bounded, with the retention flag made explicit. */
export function boundedAiTrace(trace:AiLocalTrace):AiLocalTrace{
  return {
    ...trace,kept:trace.kept!==false,systemPrompt:limit(trace.systemPrompt,MAX_INPUT_CHARS),
    userPrompt:limit(trace.userPrompt,MAX_INPUT_CHARS),
    response:trace.response===undefined?undefined:limit(trace.response,MAX_OUTPUT_CHARS),
    reasoning:trace.reasoning===undefined?undefined:limit(trace.reasoning,MAX_REASONING_CHARS),
    truncated:trace.truncated ||
      trace.systemPrompt.length>MAX_INPUT_CHARS || trace.userPrompt.length>MAX_INPUT_CHARS ||
      (trace.response?.length??0)>MAX_OUTPUT_CHARS ||
      (trace.reasoning?.length??0)>MAX_REASONING_CHARS,
  };
}

/** Hands the conversation to the host's trace store. A host without one (the server) keeps only
 * the live text in memory: it does not inherit a browser's retention consent. */
export async function saveAiTrace(trace:AiLocalTrace,isCurrent:()=>boolean=()=>true):Promise<void>{
  await host().traces?.save(boundedAiTrace(trace),isCurrent);
}

/** Deletes the temporary conversations that exceed the retention. Reads only the small
 * metadata records, never the texts. A request still in flight is never pruned. */
export async function pruneAiTraces(retention:AiTraceRetention,now=Date.now()):Promise<number>{
  const store=host().traces;
  if(!store)return 0;
  const inFlight=new Set([...requests.values()].filter(item=>item.endedAt===undefined).map(item=>item.activityId));
  return store.prune(retention,now,inFlight);
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
  /** Whether the request carried the forced function (tools), and how the reply came back. */
  toolsRequested?:boolean;
  toolsReplied?:boolean;
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
export function markAiTools(activityId:string,requested:boolean,replied?:boolean){
  updateRequest(activityId,request=>({...request,toolsRequested:requested,
    ...(replied===undefined?{}:{toolsReplied:replied})}));
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
