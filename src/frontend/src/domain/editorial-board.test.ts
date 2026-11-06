import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, ROLE_LABELS, acceptedRepairs, adjudicationPrompt, beginNextRound,
  chapterSegments, createEditorialCycle, nextReviewSlot, repairPrompt, reviewerPrompt,
  locateNarrativeEvidence, reviewerTask, validateJudgment, validateReport,
} from "./editorial-board";

function sample(): BookProject {
  const b = newBook("Un thriller storico in cui Mara custodisce la chiave.", "Romanzo", "Prosa sobria", "Adulti");
  b.memory.characters.Mara = "Parla sottovoce quando è spaventata.";
  b.memory.secrets.chiave = "La chiave apre una stanza segreta: NON rivelarlo nel primo capitolo.";
  b.memory.timeline = ["Nel 1848 Mara arriva al castello."];
  b.chapters = [{
    id:"ch-1",number:1,title:"Il castello",purpose:"Introduzione",
    scenes:[
      { id:"s-1",number:1,title:"La porta",objective:"Arrivare",
        text:"Mara incontra il guardiano davanti alla porta.",status:"canon" },
      { id:"s-2",number:2,title:"La stanza",objective:"Accumulare tensione",
        text:"Mara nasconde la chiave e non dice niente.",status:"canon" },
    ],
  }];
  return b;
}
function report(sceneId:string, issue=false) {
  return JSON.stringify({
    verdict:issue?"issues":"pass",summary:issue?"La voce non è coerente.":"La scena è coerente.",
    memoryNote:"Un dettaglio da ricordare.",
    findings:issue ? [{
      sceneId,category:"voce",severity:"major",
      evidence:"Mara incontra il guardiano",
      reason:"Non si capisce perché Mara alza la voce.",
      remediation:"Riscrivere il dialogo in un tono più sommesso.",
    }] : [],
  });
}
describe("Redazione indipendente dei capitoli",()=>{
  it("usa sette specialisti e cinque lettori con chiamate e ruoli distinti",()=>{
    expect(EDITORIAL_ROLES).toHaveLength(12);
    expect(new Set(EDITORIAL_ROLES).size).toBe(12);
    expect(EDITORIAL_ROLES.every(r=>ROLE_LABELS[r])).toBe(true);
    expect(reviewerTask("historical")).toBe("chapterAudit");
    expect(reviewerTask("readerMystery")).toBe("chapterReaders");
    const book=sample(), cycle=createEditorialCycle("ch-1");
    const segment=nextReviewSlot(book,cycle)!;
    expect(segment.role).toBe("continuity");
    expect(segment.segment.sceneId).toBe("s-1");
    expect(segment.segmentCount).toBe(2);
  });
  it("il lettore non riceve segreti e dossiers privati, ma l'agente segreti li vede",()=>{
    const b=sample(),cycle=createEditorialCycle("ch-1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    const reader=reviewerPrompt(b,cycle,"readerMystery",seg,2);
    const specialist=reviewerPrompt(b,cycle,"secrets",seg,2);
    expect(reader.prompt).not.toContain("NON rivelarlo");
    expect(reader.prompt).not.toContain("Parla sottovoce");
    expect(reader.system).toContain("INDIPENDENTE");
    expect(specialist.prompt).toContain("NON rivelarlo");
    expect(reader.prompt).toContain(seg.text);
  });
  it("segmenta un capitolo lungo senza troncare nemmeno un carattere",()=>{
    const b=sample();
    b.chapters[0]!.scenes[0]!.text="Paragrafo lungo.\n".repeat(1300);
    const segments=chapterSegments(b.chapters[0]!);
    expect(segments.length).toBeGreaterThan(2);
    const restored=segments.filter(x=>x.sceneId==="s-1").map(x=>x.text).join("");
    expect(restored).toBe(b.chapters[0]!.scenes[0]!.text);
    expect(segments.every(x=>x.text.length<=10000)).toBe(true);
  });
  it("esige coerenza fra esito, scene e remediation, e genera ID univoci",()=>{
    const b=sample(),c=createEditorialCycle("ch-1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    expect(()=>validateReport(c,"style",seg,2,report("s-2",true),b.chapters[0]!)).toThrow(/scena/i);
    const ok=validateReport(c,"style",seg,2,report("s-1",true),b.chapters[0]!);
    expect(ok.findings[0]?.id).toBe("1:style:0:0");
    expect(()=>validateReport(c,"style",seg,2,
      '{"verdict":"pass","summary":"Un buon testo.","findings":[{"sceneId":"s-1","category":"voce","severity":"major","evidence":"Quel testo","reason":"Un problema vero","remediation":"Rivedere la prosa"}]}',
      b.chapters[0]!)).toThrow();
    c.reports.push(ok);
    const prompt = adjudicationPrompt(b,c);
    expect(prompt.prompt).toContain(ok.findings[0]!.id);
    expect(prompt.prompt).toContain('"evidenceLocated":true');
    expect(prompt.prompt).toContain("Mara incontra il guardiano");
    expect(prompt.prompt).toContain("La chiave apre");
    expect(prompt.system).toContain("OPINIONI NON ATTENDIBILI");
  });
  it("il direttore può respingere una critica motivandola, senza riscrittura",()=>{
    const b=sample(),c=createEditorialCycle("ch-1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    c.reports.push(validateReport(c,"style",seg,2,report("s-1",true),b.chapters[0]!));
    const id=c.reports[0]!.findings[0]!.id;
    const verdict=validateJudgment(c,JSON.stringify({
      reasoning:"La scena è volutamente ambigua e la critica non dimostra una contraddizione narrativa reale.",
      decisions:[{findingId:id,action:"reject",
        rationale:"La voce è volutamente incerta, senza prove di incoerenza.",
        remediation:""}],
    }));
    expect(verdict.verdict).toBe("freeze");
    c.judgment=verdict;
    expect(acceptedRepairs(c)).toHaveLength(0);
  });
  it("ogni rilievo richiede decisione unica, evidenza e correzione concreta se accolto",()=>{
    const b=sample(),c=createEditorialCycle("ch-1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    c.reports.push(validateReport(c,"style",seg,2,report("s-1",true),b.chapters[0]!));
    const id=c.reports[0]!.findings[0]!.id;
    const base="Dopo l'analisi del testo preferisco verificare l'intervento.";
    expect(()=>validateJudgment(c,JSON.stringify({reasoning:base,decisions:[]}))).toThrow(/tutti/i);
    expect(()=>validateJudgment(c,JSON.stringify({reasoning:base,
      decisions:[{findingId:"fake",action:"reject",rationale:"Non è fondato"}]}))).toThrow();
    expect(()=>validateJudgment(c,JSON.stringify({reasoning:base,
      decisions:[{findingId:id,action:"accept",rationale:"Va corretto con attenzione",
        remediation:""}]}))).toThrow(/remediation/i);
    c.judgment=validateJudgment(c,JSON.stringify({reasoning:base,
      decisions:[{findingId:id,action:"accept",
        rationale:"La battuta è incompatibile con il dossier del personaggio.",
        remediation:"Rendere la frase sommessa e lasciare implicito il segreto."}]}));
    expect(c.judgment.verdict).toBe("repair");
    expect(acceptedRepairs(c)[0]?.sceneId).toBe("s-1");
    const prompt=repairPrompt(b,c,"s-1").prompt;
    expect(prompt).toContain("Rendere la frase sommessa");
    expect(prompt).toContain("Mara incontra");
  });
  it("dopo tre tornate di riparazione si blocca e NON finge di aver congelato",()=>{
    const cycle=createEditorialCycle("ch-1");
    for(let i=1;i<=3;i++){
      cycle.judgment={reasoning:"Un problema ancora aperto.",decisions:[],
        verdict:"repair",createdAt:new Date().toISOString()};
      beginNextRound(cycle);
    }
    expect(cycle.stage).toBe("blocked");
    expect(cycle.priorRounds).toHaveLength(3);
    expect(cycle.blockedReason).toMatch(/decisione umana/i);
  });

  it("esige che le prove siano citazioni reali del singolo segmento: mai parafrasi o altro contesto",()=>{
    const b=sample(),c=createEditorialCycle("ch-1");
    const segment=chapterSegments(b.chapters[0]!)[0]!;
    const original=JSON.parse(report("s-1",true)) as {
      findings:Array<{evidence:string}>;
    };
    const run=(evidence:string)=>{
      const payload=structuredClone(original);
      payload.findings[0]!.evidence=evidence;
      return validateReport(c,"style",segment,2,JSON.stringify(payload),b.chapters[0]!);
    };
    expect(()=>run("Mara incontra il guardiano mai comparso")).toThrow(/non presente letteralmente/);
    expect(()=>run("Mara nasconde la chiave")).toThrow(/non presente letteralmente/);
    expect(()=>run("Mara incontra... il guardiano")).toThrow(/non presente letteralmente/);
    const valid=run("MARA INCONTRA IL GUARDIANO");
    expect(valid.findings[0]?.evidenceAnchor).toMatchObject({
      segmentIndex:0,offset:0,quote:"Mara incontra il guardiano",occurrences:1,
    });
    expect(valid.findings[0]?.evidenceAnchor?.context).toContain("davanti alla porta.");
    const judgeBook=sample(),judgeCycle=createEditorialCycle("ch-1");
    judgeCycle.reports.push(valid);
    expect(adjudicationPrompt(judgeBook,judgeCycle).prompt)
      .toContain('"anchorStatus":"verified_in_reviewed_segment"');
    expect(adjudicationPrompt(judgeBook,judgeCycle).prompt)
      .not.toContain('"anchorStatus":"legacy_or_stale_unverified"');
  });
  it("ancora spazi e a capo senza accettare parole riordinate, e dichiara le occorrenze multiple",()=>{
    const txt="La porta si apre.\nMara trova la chiave. Poi Mara trova la chiave.";
    const valid=locateNarrativeEvidence(txt,"MARA TROVA\nLA CHIAVE");
    expect(valid).toMatchObject({segmentIndex:-1,offset:txt.indexOf("Mara"),
      quote:"Mara trova la chiave",occurrences:2});
    expect(locateNarrativeEvidence(txt,"la chiave Mara trova")).toBeUndefined();
    expect(locateNarrativeEvidence(txt,"Mara ... chiave")).toBeUndefined();
    const line=locateNarrativeEvidence("Nel cortile\nMara trova la chiave.",
      "Nel cortile Mara trova la chiave");
    expect(line?.quote).toBe("Nel cortile\nMara trova la chiave");
  });
  it("rifiuta risultati AI su segmenti mutati prima del salvataggio del rapporto",()=>{
    const b=sample(),c=createEditorialCycle("ch-1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    b.chapters[0]!.scenes[0]!.text="Mara guarda il guardiano davanti alla porta.";
    expect(()=>validateReport(c,"style",seg,2,report("s-1",true),b.chapters[0]!))
      .toThrow(/Segmento editoriale cambiato/);
    expect(c.reports).toHaveLength(0);
  });
  it("il giudice non può approvare remediation con prove legacy, manomesse o diventate obsolete",()=>{
    const b=sample(),c=createEditorialCycle("ch-1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    const reportOk=validateReport(c,"style",seg,2,report("s-1",true),b.chapters[0]!);
    c.reports.push(reportOk);
    const id=reportOk.findings[0]!.id;
    const decision=(action:"accept"|"reject")=>JSON.stringify({
      reasoning:"Il rilievo deve essere verificato contro la scena corrente senza inferenze.",
      decisions:[{findingId:id,action,rationale:
        "L'intento della battuta non basta per accettare automaticamente una riscrittura.",
        remediation:action==="accept"?"Riscrivere il passaggio mantenendo la voce.":""}],
    });
    expect(validateJudgment(c,decision("accept"),b.chapters[0]!).verdict).toBe("repair");
    const anchor=reportOk.findings[0]!.evidenceAnchor!;
    reportOk.findings[0]!.evidenceAnchor={...anchor,offset:anchor.offset+1};
    expect(()=>validateJudgment(c,decision("accept"),b.chapters[0]!))
      .toThrow(/prova narrativa legacy, manomessa/);
    reportOk.findings[0]!.evidenceAnchor=anchor;
    b.chapters[0]!.scenes[0]!.text="Mara corre verso la torre.";
    expect(()=>validateJudgment(c,decision("accept"),b.chapters[0]!))
      .toThrow(/prova narrativa legacy, manomessa/);
    delete reportOk.findings[0]!.evidenceAnchor;
    expect(validateJudgment(c,decision("reject"),b.chapters[0]!).verdict).toBe("freeze");
    expect(()=>validateJudgment(c,decision("accept"),b.chapters[0]!))
      .toThrow(/prova narrativa legacy/);
    expect(adjudicationPrompt(b,c).prompt).toContain("legacy_or_stale_unverified");
  });
});
