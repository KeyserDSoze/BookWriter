import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { isAutoRetryable } from "./auto-retry";
import { PromptExceedsContextError } from "./context-guard";
import { ReplyRejectedError } from "./reply-rejected";
import { ProviderHeaderTimeoutError } from "../infrastructure/ai-header-timeout";
import { ProviderResponseReadError } from "../infrastructure/ai-completion-response";
import { EmptyProviderContentError, EmptyToolCallError, MalformedProviderContentError, TruncatedProviderContentError } from "../infrastructure/ai-provider-error";
import { AiBudgetStop } from "../domain/ai-budget";
import { BookRevisionConflict } from "../core/errors";
import { RemoteWriterLost } from "../infrastructure/github-lease";

const named = (name: string, message = "Errore sintetico") => Object.assign(new Error(message), { name });

describe("classificazione fail-closed dei retry automatici", () => {
  it.each([
    ["trasporto", new Error("Impossibile contattare l'endpoint AI. Controlla rete, URL e CORS.")],
    ["HTTP 408", new Error("Timeout dal provider (HTTP 408).")],
    ["HTTP 429", new Error("Limite richieste o credito insufficiente (HTTP 429).")],
    ["HTTP 503", new Error("Errore del provider AI (HTTP 503). Verifica disponibilità e configurazione.")],
    ["header scaduti", new ProviderHeaderTimeoutError()],
    ["JSON illeggibile", new ProviderResponseReadError("Il provider AI non ha restituito JSON valido.")],
    ["connessione persa", new ProviderResponseReadError("Connessione con il provider interrotta durante lo streaming AI.")],
    ["risposta vuota", new EmptyProviderContentError("openai", "m")],
    ["reasoning senza risposta", new EmptyProviderContentError("openai", "m", undefined, true)],
    ["funzione chiamata con {}", new EmptyToolCallError("openai", "m")],
    ["contenuto malformato", new MalformedProviderContentError("openai", "m")],
    ["risposta scartata", new ReplyRejectedError(new ZodError([]))],
  ])("ritenta: %s", (_name, error) => expect(isAutoRetryable(error)).toBe(true));

  it.each([
    ["abort", new DOMException("Interrotto.", "AbortError")],
    ["valore non Error", "HTTP 503"],
    ["prompt oltre il contesto", new PromptExceedsContextError("Prompt troppo grande.")],
    ["risposta troncata", new TruncatedProviderContentError("openai", "m")],
    ["limite finito durante il reasoning", new TruncatedProviderContentError("openai", "m", undefined, true)],
    ["stream oltre il limite", new ProviderResponseReadError("Lo stream AI ha superato il limite di sicurezza di dimensione.")],
    ["reasoning senza testo", new ProviderResponseReadError("Il modello ha esaurito il limite di lunghezza o di contesto prima di scrivere la risposta.")],
    ["HTTP 400", new Error("Errore del provider AI (HTTP 400). Verifica.")],
    ["HTTP 401", new Error("Autenticazione API non valida (HTTP 401): controlla la chiave.")],
    ["HTTP 404", new Error("Endpoint o modello non trovato (HTTP 404).")],
    ["HTTP 422", new Error("Errore del provider AI (HTTP 422). Verifica.")],
    ["modello non scelto", new Error("Seleziona il modello per l'attività brainstorm nelle Impostazioni.")],
    ["chiave mancante", new Error("Chiave API mancante per l'endpoint OpenAI.")],
    ["budget", new AiBudgetStop("Budget esaurito.")],
    ["CAS", new BookRevisionConflict()],
    ["autorità", new RemoteWriterLost("Blocco perso.")],
    ["quota del browser", named("QuotaExceededError")],
    ["transazione IndexedDB", named("TransactionInactiveError")],
    ["DOM generico", new DOMException("Qualcosa è andato storto.", "InvalidStateError")],
    ["fs", Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })],
    ["errore nuovo non classificato", new Error("Qualcosa di imprevisto")],
    ["parola «rete» generica", new Error("rete")],
  ])("non ritenta: %s", (_name, error) => expect(isAutoRetryable(error)).toBe(false));
});
