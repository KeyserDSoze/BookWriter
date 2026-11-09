import { useState } from "react";
import { ShieldAlert, Wallet } from "lucide-react";
import type { Activity, AiPriceRate, AppSettings, BookProject, ModelRoute } from "../domain/types";
import { accountBookAiBudget, DEFAULT_MAX_OUTPUT_TOKENS, isBudgetValid, isPriceRate } from "../domain/ai-budget";
import { getBook, saveBook } from "../infrastructure/db";
import { Button } from "./ui/button";

const money = (value: number) => new Intl.NumberFormat("it-IT", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4,
}).format(value);
function uniqueRoutes(book: BookProject, settings: AppSettings): ModelRoute[] {
  const routes = [settings.defaultRoute, ...Object.values(settings.taskRoutes),
    ...Object.values(book.modelRoutes ?? {})].filter((x): x is ModelRoute =>
      !!x && !!x.endpointId && !!x.modelId.trim());
  return Array.from(new Map(routes.map(x => [JSON.stringify([x.endpointId, x.modelId]), x])).values());
}
export function AiBudgetPanel({
  book, settings, activities, onSaveSettings, onRefresh,
}: {
  book: BookProject; settings: AppSettings; activities: Activity[];
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [limit, setLimit] = useState(String(book.aiBudget?.limitEur ?? 5));
  const [outputMax, setOutputMax] = useState(String(book.aiBudget?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS));
  const [enabled, setEnabled] = useState(book.aiBudget?.enabled ?? false);
  const routes = uniqueRoutes(book, settings);
  const [selected, setSelected] = useState(JSON.stringify([
    routes[0]?.endpointId ?? "", routes[0]?.modelId ?? "",
  ]));
  // Settings load after books on startup; use the first actual route until
  // the author makes a selection, instead of retaining an empty initial key.
  const selectedRoute = routes.find(x => JSON.stringify([x.endpointId, x.modelId]) === selected)
    ?? routes[0];
  const selectedValue = selectedRoute ? JSON.stringify([selectedRoute.endpointId, selectedRoute.modelId]) : "";
  const savedRate = (settings.aiPriceRates ?? []).find(x =>
    x.endpointId === selectedRoute?.endpointId && x.modelId === selectedRoute?.modelId);
  const [draftInput, setDraftInput] = useState("");
  const [draftOutput, setDraftOutput] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const snapshot = book.aiBudget?.enabled
    ? accountBookAiBudget(activities, settings, book.aiBudget) : undefined;
  const rateIn = editingPrice ? draftInput : String(savedRate?.inputEurPerMillion ?? "");
  const rateOut = editingPrice ? draftOutput : String(savedRate?.outputEurPerMillion ?? "");

  async function saveRate() {
    if (!selectedRoute || !rateIn.trim() || !rateOut.trim()) {
      setMessage("Seleziona un modello e inserisci entrambe le tariffe."); return;
    }
    const rate: AiPriceRate = {
      ...selectedRoute,
      inputEurPerMillion: Number(rateIn), outputEurPerMillion: Number(rateOut),
    };
    if (!isPriceRate(rate)) { setMessage("Tariffe non valide: usa importi non negativi e finiti."); return; }
    setBusy(true);
    try {
      await onSaveSettings({
        ...settings, aiPriceRates: [
          ...(settings.aiPriceRates ?? []).filter(x =>
            x.endpointId !== rate.endpointId || x.modelId !== rate.modelId),
          rate,
        ],
      });
      setEditingPrice(false);
      setMessage("Tariffa salvata localmente. Verifica gli importi sul portale del provider.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Salvataggio tariffa non riuscito."); }
    finally { setBusy(false); }
  }

  async function saveBudget() {
    const requested = {
      enabled, limitEur: Number(limit), maxOutputTokens: Number(outputMax),
      // A fresh opt-in starts a new accounting period; increasing a limit does not.
      enabledAt: book.aiBudget?.enabled && enabled
        ? book.aiBudget.enabledAt : new Date().toISOString(),
    };
    if (!isBudgetValid(requested)) {
      setMessage("Limite non valido: 0–100.000 € e massimo output tra 256 e 32.768 token."); return;
    }
    setBusy(true);
    try {
      const latest = await getBook(book.id);
      if (!latest || latest.status === "running")
        throw new Error("Metti in pausa l'autopilot prima di modificare il budget.");
      if (latest.updatedAt !== book.updatedAt)
        throw new Error("Il libro è cambiato: aggiorna la schermata prima di salvare il budget.");
      latest.aiBudget = requested;
      await saveBook(latest, false);
      await onRefresh();
      setMessage(enabled
        ? "Budget stimato attivo. Le nuove chiamate richiedono prezzi configurati e usage completo."
        : "Protezione di budget disattivata per questo libro.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Salvataggio budget non riuscito."); }
    finally { setBusy(false); }
  }

  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Budget AI">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet size={19}/> Budget AI del libro</h2>
    <p className="muted mt-1 text-xs">
      Protezione facoltativa: tariffe inserite da te, nessuna lettura automatica del saldo provider.
      È una <b>soglia preventiva stimata</b>, non una garanzia contrattuale sul costo finale.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-semibold">Soglia per il periodo (€)
        <input aria-label="Soglia budget in euro" className="field mt-1" type="number" min="0.01" max="100000"
          step="0.01" value={limit} onChange={e => setLimit(e.target.value)}/>
      </label>
      <label className="block text-sm font-semibold">Massimo output richiesto alla AI (token)
        <input aria-label="Massimo output token" className="field mt-1" type="number"
          min="256" max="32768" step="1" value={outputMax} onChange={e => setOutputMax(e.target.value)}/>
      </label>
    </div>
    <label className="mt-3 flex items-start gap-2 text-sm">
      <input aria-label="Attiva limite stimato" className="mt-1" type="checkbox"
        checked={enabled} onChange={e => setEnabled(e.target.checked)}/>
      Attiva blocco preventivo per le prossime richieste AI di questo libro
    </label>
    <Button size="sm" variant="outline" disabled={busy || book.status === "running"}
      onClick={() => void saveBudget()}>Salva budget del libro</Button>
    {book.aiBudget?.enabled && snapshot && <div className="mt-3 space-y-1 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
      <p><b>Spesa stimata da usage noto:</b> {money(snapshot.estimatedSpentEur)}</p>
      <p><b>Soglia configurata:</b> {money(book.aiBudget.limitEur)}</p>
      <p className="muted text-xs">
        Dal {new Date(book.aiBudget.enabledAt).toLocaleString("it-IT")} ·
        {snapshot.countedCalls} richieste · {snapshot.incompleteCount} senza usage completo ·
        {snapshot.unpricedCount} senza tariffa.
      </p>
      {snapshot.legacyPricedCount > 0 && <p role="note" className="text-xs text-amber-700 dark:text-amber-300">
        {snapshot.legacyPricedCount} chiamate precedenti senza tariffa storicizzata:
        stima ricalcolata con il listino corrente. Le nuove chiamate conservano
        la tariffa valida al momento della richiesta.
      </p>}
    </div>}
    <div className="mt-4 space-y-2 border-t border-slate-300 pt-3 dark:border-slate-700">
      <h3 className="text-sm font-semibold">Tariffe configurate dall'autore (€/milione di token)</h3>
      <p className="muted text-xs">Ogni modello e provider necessita di una tariffa input e output; non vengono precompilate tariffe commerciali. Cambiare il prezzo vale solo per le nuove richieste che salvano la tariffa al momento del tentativo.</p>
      {routes.length ? <>
        <label className="block text-sm">Modello / endpoint
          <select className="field mt-1" aria-label="Modello per tariffa"
            value={selectedValue} onChange={e => { setSelected(e.target.value); setEditingPrice(false); }}>
            {routes.map(r => <option key={JSON.stringify([r.endpointId,r.modelId])}
              value={JSON.stringify([r.endpointId,r.modelId])}>{r.modelId} · {r.endpointId}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">Prezzo input €/milione
            <input className="field mt-1" aria-label="Prezzo input per milione" type="number"
              min="0" step="0.0001" value={rateIn}
              onChange={e => { if (!editingPrice) {setDraftOutput(rateOut);setEditingPrice(true);} setDraftInput(e.target.value); }}/>
          </label>
          <label className="block text-sm">Prezzo output €/milione
            <input className="field mt-1" aria-label="Prezzo output per milione" type="number"
              min="0" step="0.0001" value={rateOut}
              onChange={e => { if (!editingPrice) {setDraftInput(rateIn);setEditingPrice(true);} setDraftOutput(e.target.value); }}/>
          </label>
        </div>
        <Button size="sm" disabled={busy} variant="outline" onClick={() => void saveRate()}>Salva tariffa del modello</Button>
      </> : <p className="muted text-sm">Configura prima un modello in Impostazioni → Router dei modelli.</p>}
    </div>
    {(snapshot && (snapshot.incompleteCount > 0 || snapshot.unpricedCount > 0)) &&
      <p role="alert" className="mt-3 flex gap-2 text-sm text-amber-700 dark:text-amber-300">
        <ShieldAlert size={17} className="shrink-0"/>
        Consumi incerti: l'autopilot si fermerà per sicurezza prima delle nuove chiamate.
      </p>}
    <p className="muted mt-3 text-xs">
      Il modello potrebbe ignorare max_tokens e un provider potrebbe addebitare chiamate senza usage.
      Il browser non conosce il credito reale: verifica sempre fatture e tariffe sul portale del provider.
      Il budget si applica alle chiamate successive all'attivazione, non a quelle precedenti.
    </p>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
