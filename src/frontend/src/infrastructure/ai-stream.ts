import { MAX_CHAT_COMPLETION_BYTES, ProviderResponseReadError } from "./ai-completion-response";

/** Streaming is only enabled when explicitly configured per endpoint.
 * All deltas are provisional, not canonical book text. */
export type AiStreamDelta = { kind: "text" | "reasoning"; text: string };
export interface StreamCompletion {
  choices: Array<{ message: { content: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export const CHAT_STREAM_TIMEOUT_MS = 600_000;
export const MIN_CHAT_STREAM_TIMEOUT_SECONDS=600;
export const MAX_CHAT_STREAM_TIMEOUT_SECONDS=3600;
export function chatStreamTimeoutSeconds(value:unknown):number{
  if(value===undefined)return 600;
  if(typeof value!=="number" || !Number.isSafeInteger(value) ||
    value<MIN_CHAT_STREAM_TIMEOUT_SECONDS || value>MAX_CHAT_STREAM_TIMEOUT_SECONDS)
    throw new Error("Attesa streaming AI non valida: scegli 600–3600 secondi.");
  return value;
}
export interface AiTransportStats {bytes:number;events:number}
const invalid = () => new ProviderResponseReadError(
  "Stream AI non valido o incompleto: nessun testo applicato. Verifica il supporto SSE del provider."
);
const timeout = () => new ProviderResponseReadError(
  "Il provider non ha inviato dati per troppo tempo durante lo streaming AI. Nessun testo applicato: il provider potrebbe avere consumato token. Aumenta l'attesa nelle Impostazioni o abbassa il thinking."
);
/** Hard ceiling even if the provider keeps trickling bytes (e.g. an endless loop). */
export const CHAT_STREAM_TOTAL_CAP_MS = 4 * 60 * 60 * 1000;

export function chatReasoningEffort(value: unknown): "low" | "medium" | "high" | "xhigh" | undefined {
  if (value === undefined) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new Error("Reasoning effort AI non valido: scegli Automatico, Low, Medium, High o Extra high.");
}
export function chatStreamMode(value: unknown): "off" | "sse" {
  if (value === undefined || value === "off") return "off";
  if (value === "sse") return "sse";
  throw new Error("Modalità streaming AI non valida.");
}
/** Free local endpoints stream by default: in JSON mode the server sends headers only after the
 * whole answer, so a slow local model would hit the header timeout. An explicit choice always wins. */
export function endpointStreamMode(endpoint: { streamMode?: unknown; authMode?: unknown }): "off" | "sse" {
  if (endpoint.streamMode === undefined && endpoint.authMode === "none") return "sse";
  return chatStreamMode(endpoint.streamMode);
}

export async function readChatCompletionStream(
  response: Response,
  signal: AbortSignal,
  onDelta?: (delta: AiStreamDelta) => void,
  readTimeoutMs = CHAT_STREAM_TIMEOUT_MS,
  onTransport?: (stats:AiTransportStats)=>void,
): Promise<StreamCompletion> {
  if (signal.aborted) throw new DOMException("Generazione interrotta.", "AbortError");
  const type = response.headers.get("content-type") ?? "";
  if (!/^text\/event-stream\b/i.test(type)) throw invalid();
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length.trim()) ||
    Number(length) > MAX_CHAT_COMPLETION_BYTES)) throw invalid();
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let reasoning = "";
  let usage:StreamCompletion["usage"];
  let finishReason:string|undefined;
  let pending = "";
  let bytes = 0;
  let events=0;
  let done = false;
  let completed = false;
  let abortHandler: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  let rejectExpired: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_,reject)=>{
    abortHandler = ()=>reject(new DOMException("Generazione interrotta.", "AbortError"));
    signal.addEventListener("abort",abortHandler,{once:true});
    rejectExpired = reject;
  });
  // Inactivity deadline: re-armed after every received chunk, so a slow but
  // steady local model is not cut off mid-answer.
  const armIdleTimer = () => {
    if(timer!==undefined)clearTimeout(timer);
    timer=setTimeout(()=>{expired=true;rejectExpired(timeout());},readTimeoutMs);
  };
  armIdleTimer();
  totalTimer=setTimeout(()=>{expired=true;rejectExpired(timeout());},CHAT_STREAM_TOTAL_CAP_MS);
  const acceptEvent = (data:string) => {
    const value=data.trim();
    events++;
    try{onTransport?.({bytes,events});}catch{/* observer only */}
    if (value === "[DONE]") { done = true; return; }
    if (!value) return;
    let parsed:unknown;
    try{parsed=JSON.parse(value);}catch{throw invalid();}
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
    const envelope=parsed as {
      choices?: unknown;
      usage?: unknown;
      error?: unknown;
    };
    if (envelope.error !== undefined) throw invalid();
    if (envelope.usage && typeof envelope.usage === "object" &&
      !Array.isArray(envelope.usage)) usage=envelope.usage as StreamCompletion["usage"];
    if (envelope.choices !== undefined) {
      if(!Array.isArray(envelope.choices))throw invalid();
      for (const choice of envelope.choices) {
        if (!choice || typeof choice !== "object" || Array.isArray(choice))throw invalid();
        const c=choice as { index?:unknown; delta?:unknown; finish_reason?:unknown };
        if(c.index!==undefined && c.index!==0) continue;
        if(typeof c.finish_reason=="string") finishReason=c.finish_reason;
        if(c.delta===null||c.delta===undefined) continue;
        if(typeof c.delta!=="object"||Array.isArray(c.delta))throw invalid();
        const d=c.delta as {content?:unknown;reasoning_content?:unknown;reasoning?:unknown};
        if(d.content!==undefined && d.content!==null){
          if(typeof d.content!=="string")throw invalid();
          text+=d.content;
          if(text.length>MAX_CHAT_COMPLETION_BYTES)throw invalid();
          try{onDelta?.({kind:"text",text:d.content});}catch{/* observer cannot affect canonical output */ }
        }
        const reason=d.reasoning_content??d.reasoning;
        if(reason!==undefined && reason!==null){
          if(typeof reason!=="string")throw invalid();
          reasoning+=reason;
          if(reasoning.length>MAX_CHAT_COMPLETION_BYTES)throw invalid();
          try{onDelta?.({kind:"reasoning",text:reason});}catch{/* observer only */ }
        }
      }
    }
  };
  const consume = (chunk:string) => {
    pending+=chunk.replace(/\r\n/g,"\n");
    if(pending.length>MAX_CHAT_COMPLETION_BYTES)throw invalid();
    let cursor:number;
    while((cursor=pending.indexOf("\n\n"))>=0) {
      const event=pending.slice(0,cursor);
      pending=pending.slice(cursor+2);
      const data=event.split("\n").filter(line=>line.startsWith("data:"))
        .map(line=>line.slice(5).trimStart()).join("\n");
      if(done && data.trim())throw invalid();
      if(data)acceptEvent(data);
    }
  };
  try {
    while(!done) {
      const chunk=await Promise.race([reader.read(),cancelled]);
      if(signal.aborted)throw new DOMException("Generazione interrotta.", "AbortError");
      if(chunk.done)break;
      armIdleTimer();
      bytes+=chunk.value.byteLength;
      if(bytes>MAX_CHAT_COMPLETION_BYTES)throw invalid();
      try{onTransport?.({bytes,events});}catch{/* observer only */}
      consume(decoder.decode(chunk.value,{stream:true}));
    }
    if(!done) {
      consume(decoder.decode());
      // A terminated connection without [DONE] is not an accepted result.
      if(!done)throw invalid();
    }
    if(!text.trim())throw new ProviderResponseReadError(finishReason==="length"
      ? "Il modello ha esaurito il limite di lunghezza o di contesto prima di scrivere la risposta (di solito per il reasoning). Nessun output applicato: aumenta il contesto in LM Studio o abbassa il thinking."
      : reasoning
      ? "Il provider ha terminato dopo il reasoning ma senza testo finale: nessun output applicato."
      : "Il provider ha terminato senza generare una risposta testuale: nessun output applicato.");
    completed=true;
    return {choices:[{message:{content:text},...(finishReason===undefined?{}:{finish_reason:finishReason})}],usage};
  } catch(e){
    if(signal.aborted)throw new DOMException("Generazione interrotta.", "AbortError");
    if(expired)throw timeout();
    if(e instanceof ProviderResponseReadError)throw e;
    throw invalid();
  } finally {
    if(timer!==undefined)clearTimeout(timer);
    if(totalTimer!==undefined)clearTimeout(totalTimer);
    if(abortHandler)signal.removeEventListener("abort",abortHandler);
    if(!completed){
      try{void reader.cancel().catch(()=>{});}catch{/* ignore */ }
    }
    try{reader.releaseLock();}catch{/* ignore pending */ }
  }
}
