import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_SETTINGS, TASK_KINDS, newBook } from "./types";
import { explainAutopilotError } from "./autopilot-error";
import { missingModelRoutes } from "./model-routes";
import { correctiveRetryNote, ReplyRejectedError } from "../application/reply-rejected";

describe("Spiegazioni degli errori e route effettive", () => {
  it("spiega la remediation con ancora obsoleta senza dichiararla rimediabile con un retry cieco",()=>{
    const help=explainAutopilotError("Remediation non autorizzata: prova narrativa legacy, manomessa o non più presente nel segmento.");
    expect(help.meaning).toContain("non coincide più");
    expect(help.action).toContain("nuova review");
    expect(help.retryMayHelp).toBe(false);
  });
  it("spiega lo scarto di una prova letterale senza affermare che sia un problema di rete", () => {
    const help = explainAutopilotError("Prova narrativa non presente letteralmente nel segmento esaminato.");
    expect(help.meaning).toContain("rapporto è stato scartato");
    expect(help.action).toContain("citazione esatta");
    expect(help.retryMayHelp).toBe(true);
  });
  it.each(["HTTP 401", "HTTP 403", "budget esaurito", "lease non confermato", "contesto troppo lungo"])(
    "%s non viene presentato come riparabile riprovando alla cieca", message => {
      expect(explainAutopilotError(message).retryMayHelp).toBe(false);
    });
  it("spiega i blocchi troppo lunghi, le compattazioni ripetute e il limite finito nel ragionamento", () => {
    const block = explainAutopilotError("Vincoli troppo lungo per la redazione (10500 caratteri, massimo 9000): non viene troncato.");
    expect(block.meaning).toContain("non c'entra");
    expect(block.action).toContain("Accorcia");
    const loop = explainAutopilotError("La memoria è stata compattata 4 volte di seguito ma il passo successivo la trova ancora troppo grande.");
    expect(loop.action).toContain("Mondo → Memoria");
    const reasoning = explainAutopilotError("Il modello ha esaurito il limite di output o di contesto mentre ragionava, prima di scrivere la risposta.");
    expect(reasoning.action).toContain("thinking");
    expect([block, loop, reasoning].every(help => help.retryMayHelp === false)).toBe(true);
  });
  it("gli errori Zod e JSON non espongono dati o blocchi tecnici", () => {
    const result = z.object({ confidential: z.string() }).safeParse({ confidential: { secret: "private manuscript" } });
    if (result.success) throw new Error("Schema doveva fallire");
    const error = new ReplyRejectedError(result.error);
    expect(error.message).toContain("formato richiesto");
    expect(error.message).not.toContain("confidential");
    expect(error.message).not.toContain("private manuscript");
    expect(new ReplyRejectedError(new SyntaxError("untrusted provider content")).message).not.toContain("untrusted");
    expect(new ReplyRejectedError(new Error("Prova narrativa mancante")).message).toBe("Prova narrativa mancante");
  });
  it("dice al retry correttivo quale limite è stato violato, senza percorso né testo della risposta", () => {
    const schema = z.object({ characters: z.record(z.string(), z.string().max(900)), when: z.string().max(80).optional(),
      verdict: z.enum(["pass", "issues"]), summary: z.string(), mode: z.literal("delta") })
      .refine(value => value.verdict !== "pass", "Esito e rilievi incongruenti.");
    const reason = (value: unknown) => {
      const result = schema.safeParse(value);
      if (result.success) throw new Error("Schema doveva fallire");
      return new ReplyRejectedError(result.error).message;
    };
    const long = reason({ characters: { "Mara Segreta": "x".repeat(901) }, verdict: "issues", summary: "s", mode: "delta" });
    expect(long).toContain("un testo supera il limite di 900 caratteri");
    expect(long).not.toContain("Mara Segreta");
    expect(reason({ characters: {}, verdict: "issues", mode: "delta" })).toContain("manca un campo obbligatorio (atteso: testo)");
    expect(reason({ characters: {}, verdict: "forse", summary: "s", mode: "delta" })).toContain("valore non ammesso");
    expect(reason({ characters: {}, verdict: "pass", summary: "s", mode: "delta" })).toContain("Esito e rilievi incongruenti");
  });
  it("la correzione conserva soltanto un motivo bounded, come dato", () => {
    const note = correctiveRetryNote("x".repeat(800));
    expect(note).toContain(JSON.stringify("x".repeat(500)));
    expect(note).not.toContain("x".repeat(501));
    expect(note).toContain("senza parafrasi");
  });
  it("nessun falso avviso se i task hanno modelli, anche senza default globale", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const book = newBook("Idea", "Libro", "", "");
    settings.defaultRoute.modelId = "";
    for (const task of TASK_KINDS) settings.taskRoutes[task] = { endpointId: settings.endpoints[0]!.id, modelId: "configured" };
    expect(missingModelRoutes(settings, book)).toEqual([]);
    delete settings.taskRoutes.chapterReaders;
    expect(missingModelRoutes(settings, book)).toEqual(["chapterReaders"]);
    book.modelRoutes = { chapterReaders: { endpointId: settings.endpoints[0]!.id, modelId: "book override" } };
    expect(missingModelRoutes(settings, book)).toEqual([]);
    book.modelRoutes.chapterReaders!.endpointId = "missing-endpoint";
    expect(missingModelRoutes(settings, book)).toEqual(["chapterReaders"]);
  });
});
