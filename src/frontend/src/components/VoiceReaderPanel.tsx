import { useEffect, useRef, useState } from "react";
import type { AppSettings, BookProject } from "../domain/types";
import { speechSegments } from "../domain/speech-segments";

interface VoiceScene { id: string; label: string; text: string; }
type Playback = {
  generation: number;
  parts: string[];
  index: number;
  rate: number;
  voice: SpeechSynthesisVoice | undefined;
};

/** Browser speech is distinct from the configured provider TTS model.
 * Only canonical scenes are exposed to the browser speech engine. */
export function VoiceReaderPanel({book,settings}: {book:BookProject;settings:AppSettings}) {
  const scenes:VoiceScene[]=book.chapters.flatMap(ch=>ch.scenes
    .filter(scene=>scene.status==="canon" && !!scene.text.trim())
    .map(scene=>({id:scene.id,label:`Cap. ${ch.number} — ${ch.title}, scena ${scene.number}: ${scene.title}`,
      text:scene.text.trim()})));
  const [selected,setSelected]=useState("");
  const activeScene=scenes.find(s=>s.id===selected)??scenes[0];
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [voiceName,setVoiceName]=useState("");
  const [speed,setSpeed]=useState(1);
  const [state,setState]=useState<"idle"|"playing"|"paused">("idle");
  const [message,setMessage]=useState("");
  const [part,setPart]=useState(0);
  const [total,setTotal]=useState(0);
  const generation=useRef(0);
  const playback=useRef<Playback|null>(null);
  const supported=typeof window!=="undefined" &&
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  const invalidate=()=>{
    generation.current++;
    playback.current=null;
    if(supported)window.speechSynthesis.cancel();
  };
  const stop=()=>{
    invalidate();
    setState("idle");setMessage("Lettura interrotta.");setPart(0);setTotal(0);
  };

  useEffect(()=>{
    if(!supported)return;
    const speech=window.speechSynthesis;
    const refresh=()=>setVoices(speech.getVoices());
    refresh();
    speech.addEventListener?.("voiceschanged",refresh);
    return ()=>{
      generation.current++;
      playback.current=null;
      speech.cancel();
      speech.removeEventListener?.("voiceschanged",refresh);
    };
  },[supported,book.id]);

  useEffect(()=>{
    invalidate();
    setState("idle");setMessage("");setPart(0);setTotal(0);
    // Unmount or a new canonical book revision must invalidate every pending
    // onend/onerror callback before it can speak another segment.
    return ()=>{invalidate();};
    // Changes of scene, book and voice are intentionally playback boundaries.
  },[book.id,book.updatedAt,selected,voiceName,supported]);

  const speakNext=(id:number)=>{
    const run=playback.current;
    if(!supported || !run || run.generation!==id || generation.current!==id)return;
    if(run.index>=run.parts.length){
      playback.current=null;
      setState("idle");setMessage("Scena letta integralmente.");return;
    }
    const position=run.index++;
    const utterance=new SpeechSynthesisUtterance(run.parts[position]!);
    utterance.rate=run.rate;
    if(run.voice){utterance.voice=run.voice;utterance.lang=run.voice.lang;}
    else utterance.lang="it-IT";
    utterance.onend=()=>{if(generation.current===id && playback.current===run)speakNext(id);};
    utterance.onerror=()=>{
      if(generation.current!==id || playback.current!==run)return;
      invalidate();setState("idle");
      setMessage("Errore della voce del browser: controlla le voci del sistema.");
    };
    setPart(position+1);
    setMessage(`Lettura in corso, blocco ${position+1} di ${run.parts.length}.`);
    try{window.speechSynthesis.speak(utterance);}
    catch{
      if(generation.current===id){invalidate();setState("idle");
        setMessage("Impossibile avviare la voce del browser.");}
    }
  };
  const read=()=>{
    if(!supported || !activeScene)return;
    invalidate();
    let parts:string[];
    try{parts=speechSegments(activeScene.text);}
    catch(e){
      setState("idle");setMessage(e instanceof Error?e.message:"Testo vocale non valido.");
      setPart(0);setTotal(0);return;
    }
    if(!parts.length){setState("idle");setMessage("La scena non contiene testo leggibile.");return;}
    const id=generation.current;
    playback.current={generation:id,parts,index:0,rate:speed,
      voice:voices.find(v=>v.name===voiceName)};
    setTotal(parts.length);setPart(0);setState("playing");speakNext(id);
  };
  const toggle=()=>{
    if(!supported || !playback.current)return;
    try{
      if(state==="paused"){window.speechSynthesis.resume();setState("playing");}
      else if(state==="playing"){window.speechSynthesis.pause();setState("paused");}
    }catch{
      stop();setMessage("Non è possibile sospendere o riprendere questa voce del browser.");
    }
  };
  const voiceDefault=settings.capabilityRoutes?.voice;
  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Ascolta il manoscritto">
    <h2 className="text-lg font-semibold">Ascolta il manoscritto</h2>
    <p className="muted mt-1 text-sm">Riascolta dialoghi e ritmo di un'intera scena canonica, suddivisa in blocchi.
      Il comando usa la sintesi vocale del browser, non invia direttamente il libro a un endpoint AI.
      Alcune voci del sistema operativo potrebbero usare servizi online: verifica le impostazioni del dispositivo.</p>
    {voiceDefault && <p className="muted mt-2 text-xs">
      Modello Voce configurato: {voiceDefault.modelId} (non utilizzato da questa modalità).
      L'eventuale adapter TTS del modello richiederà compatibilità API verificata.</p>}
    {!supported ? <p role="status" className="mt-3 text-sm">
      Sintesi vocale non supportata da questo browser. Prova un browser con Web Speech API.</p>
      : scenes.length===0 ? <p className="muted mt-3 text-sm">Non ci sono ancora scene canoniche da ascoltare.</p>
      : <>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="listen-scene" className="mb-1 block text-sm font-semibold">Scena da ascoltare</label>
            <select id="listen-scene" className="field" value={activeScene?.id??""}
              onChange={e=>{stop();setSelected(e.target.value);}}>
              {scenes.map(scene=><option key={scene.id} value={scene.id}>{scene.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="listen-voice" className="mb-1 block text-sm font-semibold">Voce del browser</label>
            <select id="listen-voice" className="field" value={voiceName}
              onChange={e=>{stop();setVoiceName(e.target.value);}}>
              <option value="">Voce predefinita (italiano)</option>
              {voices.map((voice,index)=><option key={`${voice.name}:${index}`} value={voice.name}>
                {voice.name} ({voice.lang})
              </option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor="listen-speed" className="text-sm font-semibold">Velocità: {speed.toFixed(1)}×</label>
          <input id="listen-speed" type="range" min="0.7" max="1.3" step="0.1" value={speed}
            onChange={e=>{stop();setSpeed(Number(e.target.value));}}/>
          <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            onClick={read}>{state==="idle"?"Ascolta scena":"Ricomincia scena"}</button>
          <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            onClick={toggle} disabled={state==="idle"}>{state==="paused"?"Riprendi":"Pausa"}</button>
          <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            onClick={stop} disabled={state==="idle"}>Ferma</button>
        </div>
        {total>0 && <p className="muted mt-2 text-xs" aria-label="Progresso della lettura">
          Blocco {part} di {total} (avanzamento per segmenti, non per tempo trascorso).
        </p>}
        <p role="status" className="muted mt-2 text-sm">{message}</p>
      </>}
  </section>;
}
