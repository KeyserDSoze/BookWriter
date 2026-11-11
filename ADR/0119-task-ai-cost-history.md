# ADR 0119 — Storico dei costi AI per task nella Dashboard

- **Stato:** accettato, incluso nella release v0.11.84 (#129) su `main`
- **Data:** 2026-11-11
- **Issue:** [#128](https://github.com/KeyserDSoze/BookWriter/issues/128); epic [#17](https://github.com/KeyserDSoze/BookWriter/issues/17) e [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** [ADR 0010](0010-ai-usage-observability.md), [ADR 0012](0012-book-ai-budget-guardrails.md), [ADR 0108](0108-price-snapshot-ai-budget.md), [ADR 0118](0118-local-ai-cost-ledger-csv.md)

## Contesto

La release 0.11.83 permette di esportare un ledger CSV del libro, ma l'autore non può ancora vedere rapidamente **quale richiesta AI** ha un costo stimabile e quali tentativi richiedono una verifica manuale. Aprire ogni volta un foglio di calcolo rende difficile distinguere fallimenti, interruzioni, report incompleti, snapshot alterati e listini legacy.

## Decisione

1. **Vista read-only, per singolo libro.** `listBookAiCostHistory(bookId, activities, settings)` applica gli stessi filtri del CSV: `bookId` esatto, solo `aiRequested=true` o log legacy con route; esclude attività manuali e `aiRequested=false` (preflight bloccato). Restituisce metadati minimi: ID task, fase, titolo, stato, data, route, `AiCostAssessment`, senza prosa, prompt, riassunti, errori, chiavi o contenuti AI. Il titolo della task è visibile **soltanto nel browser dell'autore**, non esportato nel CSV.
2. **Un solo classificatore contabile.** `AiCostHistoryPanel` e `buildAiCostLedgerCsv` riutilizzano la medesima proiezione di `assessAiCostAttempt` usata dal budget. Zero soltanto se output e input sono entrambi validi e una tariffa manuale è verificabile; `running` resta non concluso anche con token già parzialmente osservati. Snapshot fuori route/invalidi non ricadono sul listino attuale; attività legacy senza snapshot possono essere rivalutate con il listino corrente, con etichetta esplicita.
3. **Leggibilità e limiti mobile.** Nella Dashboard, sotto il download CSV nel pannello Budget AI, mostrare al massimo 10 record recenti per volta e un pulsante esplicito `Mostra altri 10 tentativi`. Il filtro `Solo tentativi senza stima` mostra solo record il cui costo non è calcolabile, senza confondere questa condizione con una fattura zero. Ordinamento discendente per data e ID; nessun overflow orizzontale pagina.
4. **Sicurezza e persistenza.** Non duplicare Activity, non salvare nuovi record o tariffe, non contattare servizi remoti e non implementare fatture, saldo o telemetria. React esegue escaping del titolo e degli identificatori importati, e il layout gestisce testi molto lunghi. Titoli delle attività potrebbero contenere dati della storia: sono visibili solo localmente nel pannello; non vanno aggiunti all'export.
5. **Distinzione monetaria.** Ogni importo mostra `(stima)`, senza spacciare un calcolo a tariffa manuale per un addebito reale. Stime positive minuscole, al di sotto della precisione di visualizzazione, non devono essere etichettate come zero: mostrare un limite esplicito. Il CSV conserva i valori numerici senza troncamento; il budget preventivo conserva le stesse regole.

## Verifiche e limiti

- Vitest su book isolation, esclusione preflight/manuali, ordine, snapshot vs legacy, usage parziale/mancante, `running`, zero valido e assenza di payload narrativi nella proiezione.
- Playwright Chromium desktop e mobile: prima pagina di dieci task, filtro senza stima, caricamento successivo, dati privati assenti nella vista, secondo libro senza consumo, viewport senza overflow.
- TypeScript, Vitest, smoke, build, EPUBCheck, Pages e cleanup da verificare sulla stessa HEAD prima di chiudere #128.
- Le stime continuano a essere **manuali e locali**, non provano il credito, la fattura, la tariffa storica ufficiale, caching, tasse o valuta diverse da EUR. I prezzi per data, il budget per sessione e il billing ufficiale restano nella epic #17. Non cambiare il numero versione/lockfile manualmente: una nuova issue di release traccerà l'allineamento npm.
