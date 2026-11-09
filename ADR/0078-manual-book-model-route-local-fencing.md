# ADR 0078 — Fencing locale e CAS IndexedDB per override del modello del libro

- **Stato:** accettato per v0.11.46
- **Data:** 2026-11-09
- **Issue:** [#82](https://github.com/KeyserDSoze/BookWriter/issues/82)
- **Epic ancora aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **Precedenti:** ADR 0007, 0076, 0077

## Problema

La selezione manuale di endpoint/modello per uno specifico libro leggeva il record `current` mantenuto da React, ne clonava **tutti** i campi e chiamava `saveBook`. Un'altra scheda (o un checkpoint AI) poteva aver modificato IndexedDB dopo il rendering della prima: `saveBook` assegnava semplicemente un `updatedAt` nuovo e sovrascriveva il record, perdendo capitoli, attività logiche e revisioni canoniche. La richiesta outbox eventuale poteva includere un libro obsoleto.

## Decisione

1. La funzione infrastrutturale `saveBook(book, queueSync = true, expectedUpdatedAt?)` accetta un **precondition token facoltativo**; all'interno della **stessa transazione readwrite** `books+outbox` che salverà il libro, confronta `stored.updatedAt` con `expectedUpdatedAt`. Se il confronto fallisce, conclude la transazione **senza scritture** e lancia `BookRevisionConflict` in italiano; non muta `book.updatedAt` né inserisce outbox. I writer AI esistenti, che operano con logiche e lock propri, restano compatibili perché il terzo argomento è facoltativo.
2. La nuova funzione applicativa `updateBookModelRoute` richiede il Web Lock esclusivo `bookwriter:writer:<bookId>` con `ifAvailable:true`. Lock occupato oppure Web Locks assente = rifiuto esplicito, senza scrivere. Dopo l'acquisizione rilegge IndexedDB, richiede la revisione vista dall'utente e uno stato diverso da `running`, applica **solo** `modelRoutes[task]` e salva con `expectedUpdatedAt`.
3. Il doppio controllo è intenzionale: Web Lock esclude l'autopilot e i writer cooperativi **del browser**, CAS IndexedDB impedisce che una scrittura parallela non coordinata attraversi lo spazio fra `getBook` e il commit. Non tentare merge automatico di un record stale; ricaricare e chiedere all'autore di riprovare.
4. Nella UI il campo testuale modello diventa un edit locale committato **onBlur**, non a ogni carattere, per evitare revisioni concorrenti durante la digitazione. Dopo un errore ricaricare lo snapshot, mostrando messaggio chiaro e valore corrente; dropdown endpoint conserva conferma immediata.

## Test e limiti

Vitest verifica successo e preservazione dei dati non correlati, CAS stale con outbox intatta, lock occupato, assenza Web Locks, libro running e collisione di due edit. Playwright desktop/mobile prova **due tab reali**: tab stale rifiutata e aggiornata, lock del writer impedisce una modifica, dopo il rilascio la modifica riesce. CI e Pages richieste verdi sull'ultima HEAD di `main`.

Questo ADR copre **solo override manuali del routing del libro**. Altri percorsi manuali (feedback, scene, revisioni, sync, dossier) vanno valutati e integrati progressivamente con analoghe precondizioni: non affermare che ogni editor sia già protetto. Nessun fencing atomico fra dispositivi, backend, cambio formato ZIP/canon, nuova richiesta GitHub o forza push; restano i rischi della issue #10.
