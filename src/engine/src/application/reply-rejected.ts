import { ZodError } from "zod";

const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: "testo", number: "numero", int: "numero intero", boolean: "vero/falso", array: "lista", object: "oggetto",
};
const amount = (value: unknown) => typeof value === "number" || typeof value === "bigint" ? String(value) : undefined;
/** The broken constraint of the first issue, for the corrective retry: limits and types come from the
 * schema, never the path (record keys can be private names) or any text of the reply. */
function describeIssue(error: ZodError): string | undefined {
  const issue = error.issues[0] as { code?: string; origin?: string; maximum?: unknown; minimum?: unknown;
    expected?: unknown; message?: string } | undefined;
  if (!issue) return undefined;
  const max = amount(issue.maximum), min = amount(issue.minimum);
  const type = typeof issue.expected === "string" ? TYPE_NAMES[issue.expected] : undefined;
  switch (issue.code) {
    case "too_big":
      if (issue.origin === "string" && max) return `un testo supera il limite di ${max} caratteri`;
      if (issue.origin === "array" && max) return `una lista supera il massimo di ${max} elementi`;
      return "un valore supera il massimo consentito";
    case "too_small":
      if (issue.origin === "string") return min === "1" ? "un testo obbligatorio è vuoto" : `un testo è più corto del minimo di ${min ?? "richiesto"} caratteri`;
      if (issue.origin === "array" && min) return `una lista ha meno di ${min} elementi`;
      return "un valore è sotto il minimo consentito";
    case "invalid_type":
      return /received undefined/.test(issue.message ?? "")
        ? "manca un campo obbligatorio" + (type ? ` (atteso: ${type})` : "")
        : "un campo ha il tipo sbagliato" + (type ? ` (atteso: ${type})` : "");
    case "invalid_value": return "un campo ha un valore non ammesso fra quelli indicati";
    case "unrecognized_keys": return "la risposta contiene campi non previsti dal formato";
    // Custom messages are written in the schemas (fixed text, no reply content).
    case "custom": return issue.message && issue.message.length <= 200 ? issue.message.replace(/\.\s*$/, "") : undefined;
    default: return undefined;
  }
}

/** Thrown only at work.apply, never for HTTP, ownership, storage or CAS errors.
 * No Zod paths or JSON snippets: they can contain private model text. */
export class ReplyRejectedError extends Error {
  constructor(error: unknown) {
    const issue = error instanceof ZodError ? describeIssue(error) : undefined;
    super(error instanceof ZodError
      ? issue
        ? `La risposta del modello non rispetta il formato richiesto: ${issue}. Nessuna modifica applicata.`
        : "La risposta del modello non rispetta il formato richiesto: mancano campi oppure tipi e limiti non sono corretti. Nessuna modifica applicata."
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
