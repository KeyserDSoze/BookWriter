import { describe, expect, it } from "vitest";
import { describeHeadline, describeLiveProgress, describeSceneRef, type LiveProgress } from "./live-progress";

const TITLE = "Redazione: continuity 3/36";
const REPORT = JSON.stringify({
  verdict: "issues",
  summary: "Due problemi: un'immagine abusata e una svista sull'ora del mattino.",
  findings: [
    { sceneId: "scene:001:002", category: "Cliché", severity: "minor", evidence: "Il sole tramontava", reason: "Immagine abusata nel genere.", remediation: "Variare l'immagine." },
    { sceneId: "scene:001:003", category: "Cronologia", severity: "critical", evidence: "Alle tre del mattino", reason: "Contraddice l'alba descritta due righe sopra.", remediation: "Spostare l'ora." },
    { sceneId: "scene:002:001", category: "Voce", severity: "major", evidence: "Mara disse con calma", reason: "Mara non parla così.", remediation: "Riscrivere la battuta." },
  ],
  memoryNote: "Mara non conosce ancora il contenuto della lettera.",
});
const JUDGMENT = JSON.stringify({
  reasoning: "Ho verificato le citazioni nel testo e valutato ogni rilievo da solo.",
  decisions: [
    { findingId: "r1:continuity:0", action: "accept", rationale: "La citazione è presente e la contraddizione è reale.", remediation: "Spostare l'ora all'alba." },
    { findingId: "r1:style:1", action: "reject", rationale: "È una scelta stilistica coerente con il registro.", remediation: "" },
  ],
});
const PLAN = JSON.stringify({ chapters: [
  { title: "L'arrivo", purpose: "Mara raggiunge l'isola e trova la casa vuota.", scenes: [{ title: "Il traghetto", objective: "Presentare Mara." }, { title: "La casa", objective: "Scoprire la lettera." }] },
  { title: "La lettera", purpose: "Il contenuto cambia i piani.", scenes: [{ title: "La lettura", objective: "Rivelare la prima metà." }] },
] });
const SCENES = JSON.stringify({ scenes: [{ title: "Il porto", objective: "Mostrare l'isola." }, { title: "Il faro", objective: "Introdurre il guardiano." }] });
const MEMORY = JSON.stringify({
  mode: "delta", sceneSummary: "Mara trova la lettera e la nasconde nel cappotto.",
  characters: { Mara: "Ha la lettera e non l'ha detto a nessuno.", Elio: "Sospetta di lei." }, locations: { Faro: "Chiuso da anni." },
  factions: {}, items: { Lettera: "Nel cappotto di Mara." }, secrets: { "lettera-contenuto": "Rivelare nel capitolo 5." },
  remove: { characters: ["Guardiano"] }, timelineAdd: ["Alba: Mara trova la lettera."], currentState: "Mara ha la lettera, Elio sospetta.",
});
const SUMMARY = JSON.stringify({ chapterSummary: "Mara arriva sull'isola e trova la lettera.", bookSummary: "Una donna cerca la verità sul padre." });
const IMPACT = JSON.stringify({ rationale: "L'istruzione cambia l'ora in cui Mara trova la lettera.", affectedSceneIds: ["scene:001:002", "scene:002:001"] });
const SAMPLES: Array<[string, string, string]> = [
  ["report", TITLE, REPORT], ["judgment", "Direttore editoriale: accettazione o rifiuto motivato dei rilievi", JUDGMENT],
  ["plan", "Piano dei capitoli", PLAN], ["scenes", "Scene del capitolo 1/3: L'arrivo", SCENES],
  ["memory", "Consolidamento del canon", MEMORY], ["summary", "Sinossi del capitolo e del libro 1/2", SUMMARY],
  ["impact", "Analisi d'impatto della correzione", IMPACT],
];
const at = (text: string, marker: string, extra = 0) => text.slice(0, text.indexOf(marker) + marker.length + extra);
const progress = (title: string, text: string, resolve?: (id: string) => string | undefined): LiveProgress =>
  describeLiveProgress({ title, text }, resolve);

describe("cosa sta facendo il modello, letto mentre scrive", () => {
  it.each(SAMPLES)("%s: in qualunque punto sia tagliata la risposta non lancia, e le azioni già comparse non cambiano mai", (shape, title, text) => {
    let previous: LiveProgress["actions"] = [];
    let counters = 0;
    for (let end = 0; end <= text.length; end++) {
      const now = progress(title, text.slice(0, end));
      expect(now.actions.length, `${shape} @${end}`).toBeGreaterThanOrEqual(previous.length);
      previous.forEach((action, index) => expect(now.actions[index], `${shape} @${end} #${index}`).toEqual(action));
      expect(new Set(now.actions.map(action => action.id)).size).toBe(now.actions.length); // stable, unique ids
      const total = now.counters.reduce((sum, counter) => sum + counter.value, 0);
      expect(total).toBeGreaterThanOrEqual(counters);
      previous = now.actions; counters = total;
    }
    const done = progress(title, text);
    expect(done.shape).toBe(shape);
    expect(done.forming).toBeUndefined();
    expect(done.actions.length).toBeGreaterThan(1);
  });

  describe("rapporto di un revisore", () => {
    it("dice quale revisione sta facendo, con parole e non con l'identificativo", () => {
      expect(progress(TITLE, "").headline).toBe("Revisione «Coerenza e causalità» · rapporto 3 di 36");
      expect(describeHeadline("Redazione: readerMystery 12/36")).toBe("Revisione «Lettore di misteri e promesse» · rapporto 12 di 36");
      expect(describeHeadline("Redazione: inventato 1/2")).toBe("Redazione: inventato 1/2");
      expect(describeHeadline("Brainstorming su tre orizzonti")).toBe("Brainstorming su tre orizzonti");
    });
    it("mentre scrive l'esito non ha ancora fatto nulla e lo dice", () => {
      const now = progress(TITLE, '{"verdict":"iss');
      expect(now).toMatchObject({ shape: "report", actions: [] });
      expect(now.forming?.label).toBe("Sta decidendo l'esito");
    });
    it("l'esito e la sintesi diventano azioni appena sono completi", () => {
      const now = progress(TITLE, at(REPORT, '"verdict":"issues","summary":"Due problemi: un'));
      expect(now.actions.map(action => action.id)).toEqual(["verdict"]);
      expect(now.forming?.label).toBe("Sta scrivendo la sintesi del rapporto");
      expect(now.forming?.excerpt).toBe("Due problemi: un");
      const after = progress(TITLE, at(REPORT, 'mattino."'));
      expect(after.actions.map(action => action.id)).toEqual(["verdict", "summary"]);
      expect(after.actions[1]).toMatchObject({ title: "Sintesi del revisore", detail: expect.stringContaining("immagine abusata") });
    });
    it("un rilievo si vede mentre lo scrive e diventa una scheda quando è completo", () => {
      const writing = progress(TITLE, at(REPORT, '"reason":"Immagine abu'));
      expect(writing.actions.map(action => action.id)).toEqual(["verdict", "summary"]);
      expect(writing.forming).toMatchObject({ label: "Sta scrivendo il rilievo 1 · motivo", excerpt: "Immagine abu", badge: "Minore", tone: "minor" });

      const complete = progress(TITLE, at(REPORT, '"remediation":"Variare l\'immagine."}'));
      const finding = complete.actions.find(action => action.id === "finding-0")!;
      expect(finding).toMatchObject({ tone: "minor", badge: "Minore", title: "Cliché", detail: "Immagine abusata nel genere.", meta: ["capitolo 1 · scena 2"] });
      expect(complete.forming?.label).toBe("Sta cercando altri problemi…");
      expect(complete.counters).toEqual([{ label: "Rilievo", value: 1 }]);
    });
    it("a rapporto finito conta i rilievi per gravità e chiude con la nota di memoria", () => {
      const done = progress(TITLE, REPORT);
      expect(done.actions.map(action => action.id)).toEqual(
        ["verdict", "summary", "finding-0", "finding-1", "finding-2", "memory-note"]);
      expect(done.counters).toEqual([{ label: "Rilievi", value: 3 }, { label: "critici", value: 1 }, { label: "maggiori", value: 1 }]);
      expect(done.actions[3]).toMatchObject({ tone: "critical", badge: "Critico" });
      expect(done.actions.at(-1)).toMatchObject({ title: "Nota per i prossimi segmenti" });
    });
    it("un rapporto senza problemi lo dice", () => {
      const done = progress(TITLE, '{"verdict":"pass","summary":"Nessun problema evidente.","findings":[],"memoryNote":""}');
      expect(done.actions.map(action => action.title)).toEqual(["Esito: nessun problema trovato", "Sintesi del revisore"]);
      expect(done.counters).toEqual([]);
    });
    it("mostra il titolo della scena se il libro lo conosce", () => {
      const done = progress(TITLE, REPORT, id => id === "scene:001:003" ? "La lettera nel cassetto" : undefined);
      expect(done.actions.find(action => action.id === "finding-1")?.meta).toEqual(["capitolo 1 · scena 3 «La lettera nel cassetto»"]);
      expect(describeSceneRef("scene:010:002")).toBe("capitolo 10 · scena 2");
      expect(describeSceneRef("id-strano-non-standard")).toBe("id-strano-non-standard");
    });
    it("tollera una frase prima del JSON e il blocco di codice", () => {
      const done = progress(TITLE, "Ecco il rapporto:\n```json\n" + REPORT + "\n```");
      expect(done.shape).toBe("report");
      expect(done.actions).toHaveLength(6);
    });
  });

  describe("giudizio del direttore", () => {
    it("ogni decisione è una scheda: accetta o respinge, con il perché", () => {
      const done = progress("Direttore editoriale: accettazione o rifiuto motivato dei rilievi", JUDGMENT);
      expect(done.actions[1]).toMatchObject({ tone: "accept", badge: "Accettato", title: "Accetta il rilievo r1:continuity:0",
        detail: expect.stringContaining("contraddizione è reale"), meta: ["Correzione: Spostare l'ora all'alba."] });
      expect(done.actions[2]).toMatchObject({ tone: "reject", badge: "Respinto", title: "Respinge il rilievo r1:style:1" });
      expect(done.actions[2]!.meta).toBeUndefined();
      expect(done.counters).toEqual([{ label: "accettato", value: 1 }, { label: "respinto", value: 1 }]);
    });
    it("mentre decide dice su quale rilievo sta lavorando", () => {
      const now = progress("Direttore editoriale: accettazione o rifiuto motivato dei rilievi", at(JUDGMENT, '"action":"reject","rationale":"È una sc'));
      expect(now.forming).toMatchObject({ label: "Sta decidendo sul rilievo 2 · motivazione", excerpt: "È una sc" });
      expect(now.actions.map(action => action.id)).toEqual(["reasoning", "decision-0"]);
    });
  });

  describe("piano, memoria e riassunti", () => {
    it("piano dei capitoli: un capitolo diventa scheda quando è completo, con il numero di scene", () => {
      const mid = progress("Piano dei capitoli", at(PLAN, '"objective":"Scoprire la lettera."}'));
      expect(mid.actions).toEqual([]);
      expect(mid.forming?.label).toBe("Sta pianificando il capitolo 1");
      const done = progress("Piano dei capitoli", PLAN);
      expect(done.actions[0]).toMatchObject({ title: "Capitolo 1: L'arrivo", meta: ["2 scene"], detail: expect.stringContaining("trova la casa vuota") });
      expect(done.counters).toEqual([{ label: "capitoli", value: 2 }, { label: "scene", value: 3 }]);
    });
    it("scene di un capitolo", () => {
      const done = progress("Scene del capitolo 1/3: L'arrivo", SCENES);
      expect(done.actions.map(action => action.title)).toEqual(["Scena 1: Il porto", "Scena 2: Il faro"]);
      expect(progress("x", at(SCENES, '"title":"Il fa')).forming).toMatchObject({ label: "Sta pianificando la scena 2 · titolo", excerpt: "Il fa" });
    });
    it("memoria: ogni voce aggiornata e ogni evento è un'azione", () => {
      const done = progress("Consolidamento del canon", MEMORY);
      const titles = done.actions.map(action => action.title);
      expect(titles).toEqual(expect.arrayContaining([
        "Riassunto della scena", "Personaggio aggiornato: Mara", "Personaggio aggiornato: Elio", "Luogo aggiornato: Faro",
        "Oggetto aggiornato: Lettera", "Segreto aggiornato: lettera-contenuto", "Evento in cronologia", "Stato attuale della storia",
        "Voci rimosse dalla memoria: 1"]));
      expect(done.counters).toEqual([{ label: "voci aggiornate", value: 5 }, { label: "evento", value: 1 }]);
      expect(progress("x", at(MEMORY, '"Elio":"Sospe')).forming).toMatchObject({ label: "Sta aggiornando personaggio: Elio", excerpt: "Sospe" });
    });
    it("sinossi e analisi d'impatto", () => {
      expect(progress("s", SUMMARY).actions.map(action => action.title)).toEqual(["Sinossi del capitolo", "Sinossi del libro"]);
      expect(progress("s", at(SUMMARY, '"bookSummary":"Una don')).forming?.label).toBe("Sta scrivendo la sinossi del libro");
      const impact = progress("i", IMPACT, id => id === "scene:002:001" ? "Il cassetto" : undefined);
      expect(impact.actions.map(action => action.title)).toEqual(["Motivazione", "Scena da rivedere: capitolo 1 · scena 2", "Scena da rivedere: capitolo 2 · scena 1 «Il cassetto»"]);
    });
    it("una struttura non riconosciuta non mostra schede (potrebbero cambiare): solo che sta scrivendo", () => {
      const now = progress("Altro", '{"foo":"valore","bar":{"x":1},"baz":"in cor');
      expect(now).toMatchObject({ shape: "structured", actions: [], counters: [] });
      expect(now.forming).toMatchObject({ label: "Sta scrivendo la risposta…", excerpt: "in cor" });
    });
    it("ogni tipo di risposta è riconosciuto già dalla sua prima chiave", () => {
      for (const [shape, title, text] of SAMPLES) {
        const first = text.slice(0, text.indexOf(":") + 1) + " ";
        const opening = progress(title === TITLE ? "Altro" : "Altro", first + '"x');
        expect(opening.shape, `${shape}: ${first}`).toBe(shape === "scenes" ? "scenes" : shape);
      }
    });
  });

  describe("testo libero", () => {
    it("conta parole e paragrafi e riconosce le sezioni solo a riga finita", () => {
      const text = "## Idee a lungo termine\n\nUn arco di tre anni.\n\n**Idee a medio termine**\n\nSviluppo dei capitoli.\n\nBREVE-TERMINE";
      const now = progress("Brainstorming su tre orizzonti", text);
      expect(now.shape).toBe("text");
      expect(now.actions.map(action => action.title)).toEqual(["Sezione: Idee a lungo termine", "Sezione: Idee a medio termine"]);
      expect(progress("b", text + "\n").actions.at(-1)?.title).toBe("Sezione: BREVE-TERMINE");
      expect(now.counters).toEqual([{ label: "parole", value: 18 }, { label: "paragrafi", value: 5 }]);
    });
    it("la prosa senza titoli mostra solo i contatori", () => {
      const now = progress("Scrittura: Il traghetto", "Mara guardò il mare.\n\nIl vento portava sale e fumo.");
      expect(now).toMatchObject({ shape: "text", actions: [] });
      expect(now.forming).toBeUndefined();
      expect(now.counters[0]).toEqual({ label: "parole", value: 10 });
    });
    it("nessun testo: solo l'intestazione", () => {
      expect(progress("Validazione delle idee", "  \n ")).toEqual({ shape: "none", headline: "Validazione delle idee", actions: [], counters: [] });
    });
  });

  it("non modifica né conserva nulla: la stessa risposta dà sempre lo stesso risultato", () => {
    expect(progress(TITLE, REPORT)).toEqual(progress(TITLE, REPORT));
    expect(JSON.stringify(progress(TITLE, REPORT))).not.toContain("remediation\":\"Variare");
  });
  it("tiene breve ogni testo mostrato", () => {
    const long = "parola ".repeat(500);
    const done = progress(TITLE, JSON.stringify({ verdict: "issues", summary: long, findings: [{ sceneId: "scene:001:001", category: "C".repeat(300), severity: "minor", evidence: long, reason: long, remediation: long }], memoryNote: "" }));
    for (const action of done.actions) {
      expect(action.title.length).toBeLessThanOrEqual(80);
      expect(action.detail?.length ?? 0).toBeLessThanOrEqual(200);
    }
  });
});
