import { useEffect, useRef, useState } from "react";

/** Follow new text unless the author has scrolled up to inspect an earlier passage. */
export function AiStreamText({ text, label, compact=false }: {
  text:string; label:string; compact?:boolean;
}) {
  const viewport=useRef<HTMLPreElement>(null);
  const following=useRef(true);
  const [paused,setPaused]=useState(false);
  const [overflowing,setOverflowing]=useState(false);
  const follow=()=>{
    following.current=true;setPaused(false);
    if(viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;
  };
  useEffect(()=>{
    if((compact||following.current)&&viewport.current)
      viewport.current.scrollTop=viewport.current.scrollHeight;
    if(compact&&viewport.current)setOverflowing(viewport.current.scrollHeight>viewport.current.clientHeight);
  },[text,compact]);
  return <div className="min-w-0">
    {!compact&&paused&&<button type="button" className="mb-1 min-h-11 rounded-lg border border-slate-400 px-3 text-xs"
      onClick={follow}>Segui il testo in arrivo</button>}
    <pre ref={viewport} aria-label={label} tabIndex={compact?undefined:0}
      onScroll={compact?undefined:()=>{
        const element=viewport.current;
        if(!element)return;
        following.current=element.scrollHeight-element.scrollTop-element.clientHeight<32;
        setPaused(!following.current);
      }}
      className={"whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere] "+(compact
        ?"max-h-[100px] overflow-hidden leading-5"
        :"max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-slate-100")}
      style={compact&&overflowing?{maskImage:"linear-gradient(to bottom, transparent, black 28px)"}:undefined}
    >{text}</pre>
  </div>;
}
