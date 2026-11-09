# ADR 0074 — Autopilot locale fail-closed senza Web Locks

- **Stato:** accettato per v0.11.41
- **Data:** 2026-11-09
- **Issue di consegna:** [#77](https://github.com/KeyserDSoze/BookWriter/issues/77)
- **Epic:** [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#10](https://github.com/KeyserDSoze/BookWriter/issues/10)
- **Predecessori:** ADR 0005–0007

## Problema

BookWriter conserva attività e manoscritti locali nello stesso IndexedDB per tutte le schede di un origin. Il writer guard v0.11.40 usa Web Locks per serializzare autopilot nella stessa installazione. Se `navigator.locks` non esiste, la guardia rifiuta correttamente i libri associati a una repository GitHub ma **lascia partire l'azione per libri non collegati**. Due tab locali in un browser senza Web Locks possono così inviare due chiamate AI parallele, spendere crediti e sovrascrivere scene o checkpoint. Un `AbortController` locale non coordina schede separate; il lease GitHub non copre libri senza remote.

## Decisione

1. `withWriterGuard` deve **fallire chiuso** se `navigator.locks.request` è assente o non disponibile, per **tutti** i libri. La guardia non chiama `action`, non acquisisce un lease remoto e non avvia chiamate modello. Mostra un errore leggibile all'autore e suggerisce un browser aggiornato con contesto HTTPS sicuro.
2. Con Web Locks disponibile, conservare il lock per libro `bookwriter:writer:<bookId>` con `ifAvailable:true`; una seconda scheda ottiene subito un rifiuto senza attendere e senza generare output duplicato. Un libro locale non richiede GitHub.
3. Per i libri collegati a GitHub, mantenere **anche** acquisizione, rinnovo e re-verifica del lease remoto prima/dopo la rete e prima del checkpoint canonico. Non scambiare Web Locks per coordinamento cross-device.
4. Non introdurre fallback con variabili di modulo, `localStorage`, timestamp o un flag IndexedDB non transazionale. Il lock fail-closed è intenzionale anche a costo di impedire la generazione su alcuni browser: testo locale, modifiche manuali e backup rimangono leggibili.
5. Non modificare lo schema dati, il canone, il routing AI o i modelli, tariffe, segreti, GitHub sync, event log, ZIP, chiamate HTTP o i tempi di lease. Nessun backend.

## Test, conseguenze e limiti

Vitest verifica che browser senza Web Locks non invocano azione locale o remota né mutano il libro, mentre un libro locale su browser supportato funziona e il lock occupato blocca la seconda sessione. Playwright desktop/mobile rimuove Web Locks prima dell'avvio della SPA e verifica il messaggio in Dashboard, lo stato persistito `idle`, l'assenza di attività `running` o `aiRequested` e di richieste modello. CI e deploy su `main` devono essere verdi sullo stesso commit.

Questa correzione elimina una via concreta per avviare **un autopilot non protetto tra tab**. Non copre concorrenza di editor manuali, sospensioni OS, bug nel provider o un fencing distribuito forte; tali problemi restano nell'issue #10.
