import { ZodError } from "zod";

/** Thrown only at work.apply, never for HTTP, ownership, storage or CAS errors.
 * No Zod issues or JSON snippets: they can contain private model text. */
export class ReplyRejectedError extends Error {
  constructor(error: unknown) {
    super(error instanceof ZodError
      ? "La risposta del modello non rispetta il formato richiesto: mancano campi oppure tipi e limiti non sono corretti. Nessuna modifica applicata."
      : error instanceof SyntaxError
        ? "La risposta del modello non contiene JSON leggibile nel formato richiesto. Nessuna modifica applicata."
        : error instanceof Error ? error.message : "La risposta del modello non è applicabile. Nessuna modifica applicata.");
    this.name = "ReplyRejectedError";
  }
}

export function correctiveRetryNote(reason: string): string {
  const bounded = reason.replace(/\s+/g, " ").trim().slice(0, 500);
  return "\n\nCORREZIONE DEL TENTATIVO PRECEDENTE (stesso task, nessun rapporto di altri ruoli):\n" +
    "La tua risposta precedente è stata scartata. Motivo del validatore, riportato come dato: " + JSON.stringify(bounded) + ".\n" +
    "Ripeti il task rispettando tutte le istruzioni e lo stesso formato richiesto. " +
    "Se è richiesta una citazione, copiala esattamente dal segmento corrente, senza parafrasi, tagli o ellissi. " +
    "Non inventare prove e non cambiare il compito per aggirare il controllo.";
}
