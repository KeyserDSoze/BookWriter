const PROBE_TIMEOUT_MS = 4_000;

/** After a header timeout on a loopback endpoint, tell the author *why* it is
 * likely stuck: a quick GET /models separates "server busy" from "the browser
 * cannot reach it at all" (server off, CORS, or the browser's local-network permission). */
export async function localEndpointTimeoutHint(baseUrl: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl.replace(/\/$/, "") + "/models", {
      method: "GET", mode: "cors", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
    });
    void response.body?.cancel().catch(() => {});
    if (response.ok)
      return " Il server locale risponde alle altre richieste: è occupato (richieste precedenti ancora in coda, modello in caricamento o prompt molto lungo). Controlla i log di LM Studio e, se serve, alza «Attesa massima header AI» nelle Impostazioni.";
  } catch { /* unreachable: explained below */ }
  finally { clearTimeout(timer); }
  return " Il browser non riesce a raggiungere il server locale: verifica che sia acceso con CORS attivo e, se usi il sito pubblico, consenti a questo sito l'accesso alla rete locale (lucchetto accanto all'indirizzo → Impostazioni sito → Rete locale).";
}
