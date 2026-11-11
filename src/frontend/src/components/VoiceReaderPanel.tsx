import { useEffect, useState } from "react";
import type { AppSettings, BookProject } from "../domain/types";

interface VoiceScene { id: string; label: string; text: string; }
const MAX_READ_CHARS=5000;

/** Immediate editorial read-aloud: browser speech synthesis, not a claim that
 * LM Studio exposes /v1/audio/speech. No BookWriter provider request. */
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
  const supported=typeof window!=="undefined" &&
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  useEffect(()=>{
    if(!supported)return;
    const speech=window.speechSynthesis;
    const refresh=()=>setVoices(speech.getVoices());
    refresh();
    speech.addEventListener?.("voiceschanged",refresh);
    return ()=>{speech.cancel();speech.removeEventListener?.("voiceschanged",refresh);};
  },[supported,book.id]);

  useEffect(()=>{
    if(supported)window.speechSynthesis.cancel();
    setState("idle");setMessage("");
  },[book.id,selected,book.updatedAt,supported]);

  const stop=()=>{
    if(supported)window.speechSynthesis.cancel();
    setState("idle");setMessage("Lettura interrotta.");
  };
  const read=()=>{
    if(!supported || !activeScene)return;
    const speech=window.speechSynthesis;
    speech.cancel();
    const utterance=new SpeechSynthesisUtterance(activeScene.text.slice(0,MAX_READ_CHARS));
    utterance.rate=speed;
    const voice=voices.find(v=>v.name===voiceName);
    if(voice){utterance.voice=voice;utterance.lang=voice.lang;}
    else utterance.lang="it-IT";
    utterance.onend=()=>{setState("idle");setMessage("Lettura terminata.");};
    utterance.onerror=()=>{setState("idle");setMessage("La sintesi vocale del browser non è disponibile. Verifica le voci installate nel sistema.");};
    speech.speak(utterance);
    setState("playing");
    setMessage(activeScene.text.length>MAX_READ_CHARS?
      `Lettura dei primi ${MAX_READ_CHARS} caratteri della scena.`:"Lettura in corso.");
  };
  const toggle=()=>{
    if(!supported)return;
    if(state==="paused"){window.speechSynthesis.resume();setState("playing");}
    else if(state==="playing"){window.speechSynthesis.pause();setState("paused");}
  };
  const voiceDefault=settings.capabilityRoutes?.voice;
  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Ascolta il manoscritto">
    <h2 className="text-lg font-semibold">Ascolta il manoscritto</h2>
    <p className="muted mt-1 text-sm">Riascolta dialoghi e ritmo della prosa canonica.
      Il comando usa la sintesi vocale del browser, non invia il libro a un endpoint AI.
      Alcune voci del sistema operativo potrebbero usare servizi online: verifica le impostazioni del dispositivo.</p>
    {voiceDefault && <p className="muted mt-2 text-xs">
      Modello Voce configurato: {voiceDefault.modelId} (non utilizzato da questa modalità).
      LM Studio non documenta /v1/audio/speech: il collegamento al modello TTS richiederà un adapter compatibile.</p>}
    {!supported ? <p role="status" className="mt-3 text-sm">
      Sintesi vocale non supportata da questo browser. Prova un browser con Web Speech API.</p>
      : scenes.length===0 ? <p className="muted mt-3 text-sm">Non ci sono ancora scene canoniche da ascoltare.</p>
      : <>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="listen-scene" className="mb-1 block text-sm font-semibold">Scena da ascoltare</label>
            <select id="listen-scene" className="field" value={activeScene?.id ?? ""}
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
            onChange={e=>setSpeed(Number(e.target.value))}/>
          <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            onClick={read}>{state==="idle"?"Ascolta scena":"Ricomincia scena"}</button>
          <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            onClick={toggle} disabled={state==="idle"}>{state==="paused"?"Riprendi":"Pausa"}</button>
          <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            onClick={stop} disabled={state==="idle"}>Ferma</button>
        </div>
        <p role="status" className="muted mt-2 text-sm">{message}</p>
      </>}
  </section>;
}
