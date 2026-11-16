import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import type { Activity } from "./types";
import { buildDebugReport, redactSecrets } from "./debug-report";

const activity = (patch: Partial<Activity>): Activity => ({ id: crypto.randomUUID(), bookId: "b", runId: "r", phase: "prose", title: "Scrittura scena", reason: "Scrivere la scena.",
  nextStep: "Revisione", status: "succeeded", createdAt: "2026-11-15T10:00:00.000Z", endedAt: "2026-11-15T10:00:05.000Z", ...patch });
const options = { version: "9.9.9", now: "2026-11-15T12:00:00.000Z" };

describe("Prompt di debug", () => {
  it("riassume stato, ultimo errore e task falliti senza testo del libro né segreti", () => {
    const book = knowledgeBook();
    book.status = "error";
    book.previousError = "Risposta non valida: formato richiesto non rispettato. Authorization: Bearer sk-abcdefghijklmnop1234";
    const rows = [
      activity({ bookId: book.id, title: "Redazione capitolo 2", status: "failed", createdAt: "2026-11-15T11:00:00.000Z", endedAt: "2026-11-15T11:00:09.000Z",
        endpointId: "openai", modelId: "m1", inputTokens: 100, outputTokens: 20, aiRequested: true,
        error: "HTTP 401 su https://api.example.com/v1/chat?api_key=SEGRETO123", output: "TESTO PRIVATO DELLA SCENA" }),
      activity({ bookId: book.id, title: "Scrittura scena", createdAt: "2026-11-15T10:00:00.000Z" }),
      activity({ bookId: "altro", title: "Di un altro libro", status: "failed", error: "non mio" }),
    ];
    const report = buildDebugReport(book, rows, options);
    expect(report).toContain("# Debug di BookWriter 9.9.9");
    expect(report).toContain(`(${book.id})`);
    expect(report).toContain("Redazione capitolo 2");
    expect(report).toContain("FAILED");
    expect(report).toContain("openai/m1");
    expect(report).toContain("token 100 in / 20 out");
    expect(report).toContain("Spiegazione dell'app");
    expect(report).toContain("api_key=[redatto]");
    expect(report).toContain("Bearer [redatto]");
    expect(report).not.toContain("SEGRETO123");
    expect(report).not.toContain("sk-abcdefghijklmnop1234");
    expect(report).not.toContain("TESTO PRIVATO");
    expect(report).not.toContain("Di un altro libro");
    expect(report).not.toContain(book.chapters[0]!.scenes[0]!.text);
  });
  it("per un HTTP 400 mostra dimensione del prompt, impostazioni dell'endpoint e la nota sul log del server", () => {
    const book = knowledgeBook();
    const failed = activity({ bookId: book.id, title: "Direttore editoriale", status: "failed", aiRequested: true, endpointId: "e1", modelId: "m",
      requestedReasoningEffort: "high", error: "Errore del provider AI (HTTP 400). Verifica disponibilità e configurazione." });
    const report = buildDebugReport(book, [failed], { ...options, promptSizes: { [failed.id]: { chars: 340000, truncated: true } },
      endpoints: [{ id: "e1", name: "LM", baseUrl: "http://localhost:1234/v1", authMode: "none", models: [] } as never] });
    expect(report).toContain("almeno 340.000 caratteri");
    expect(report).toContain("locale (loopback)");
    expect(report).toContain("senza API key");
    expect(report).toContain("thinking richiesto high");
    expect(report).toContain("Developer");
    expect(report).not.toContain("localhost:1234");
  });
  it("senza errori lo dice e limita le liste", () => {
    const book = knowledgeBook();
    const rows = Array.from({ length: 20 }, (_, i) => activity({ bookId: book.id, title: "Task " + i, createdAt: `2026-11-15T10:${String(i).padStart(2, "0")}:00.000Z` }));
    const report = buildDebugReport(book, rows, { ...options, maxRecent: 3 });
    expect(report).toContain("Nessun errore segnalato dal libro");
    expect(report).toContain("Nessun task fallito o interrotto");
    expect(report.match(/^- 2026-11-15T10:/gm)).toHaveLength(3);
  });
  it("redige chiavi di vari fornitori e token GitHub", () => {
    const text = redactSecrets("ghp_abcdefghijklmnopqrstuvwx github_pat_abcdefghijklmnopqrstuv AIzaSyabcdefghijklmnopqrstuv sk-proj_abcdefghij");
    expect(text).not.toMatch(/ghp_|github_pat_|AIza|sk-proj/);
  });
});
