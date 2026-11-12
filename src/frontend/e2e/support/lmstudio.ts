import { expect, test as base, type Page } from "@playwright/test";

/**
 * Test "live": usano un LM Studio reale invece dei mock.
 *  - LMSTUDIO_MODEL     ID del modello (attiva i test live; senza, il progetto live non esiste)
 *  - LMSTUDIO_BASE_URL  base URL OpenAI-compatible (default http://localhost:1234/v1)
 *  - LMSTUDIO_TASK_TIMEOUT_MS  attesa massima per un task del modello (default 600000)
 *  - LMSTUDIO_REQUIRED=1  se LM Studio non è pronto il test FALLISCE invece di essere saltato
 */
export type LmStudioTarget = { baseUrl: string; model: string; taskTimeoutMs: number };
type Probe = { ok: true; target: LmStudioTarget } | { ok: false; reason: string };

function readTarget(): LmStudioTarget | string {
  const model = process.env.LMSTUDIO_MODEL?.trim();
  if (!model) return "LMSTUDIO_MODEL non impostata: test live disattivati.";
  const baseUrl = (process.env.LMSTUDIO_BASE_URL?.trim() || "http://localhost:1234/v1").replace(/\/$/, "");
  let url: URL;
  try { url = new URL(baseUrl); } catch { return `LMSTUDIO_BASE_URL non valido: ${baseUrl}`; }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname))
    return "LMSTUDIO_BASE_URL deve essere http://localhost o http://127.0.0.1 (l'app accetta solo loopback senza API key).";
  const taskTimeoutMs = Number(process.env.LMSTUDIO_TASK_TIMEOUT_MS) || 600_000;
  return { baseUrl, model, taskTimeoutMs };
}

let cached: Promise<Probe> | undefined;
/** Verifica che LM Studio risponda davvero e che il modello sia elencato. */
export function probeLmStudio(): Promise<Probe> {
  cached ??= (async (): Promise<Probe> => {
    const target = readTarget();
    if (typeof target === "string") return { ok: false, reason: target };
    try {
      const response = await fetch(`${target.baseUrl}/models`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return { ok: false, reason: `LM Studio ha risposto HTTP ${response.status} su ${target.baseUrl}/models.` };
      const body = await response.json() as { data?: Array<{ id?: unknown }> };
      const ids = (body.data ?? []).map(entry => String(entry.id));
      if (!ids.includes(target.model))
        return { ok: false, reason: `Il modello «${target.model}» non è elencato da LM Studio (disponibili: ${ids.join(", ") || "nessuno"}).` };
      return { ok: true, target };
    } catch (error) {
      return { ok: false, reason: `LM Studio non raggiungibile su ${target.baseUrl} (${error instanceof Error ? error.message : "errore"}). Avvia il server locale.` };
    }
  })();
  return cached;
}

/** Fixture `lm`: salta (o fallisce con LMSTUDIO_REQUIRED=1) se LM Studio non è pronto. */
export const liveTest = base.extend<{ lm: LmStudioTarget }>({
  lm: async ({}, use, testInfo) => {
    const probe = await probeLmStudio();
    if (!probe.ok) {
      if (process.env.LMSTUDIO_REQUIRED === "1") throw new Error(probe.reason);
      testInfo.skip(true, probe.reason);
      return;
    }
    await use(probe.target);
  },
});
export { expect };

export function navigation(page: Page, projectName: string) {
  return page.getByRole("navigation", {
    name: projectName === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
}

/** Configura l'endpoint reale: nessuna chiave, streaming SSE e ispezione per vedere il testo in tempo reale. */
export async function configureLmStudio(page: Page, lm: LmStudioTarget, projectName: string,
  options: { streamTimeoutSeconds?: number } = {}): Promise<void> {
  const nav = navigation(page, projectName);
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("textbox", { name: "Base URL" }).fill(lm.baseUrl);
  await page.getByRole("combobox", { name: "Autenticazione AI" }).selectOption("none");
  await page.getByRole("button", { name: "Leggi /models" }).click();
  await expect(page.getByText(/Trovati \d+ modelli/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Modelli rilevati / manuali" })).toHaveValue(new RegExp(escapeRegExp(lm.model)));
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill(lm.model);
  await page.getByRole("combobox", { name: "Streaming Chat Completions" }).selectOption("sse");
  if (options.streamTimeoutSeconds)
    await page.getByRole("spinbutton", { name: "Tempo massimo senza dati dallo streaming (secondi)" }).fill(String(options.streamTimeoutSeconds));
  await page.getByRole("checkbox", { name: /Ispezione locale richieste AI/ }).check();
  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await nav.getByRole("button", { name: "Dashboard" }).click();
}

function escapeRegExp(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export type StoredAi = {
  status: string; phase: string; previousError?: string;
  interventions: Array<{ scope: string; instruction: string; appliedAt?: string }>;
  activities: Array<{ title: string; status: string; aiRequested?: boolean; output?: string; error?: string;
    inputTokens?: number; outputTokens?: number; appliedInterventionIds?: string[] }>;
};
export function readStored(page: Page): Promise<StoredAi> {
  return page.evaluate(() => new Promise<StoredAi>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "activities"], "readonly");
      const books = tx.objectStore("books").getAll();
      const activities = tx.objectStore("activities").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        const book = books.result[0] as { status: string; phase: string; previousError?: string;
          authorInterventions?: StoredAi["interventions"] };
        resolve({ status: book.status, phase: book.phase, previousError: book.previousError,
          interventions: book.authorInterventions ?? [],
          activities: activities.result as StoredAi["activities"] });
        db.close();
      };
    };
  }));
}

/** Registra i POST reali verso LM Studio senza alterarli (solo osservazione). */
export function captureChatRequests(page: Page): Array<{ url: string; stream?: unknown; userPrompt: string }> {
  const seen: Array<{ url: string; stream?: unknown; userPrompt: string }> = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !/\/(v1\/chat\/completions|api\/v1\/chat)$/.test(request.url())) return;
    const body = JSON.parse(request.postData() ?? "{}") as { stream?: unknown; messages?: Array<{ role: string; content: string }> };
    seen.push({ url: request.url(), stream: body.stream,
      userPrompt: body.messages?.find(message => message.role === "user")?.content ?? "" });
  });
  return seen;
}
