# ADR 0121 — Avvisi anticipati sul margine stimato del budget AI locale

- **Stato:** implementato su `main`, non ancora in release npm numerica successiva a 0.11.85
- **Data:** 2026-11-11
- **Issue:** [#132](https://github.com/KeyserDSoze/BookWriter/issues/132); epic [#17](https://github.com/KeyserDSoze/BookWriter/issues/17) e [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Predecessori:** [ADR 0012](0012-book-ai-budget-guardrails.md), [ADR 0108](0108-price-snapshot-ai-budget.md), [ADR 0118](0118-local-ai-cost-ledger-csv.md), [ADR 0120](0120-session-ai-budget.md)

## Contesto

Il guard preventivo verifica la riserva stimata per ogni chiamata AI e blocca il provider quando il budget del libro o il plafond della sessione `runId` non bastano. Nella Dashboard erano tuttavia visibili soltanto il totale noto e il limite: l'autore non riceveva un **avviso anticipato**, prima dell'arresto del ciclo, al superamento di un livello significativo di spesa stimata. Nel caso peggiore, attività senza usage potevano convivere con un residuo visualizzato senza contestualizzare l'incertezza.

## Decisione

1. **Regola di dominio pura, condivisa.** `assessAiBudgetHeadroom(accounting, limitEur)` riceve i risultati di `accountBookAiBudget` o `accountSessionAiBudget` senza salvare nuovi dati, inviare richieste o ricalcolare prezzi: stato `sotto_soglia` con stima nota sotto l'80%, `vicino` dall'80% incluso e sotto il 100%, `raggiunto` dal 100%, `incerto` per `incompleteCount`, `unpricedCount`, limite o importo invalido. Il rapporto è fra spesa **nota e stimata** e soglia locale, mai fra addebito reale e saldo provider.
2. **Incerto prevale su margine apparente.** Se c'è anche una sola richiesta potenzialmente fatturabile senza usage completo o senza listino valido, la funzione restituisce `incerto` **senza** `knownRemainingEur` o `knownUsedFraction`: non presentare un margine apparentemente spendibile né assumere che la richiesta sia gratuita. La nuova UI non sostituisce lo stop conservativo già presente in preflight.
3. **Due scope distinti.** La Dashboard mostra un avviso italiano accessibile (`role=alert`) per il periodo del libro e, **solo se configurato e con una sessione registrata**, per l'ultimo `runId` AI di quel libro. I totali, le tariffe e i contatori provengono sempre dalla stessa contabilità già usata dal CSV. Nessun avviso se il budget non è attivo o se la sessione non è stata ancora registrata. Cambiare la soglia globale non azzera i tentativi della sessione; cambiare il limite sessione non modifica la spesa del libro.
4. **Margine locale, non credito finanziario.** Quando la contabilità è completa e valida, è possibile mostrare `max(0, limitEur - estimatedSpentEur)`, sempre etichettato `margine stimato noto`. Esclude riserva per il prossimo prompt, chiamate esterne, crediti reali, imposte, cached tokens, sconti, FX e differenze fra prezzo manuale e addebito provider; il preflight continua a valutare la riserva vera **prima** dell'invio.
5. **Nessun cambio al gating.** L'80% produce soltanto una segnalazione consultabile dall'autore, **non** pausa, retry, blocco prematuro, nuova Activity, canonizzazione della prosa o modifica del writer guard. Le uniche condizioni di stop applicativo rimangono quelle già previste da ADR 0012/0120, inclusi usage incompleto e tetto con riserva.

## Verifiche e limiti

- Vitest sui confini 0%, appena sotto 80%, esattamente 80%, 100% e oltre; priorità dell'incertezza, input non finiti e isolamento del runId/libro/periodo.
- Playwright Chromium desktop/mobile: due sessioni con tariffe storiche sintetiche, avvisi libro+sessione, aggiornamento della soglia senza azzerare i dati, nuova attività senza usage, cambio libro, assenza di overflow.
- Non può prevedere l'importo della **prossima** chiamata perché la Dashboard non conosce ancora il prompt reale: il warning mostra soltanto il consumo già osservato; può rimanere assente anche se la prossima riserva farà scattare lo stop. Né il warning né il budget garantiscono un tetto finanziario remoto o una prenotazione cross-device.
- Nessuna nuova dipendenza, campo ZIP, persistenza o API. CI, Pages, cleanup ed EPUBCheck da verificare sulla medesima HEAD prima di chiudere #132; numero npm 0.11.85 invariato fino a una release separata.
