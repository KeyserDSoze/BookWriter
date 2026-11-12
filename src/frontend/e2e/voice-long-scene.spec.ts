import { expect, test } from "@playwright/test";

type SpeechProbe = Window & {
  spoken?: Array<{text:string;rate:number;onend?:()=>void}>;
  cancels?: number;
  pauses?: number;
  resumes?: number;
  endCurrent?: ()=>void;
  originalScene?: string;
};

test("Lettura integrale con blocchi, progresso, pausa/riprendi e invalidazione dopo stop (desktop/mobile)", async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    const probe=window as SpeechProbe;
    probe.spoken=[];probe.cancels=0;probe.pauses=0;probe.resumes=0;
    Object.defineProperty(window,"SpeechSynthesisUtterance",{configurable:true,value:class{
      text:string;rate=1;lang="";voice:SpeechSynthesisVoice|null=null;
      onend?:()=>void;onerror?:()=>void;
      constructor(text:string){this.text=text;}
    }});
    Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{
      getVoices:()=>[],addEventListener:()=>{},removeEventListener:()=>{},
      speak:(utterance:{text:string;rate:number;onend?:()=>void})=>{
        probe.spoken!.push({text:utterance.text,rate:utterance.rate,onend:utterance.onend});
      },
      cancel:()=>{probe.cancels=(probe.cancels??0)+1;},
      pause:()=>{probe.pauses=(probe.pauses??0)+1;},
      resume:()=>{probe.resumes=(probe.resumes??0)+1;},
    }});
    probe.endCurrent=()=>{
      probe.spoken?.at(-1)?.onend?.();
    };
  });
  await page.goto("/");
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Dashboard"}).click();
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Voce e continuità");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Il manoscritto parla di un ponte e delle sue conseguenze.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  const longText="Una scena canonica con un segreto. ".repeat(240)+"La conclusione della scena è fondamentale.";
  await page.evaluate(text=>new Promise<void>((resolve,reject)=>{
    const opening=indexedDB.open("bookwriter");
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{
      const tx=opening.result.transaction("books","readwrite");
      const request=tx.objectStore("books").getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const b=request.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="chapterReview";
        b.chapters=[{id:"cap",number:1,title:"Il ponte",purpose:"Test",
          scenes:[
            {id:"long-scene",number:1,title:"Scena integrale",objective:"Test",
              status:"canon",text},
            {id:"draft-secret",number:2,title:"Bozza non letta",objective:"Test",
              status:"draft",text:"Testo privato non canonico"},
            {id:"short-scene",number:3,title:"Scena finale",objective:"Test",
              status:"canon",text:"Una scena più breve."},
          ]}];
        tx.objectStore("books").put(b,b.id as string);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>resolve();
    };
  }),longText);
  await page.reload();
  await nav.getByRole("button",{name:"Libro"}).click();
  const reader=page.getByRole("region",{name:"Ascolta il manoscritto"});
  await expect(reader.getByRole("combobox",{name:"Scena da ascoltare"}))
    .not.toContainText("Bozza non letta");
  await reader.getByRole("button",{name:"Ascolta scena"}).click();
  await expect(reader.getByLabel("Progresso della lettura")).toContainText(/Blocco 1 di/);
  const first=await page.evaluate(()=>(window as SpeechProbe).spoken?.[0]?.text);
  expect(first?.length).toBeLessThanOrEqual(700);
  await reader.getByRole("button",{name:"Pausa"}).click();
  await reader.getByRole("button",{name:"Riprendi"}).click();
  expect(await page.evaluate(()=>(window as SpeechProbe).pauses)).toBe(1);
  expect(await page.evaluate(()=>(window as SpeechProbe).resumes)).toBe(1);
  // Drive the mock voice's end callback for every block, as a real Web Speech
  // engine would. The complete canonical text must arrive without gaps.
  let count=0;
  while(count<100) {
    const state=await page.evaluate(()=>{
      const probe=window as SpeechProbe;
      const current=probe.spoken?.at(-1);
      if(!current?.onend)return {done:true};
      current.onend();
      return {done:false};
    });
    if(state.done)break;
    count++;
    const done=await reader.getByRole("status").textContent();
    if(done?.includes("Scena letta integralmente."))break;
  }
  expect(count).toBeGreaterThan(5);
  const read=await page.evaluate(()=>(window as SpeechProbe).spoken?.map(x=>x.text).join(""));
  expect(read).toBe(longText);
  expect(read).not.toContain("Testo privato non canonico");
  await expect(reader.getByRole("status")).toContainText("Scena letta integralmente.");

  await reader.getByRole("button",{name:"Ascolta scena"}).click();
  const before=await page.evaluate(()=>(window as SpeechProbe).spoken?.length??0);
  // Directly invoke the stale utterance after stop; the generation guard must fence it.
  await reader.getByRole("button",{name:"Ferma"}).click();
  await page.evaluate(()=>(window as SpeechProbe).spoken?.at(-1)?.onend?.());
  expect(await page.evaluate(()=>(window as SpeechProbe).spoken?.length)).toBe(before);
  await reader.getByRole("combobox",{name:"Scena da ascoltare"}).selectOption("short-scene");
  await reader.getByRole("button",{name:"Ascolta scena"}).click();
  const after=await page.evaluate(()=>(window as SpeechProbe).spoken?.at(-1)?.text);
  expect(after).toBe("Una scena più breve.");
});
