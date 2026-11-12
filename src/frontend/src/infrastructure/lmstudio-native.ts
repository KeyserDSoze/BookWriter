import { MAX_CHAT_COMPLETION_BYTES, ProviderResponseReadError } from "./ai-completion-response";
import type { AiStreamDelta, StreamCompletion } from "./ai-stream";

export type LmStudioPhase = {
  phase: "model_loading"|"prompt_processing"|"reasoning"|"message";
  progress?: number;
};
export interface AiTransportStats { bytes:number; events:number; }
function fail(message="Risposta LM Studio nativa incompleta o malformata: nessun testo applicato."):never{
  throw new ProviderResponseReadError(message);
}
function abortError():DOMException{
  return new DOMException("Generazione interrotta dall'autore.","AbortError");
}
export function lmStudioNativeEndpoint(baseUrl:string):string{
  const url=new URL(baseUrl);
  if(!["localhost","127.0.0.1"].includes(url.hostname) ||
    url.pathname.replace(/\/$/,"")!=="/v1")
    throw new Error("API LM Studio nativa consentita solo per http(s)://localhost:porta/v1 o 127.0.0.1.");
  return url.origin+"/api/v1/chat";
}
export function lmStudioNativeReasoning(
  effort:"low"|"medium"|"high"|"xhigh"|undefined,
):"low"|"medium"|"high"|undefined{
  if(effort==="xhigh")throw new Error(
    "API nativa LM Studio non supporta xhigh: scegli Low, Medium, High oppure Automatico."
  );
  return effort;
}
export function lmStudioNativeProtocol(value:unknown):"openai"|"lmstudio_native"{
  if(value===undefined || value==="openai")return "openai";
  if(value==="lmstudio_native")return "lmstudio_native";
  throw new Error("Protocollo endpoint AI non valido.");
}
export async function readLmStudioNativeStream(
  response:Response,signal:AbortSignal,
  onDelta?:(delta:AiStreamDelta)=>void,
  onPhase?:(phase:LmStudioPhase)=>void,
  onTransport?:(stats:AiTransportStats)=>void,
  timeoutMs=600_000,
):Promise<StreamCompletion>{
  if(signal.aborted)throw abortError();
  if(!/^text\/event-stream\b/i.test(response.headers.get("content-type")??""))
    fail("LM Studio nativo non ha restituito eventi SSE. Nessuna risposta applicata.");
  const headerSize=response.headers.get("content-length");
  if(headerSize && (!/^\d+$/.test(headerSize.trim()) ||
    Number(headerSize)>MAX_CHAT_COMPLETION_BYTES))fail();
  const reader=response.body?.getReader();
  if(!reader)fail();
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let pending="",bytes=0,events=0,started=false,ended=false;
  let generatedReasoning=false;
  let final:StreamCompletion|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let totalTimer:ReturnType<typeof setTimeout>|undefined;
  let onAbort:(()=>void)|undefined;
  let expired=false;
  let rejectExpired:(reason:unknown)=>void=()=>{};
  const expiry=()=>new ProviderResponseReadError(
    "LM Studio nativo non ha inviato dati per troppo tempo: nessun testo applicato. Prova Reasoning Low o aumenta l'attesa."
  );
  const interrupt=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(abortError());
    signal.addEventListener("abort",onAbort,{once:true});
    rejectExpired=reject;
  });
  // Inactivity deadline re-armed on every packet; a hard ceiling stops endless trickles.
  const armIdleTimer=()=>{
    if(timer!==undefined)clearTimeout(timer);
    timer=setTimeout(()=>{expired=true;rejectExpired(expiry());},timeoutMs);
  };
  armIdleTimer();
  totalTimer=setTimeout(()=>{expired=true;rejectExpired(expiry());},4*60*60*1000);
  const emit=(callback:()=>void)=>{try{callback();}catch{/* UI observer only */}};
  const progress=(phase:LmStudioPhase["phase"],value:unknown)=>{
    if(value!==undefined &&
      (typeof value!=="number" || !Number.isFinite(value) || value<0 || value>1))fail();
    emit(()=>onPhase?.({phase,...(value===undefined?{}:{progress:value as number})}));
  };
  const accept=(eventName:string,payload:string)=>{
    let raw:unknown;
    try{raw=JSON.parse(payload);}catch{fail();}
    if(!raw || typeof raw!=="object" || Array.isArray(raw))fail();
    const v=raw as Record<string,unknown>;
    if(v.type!==eventName)fail();
    events++;emit(()=>onTransport?.({bytes,events}));
    if(!started){
      if(eventName!=="chat.start")fail();
      started=true;return;
    }
    if(ended)fail();
    if(eventName==="error")fail("LM Studio ha restituito un evento di errore: testo non applicato.");
    if(eventName==="model_load.start" || eventName==="model_load.progress"){
      progress("model_loading",eventName==="model_load.progress"?v.progress:undefined);return;
    }
    if(eventName==="prompt_processing.start" || eventName==="prompt_processing.progress"){
      progress("prompt_processing",eventName==="prompt_processing.progress"?v.progress:undefined);return;
    }
    if(eventName==="reasoning.start"){progress("reasoning",undefined);return;}
    if(eventName==="message.start"){progress("message",undefined);return;}
    if(eventName==="reasoning.delta" || eventName==="message.delta"){
      if(typeof v.content!=="string")fail();
      if(eventName==="reasoning.delta")generatedReasoning=true;
      emit(()=>onDelta?.({kind:eventName==="reasoning.delta"?"reasoning":"text",text:v.content as string}));
      return;
    }
    if(eventName==="chat.end"){
      const result=v.result;
      if(!result || typeof result!=="object" || Array.isArray(result))fail();
      const parsed=result as Record<string,unknown>;
      if(!Array.isArray(parsed.output))fail();
      const texts:string[]=[];
      for(const item of parsed.output){
        if(!item || typeof item!=="object" || Array.isArray(item))fail();
        const entry=item as {type?:unknown;content?:unknown};
        if(entry.type==="tool_call" || entry.type==="invalid_tool_call")
          fail("LM Studio ha proposto una chiamata a strumenti non autorizzata: nessun output applicato.");
        if(entry.type!=="message" && entry.type!=="reasoning")fail();
        if(typeof entry.content!=="string")fail();
        if(entry.type==="message")texts.push(entry.content);
        else if(!generatedReasoning && entry.content){
          generatedReasoning=true;
          emit(()=>onDelta?.({kind:"reasoning",text:entry.content as string}));
        }
      }
      const text=texts.join("\n");
      if(!text.trim())fail("LM Studio ha terminato senza risposta testuale finale; potrebbe aver generato solo reasoning. Nessun testo applicato.");
      const stats=parsed.stats;
      const usage=stats && typeof stats==="object" && !Array.isArray(stats)
        ? stats as Record<string,unknown> : {};
      final={choices:[{message:{content:text}}],
        usage:{prompt_tokens:usage.input_tokens,completion_tokens:usage.total_output_tokens}};
      ended=true;return;
    }
    if(["model_load.end","prompt_processing.end","reasoning.end","message.end"].includes(eventName))return;
    // No execution of unknown/native tool or plugin events.
    fail("Evento LM Studio non supportato; nessuna azione esterna eseguita.");
  };
  const consume=(fragment:string)=>{
    pending+=fragment.replace(/\r\n/g,"\n");
    if(pending.length>MAX_CHAT_COMPLETION_BYTES)fail();
    let index:number;
    while((index=pending.indexOf("\n\n"))>=0){
      const frame=pending.slice(0,index);pending=pending.slice(index+2);
      const event=frame.split("\n").find(x=>x.startsWith("event:"))?.slice(6).trim();
      const data=frame.split("\n").filter(x=>x.startsWith("data:"))
        .map(x=>x.slice(5).trimStart()).join("\n");
      if(!event || !data)fail();
      accept(event,data);
    }
  };
  try{
    while(!ended){
      const packet=await Promise.race([reader.read(),interrupt]);
      if(signal.aborted)throw abortError();
      if(packet.done)break;
      armIdleTimer();
      bytes+=packet.value.byteLength;
      if(bytes>MAX_CHAT_COMPLETION_BYTES)fail();
      emit(()=>onTransport?.({bytes,events}));
      consume(decoder.decode(packet.value,{stream:true}));
    }
    if(!ended)consume(decoder.decode());
    if(!started || !ended || !final)fail();
    return final;
  }catch(error){
    if(signal.aborted)throw abortError();
    if(expired)throw expiry();
    if(error instanceof ProviderResponseReadError)throw error;
    throw new ProviderResponseReadError("Risposta LM Studio nativa incompleta: nessun testo applicato.");
  }finally{
    if(timer!==undefined)clearTimeout(timer);
    if(totalTimer!==undefined)clearTimeout(totalTimer);
    if(onAbort)signal.removeEventListener("abort",onAbort);
    // A complete chat.end is an application-level terminator; close locally
    // without waiting for extra network frames.
    try{void reader.cancel().catch(()=>{});}catch{/* ignore */ }
    try{reader.releaseLock();}catch{/* pending read */ }
  }
}
