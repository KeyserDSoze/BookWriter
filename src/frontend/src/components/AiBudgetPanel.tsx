import { useState } from "react";
import { Wallet } from "lucide-react";
import type { Activity, AppSettings, BookProject, ModelRoute } from "../domain/types";
import { accountBookAiBudget, accountSessionAiBudget, assessAiBudgetHeadroom, DEFAULT_MAX_OUTPUT_TOKENS, isBudgetValid } from "../domain/ai-budget";
import { getBook, saveBook } from "../infrastructure/db";
import { exportAiCostLedgerCsv } from "../infrastructure/ai-ledger-export";
import { isBillableAttempt } from "../domain/ai-budget";
import { AiCostHistoryPanel } from "./AiCostHistoryPanel";
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
  book, settings, activities, onRefresh,
}: {
  book: BookProject; settings: AppSettings; activities: Activity[];
  onRefresh: () => Promise<void>;
}) {
  const [limit, setLimit] = useState(String(book.aiBudget?.limitEur ?? 5));
  const [outputMax, setOutputMax] = useState(String(book.aiBudget?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS));
  const [sessionLimit, setSessionLimit] = useState(String(book.aiBudget?.sessionLimitEur ?? ""));
  const [enabled, setEnabled] = useState(book.aiBudget?.enabled ?? false);
  const routes = uniqueRoutes(book, settings);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const snapshot = book.aiBudget?.enabled
    ? accountBookAiBudget(activities, settings, book.aiBudget) : undefined;
  const sessionBudget = book.aiBudget?.enabled && book.aiBudget.sessionLimitEur !== undefined
    ? book.aiBudget : undefined;
  const recentSession = sessionBudget
    ? activities.filter(a => a.bookId === book.id && isBillableAttempt(a) &&
      Date.parse(a.createdAt) >= Date.parse(sessionBudget.enabledAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]
    : undefined;
  const sessionAccounting = sessionBudget && recentSession?.runId
    ? accountSessionAiBudget(activities, settings, sessionBudget, book.id, recentSession.runId)
    : undefined;
  const bookHeadroom = snapshot && book.aiBudget?.enabled
    ? assessAiBudgetHeadroom(snapshot, book.aiBudget.limitEur) : undefined;
  const sessionHeadroom = sessionBudget && sessionAccounting
    ? assessAiBudgetHeadroom(sessionAccounting, sessionBudget.sessionLimitEur!) : undefined;
  async function saveBudget() {
    const requested = {
      enabled, limitEur: Number(limit), maxOutputTokens: Number(outputMax),
      ...(sessionLimit.trim() ? { sessionLimitEur: Number(sessionLimit) } : {}),
      // A fresh opt-in starts a new accounting period; increasing a limit does not.
      enabledAt: book.aiBudget?.enabled && enabled
        ? book.aiBudget.enabledAt : new Date().toISOString(),
    };
    if (!isBudgetValid(requested)) {
      setMessage("Limiti non validi: soglia libro/sessione 0,01–100.000 €, massimo output 256–32.768 token."); return;
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
    <label className="mt-3 block text-sm font-semibold">Limite aggiuntivo per sessione AI (€), facoltativo
      <input aria-label="Limite sessione AI in euro" className="field mt-1" type="number"
        min="0.01" max="100000" step="0.01" placeholder="Nessun limite per sessione"
        value={sessionLimit} onChange={e => setSessionLimit(e.target.value)}/>
      <span className="muted mt-1 block text-xs font-normal">
        Si applica a ogni Avvia/Riprendi e alle singole bozze AI di fusione; al nuovo
        avvio il limite di sessione riparte, ma il budget globale del libro non si azzera.
        Lascia vuoto per usare soltanto il budget del libro.
      </span>
    </label>
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
      {bookHeadroom?.knownRemainingEur !== undefined &&
        <p><b>Margine stimato noto del libro:</b> {money(bookHeadroom.knownRemainingEur)}
          <span className="muted text-xs"> · Non comprende la riserva per la prossima richiesta né addebiti esterni.</span>
        </p>}
      {bookHeadroom?.status === "vicino" &&
        <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Avviso preventivo libro: almeno l'80% del limite stimato è già utilizzato
          secondo i token noti. Verifica prezzi e margine prima di riprendere.
        </p>}
      {bookHeadroom?.status === "raggiunto" &&
        <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Limite stimato del libro raggiunto: la prossima chiamata sarà bloccata dal preflight.
        </p>}
      {bookHeadroom?.status === "incerto" &&
        <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Consumi incerti del libro: il margine non è affidabile; il preflight bloccherà
          nuove richieste finché l'uso o la tariffa rimangono sconosciuti.
        </p>}
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
    {sessionBudget && <div className="mt-3 space-y-1 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
      <p><b>Limite stimato per sessione:</b> {money(sessionBudget.sessionLimitEur!)}</p>
      {sessionAccounting ? <>
        <p><b>Ultima sessione AI registrata:</b> {money(sessionAccounting.estimatedSpentEur)} di stima nota ·
          {" "}{sessionAccounting.countedCalls} tentativi.</p>
        {sessionHeadroom?.knownRemainingEur !== undefined &&
          <p><b>Margine stimato noto della sessione:</b> {money(sessionHeadroom.knownRemainingEur)}
            <span className="muted text-xs"> · Esclude la riserva della prossima richiesta.</span>
          </p>}
        {sessionHeadroom?.status === "vicino" &&
          <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Avviso preventivo sessione: almeno l'80% del plafond stimato di questa sessione
            è già utilizzato. La prossima richiesta potrebbe non rientrare nel margine.
          </p>}
        {sessionHeadroom?.status === "raggiunto" &&
          <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Limite stimato della sessione raggiunto: il preflight bloccherà le richieste del run.
          </p>}
        {sessionHeadroom?.status === "incerto" &&
          <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Consumi incerti della sessione: impossibile calcolare un margine affidabile
            con usage o tariffa mancanti.
          </p>}
        {sessionAccounting.incompleteCount + sessionAccounting.unpricedCount > 0 &&
          <p role="note" className="text-xs text-amber-700 dark:text-amber-300">
            {sessionAccounting.incompleteCount} tentativi senza usage completo ·
            {" "}{sessionAccounting.unpricedCount} senza tariffa valida. Non sono costi zero.
          </p>}
      </> : <p className="muted text-xs">Nessun tentativo AI nel periodo del libro.</p>}
      <p className="muted text-xs">Sessione = un singolo Avvia/Riprendi (oppure una bozza AI di fusione).
        Non è un tetto garantito alla fattura e non è condiviso tra dispositivi.</p>
    </div>}
    <div className="mt-4 space-y-2 border-t border-slate-300 pt-3 dark:border-slate-700">
      <h3 className="text-sm font-semibold">Esporta il registro dei consumi</h3>
      <p className="muted text-xs">
        CSV locale del solo libro selezionato: token dichiarati, prezzo manuale al tentativo
        (o listino corrente per i record precedenti) e costo stimato se calcolabile.
        La colonna fattura provider resta vuota: BookWriter non conosce gli addebiti reali.
        Non esporta prosa, prompt, chiavi o messaggi di errore.
      </p>
      <Button size="sm" variant="outline"
        disabled={!activities.some(isBillableAttempt)}
        onClick={() => {
          try {
            exportAiCostLedgerCsv(book.id, activities, settings);
            setMessage("CSV del ledger preparato localmente. Confrontalo con le fatture del provider.");
          } catch {
            setMessage("Esportazione del ledger non riuscita. Nessun dato è stato inviato.");
          }
        }}>Esporta ledger CSV</Button>
      <p className="muted text-xs">I costi ignoti non sono zero: lasciare vuota la stima significa che non è calcolabile.</p>
    </div>
    <AiCostHistoryPanel bookId={book.id} activities={activities} settings={settings}/>
    <div className="mt-4 space-y-2 border-t border-slate-300 pt-3 dark:border-slate-700">
      <h3 className="text-sm font-semibold">Tariffe in uso (€/milione di token)</h3>
      <p className="muted text-xs">Le tariffe si impostano per ogni modello nella card dell'endpoint, in Impostazioni.
        Qui sono mostrate in sola lettura; cambiarle vale solo per le nuove richieste.</p>
      {routes.length ? <ul className="space-y-1 text-sm">
        {routes.map(r => {
          const rate = (settings.aiPriceRates ?? []).find(x => x.endpointId === r.endpointId && x.modelId === r.modelId);
          return <li key={JSON.stringify([r.endpointId, r.modelId])}>
            <b>{r.modelId}</b> · {r.endpointId}:{" "}
            {rate ? <>input {rate.inputEurPerMillion} · output {rate.outputEurPerMillion}
              {rate.cachedInputEurPerMillion !== undefined && <> · input in cache {rate.cachedInputEurPerMillion}</>}</>
              : <span className="text-amber-700 dark:text-amber-300">tariffa mancante</span>}
          </li>;
        })}
      </ul> : <p className="muted text-sm">Configura prima un modello in Impostazioni.</p>}
    </div>
    <p className="muted mt-3 text-xs">
      Il modello potrebbe ignorare max_tokens e un provider potrebbe addebitare chiamate senza usage.
      Il browser non conosce il credito reale: verifica sempre fatture e tariffe sul portale del provider.
      Il budget si applica alle chiamate successive all'attivazione, non a quelle precedenti.
    </p>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
