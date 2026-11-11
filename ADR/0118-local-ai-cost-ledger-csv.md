# ADR 0118 — Ledger economico AI esportabile per libro senza inventare fatture

- **Stato:** accettato, rilasciato in v0.11.83 su `main` (issue #127)
- **Data:** 2026-11-11
- **Issue:** [#126](https://github.com/KeyserDSoze/BookWriter/issues/126), epic [#17](https://github.com/KeyserDSoze/BookWriter/issues/17)
- **Precedenti:** [ADR 0010](0010-ai-usage-observability.md), [ADR 0012](0012-book-ai-budget-guardrails.md), [ADR 0108](0108-price-snapshot-ai-budget.md), [ADR 0117](0117-ai-header-deadline.md)

## Problema

L'autore vede una stima aggregata del periodo di budget, ma non può riconciliare localmente ogni tentativo AI con il proprio registro contabile. Risposte cancellate, errori provider, report mancanti, listini cambiati e preventivi non sono fatture. Un export indiscriminato dell'Activity esporrebbe prompt, prosa, descrizioni, errori e possibili credenziali; un CSV ingenuo consentirebbe formule in fogli di calcolo attraverso identificatori importati.

## Decisione

1. **CSV per singolo libro, senza server:** la Dashboard espone `Esporta ledger CSV`, accessibile anche quando il budget del libro è disattivato. `buildAiCostLedgerCsv(bookId, activities, settings)` lavora localmente e filtra `activity.bookId === bookId`. Include soltanto tentativi `aiRequested=true` e legacy con route, mai azioni manuali o preflight `aiRequested=false`. Ordine deterministico per data e ID.
2. **Un solo classificatore costi:** `assessAiCostAttempt` è condiviso fra `accountBookAiBudget` e il CSV. Usa soltanto token interi non negativi comunicati dal provider, tariffe salvate prima del tentativo oppure listino corrente marcato esplicitamente `listino_corrente` per legacy senza snapshot. Snapshot invalido, malformato o riferito a un'altra route non fa fallback al prezzo corrente. Usage mancante/parziale/in corso non diventa zero, nemmeno quando esiste una tariffa.
3. **Distinzione contabile obbligatoria:** il CSV contiene token input e output osservati, stato del tentativo, copertura usage, provenienza e importo della tariffa, stima calcolabile; la colonna `fattura_provider_eur` è **sempre vuota** e `stato_fattura=non_disponibile`. Non si attesta alcuna fattura, credito residuo, prezzo ufficiale o addebito effettivo. Il valore zero compare solo se è possibile calcolarlo da report completo e tariffa valida.
4. **Privacy by construction:** esportare soltanto ID Activity, date, stato, route, token, tariffa e stima, **mai** prompt, titolo/descrizione della task, riassunto, output, prosa, errori, chiavi API, nome del libro o secret. Nessuna telemetria o chiamata a un provider. Anche gli identificatori del libro per i nomi di file sono normalizzati.
5. **CSV non fidato:** BOM UTF-8, separatore `;` per fogli locali italiani, campi fra doppi apici con escaping e rimozione di controlli CR/LF. I campi che iniziano (anche dopo spazi) con `=`, `+`, `-` o `@` sono prefissati con apostrofo prima di essere serializzati, impedendo la normale interpretazione come formule. Il file esportato è sensibile: l'autore deve proteggerlo e confrontarlo con il portale provider.
6. **Non alterare il libro o la pipeline:** esportazione sincrona locale di snapshot di UI già caricati; nessun cambio a IndexedDB, backup ZIP, canone, writer lease, pricing/provider o budget. Nessuna nuova dipendenza, API remota o credenziale.

## Verifiche e limiti

- Vitest per completezza, snapshot immutabile, legacy dinamico, zero valido, usage mancante/parziale/in corso, snapshot alterato, tentativi preflight, isolamento fra libri, omessa prosa e CSV formula injection.
- Playwright Chromium desktop/mobile: download reale del CSV del libro attivo con prezzo snapshot, tentativo senza usage e dati privati, verifica nessun dato di altro libro, nessun overflow mobile.
- TypeScript, test, smoke, build, EPUBCheck, Pages e cleanup verificati sulla stessa HEAD prima della chiusura #126; la release numerica **0.11.83** è stata completata e verificata nella [#127](https://github.com/KeyserDSoze/BookWriter/issues/127). La successiva vista locale per task è trattata da [ADR 0119](0119-task-ai-cost-history.md).
- **Non è una riconciliazione con fatture vere.** Richieste esterne a BookWriter, costi del provider non osservati, caching, tool, taxes, valuta o tariffe per data non sono ricostruiti. Import CSV e pagamenti non sono supportati. I fogli di calcolo potrebbero comunque avere interpreti e impostazioni di import specifiche: trattare file provenienti da terzi come non fidati.
