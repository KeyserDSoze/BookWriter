# ADR 0138 — Scheda task a fuoco e navigazione sicura nel registro

- Stato: accettato come incremento UX task-first
- Data: 2026-11-12
- Issue: #164, parent #157; rewind separato #158, privacy #156/#162

## Contesto

La pagina Attività già espone filtri e raggruppamento per run, ma le trascrizioni e l'output di ciascun task sono annidati in un lungo elenco. L'autore deve poter leggere una risposta e confrontarla con il task prima/dopo senza aprire più schede contemporaneamente e senza confondere lo storico con un ripristino.

## Decisione

1. Nel **registro completo** un'azione esplicita apre la scheda dedicata al task selezionato. Il componente riusa il dettaglio esistente ma limita il rendering della lista a una sola attività. In questa modalità i dettagli registrati e l'output confermato sono espansi. La Dashboard compatta e lo streaming del task corrente non cambiano.
2. `resolveTaskFocus` lavora sulla sequenza già filtrata, ordinata e, se richiesto, raggruppata per `runId`: espone posizione, totale e ID precedente/successivo. Non accede a `Activity.output`, prompt o `AiLocalTrace`; il focus non persiste nel canone e non interroga il provider. Navigazione mai fuori dai filtri attivi.
3. Cambiando focus o tornando alla lista, invalidare il ticket asincrono di lettura delle tracce e cancellare scelta/risposta privata visibile. Solo un **nuovo clic con opt-in** carica IndexedDB; la guardia con esatto `bookId/activityId` resta obbligatoria. Anche cambio libro/consenso/unmount azzera e recinta l'ispezione, come ADR 0136.
4. Nessuna ripartenza, undo, revisione automatica, tool calling, mutazione di libro, costo/usage ricostruito o nuova POST. Il comando «Prepara revisione» conserva il proprio significato supervisionato corrente; checkpoint/replay restano #158/#150.

## Verifica

Vitest su ordine filtrato e gruppi intercalati, navigazione ai limiti, selezione assente, immutabilità. Playwright desktop/mobile per apertura, precedente/successivo, ritorno e cambio libro dopo ispezione sensibile. CI frontend, tutti e quattro gli shard Chromium desktop/mobile, EPUBCheck 4/4, Pages e cleanup sulla stessa HEAD `completed/success` prima di chiudere #164. Prova fisica del provider resta #159.
