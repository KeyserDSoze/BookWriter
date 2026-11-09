# ADR 0077 — Recovery dello startup serializzato con il Web Lock del writer

- **Stato:** accettato per v0.11.45
- **Data:** 2026-11-09
- **Issue:** [#81](https://github.com/KeyserDSoze/BookWriter/issues/81)
- **Epic aperte:** [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **Predecessori:** ADR 0007, 0074, 0076

## Contesto

Ogni scheda di BookWriter chiama `recoverInterruptedRuns` al montaggio dell'app. La vecchia implementazione aggiornava indiscriminatamente in una transazione tutti i libri `running` in `paused` e tutte le attività `running` in `cancelled`. Poiché IndexedDB è condiviso tra tab, aprire una seconda scheda durante un autopilot in corso poteva **fingere l'interruzione** del writer ancora vivo, modificando il suo checkpoint e il registro delle attività.

## Decisione

1. Eseguire recovery solo quando `navigator.locks.request` è disponibile; senza Web Locks non è sicuro stabilire che una sessione apparentemente `running` sia terminata. Nessun fallback a storage non atomico.
2. Identificare i libri con stato `running` o attività ancora `running`; per ciascuno tentare il Web Lock esclusivo `bookwriter:writer:<bookId>` con `{ifAvailable:true}`. È **esattamente il lock** che `withWriterGuard` mantiene per tutta la durata della sessione AI.
3. Se il lock è occupato, non modificare libro e attività di quella sessione. Se libero, aprire una transazione `books + activities` **entro il lock**, leggere nuovamente stato e attività IndexedDB e recuperare solo i record ancora `running` di quel libro. Non applicare snapshot pre-lock.
4. Mantenere le stesse transizioni e messaggi italiani: `running → paused` con `previousError` e `running → cancelled` con `endedAt` per l'audit; il recovery ripetuto non altera record già completati. Nessuna scrittura nel canone remoto, outbox o su GitHub.

## Verifiche

Vitest con due libri, lock occupato/libero, nessun Web Locks, attività dei due libri, recovery ripetuto e aggiornamenti intercorsi tra snapshot iniziale e acquisizione lock. Playwright desktop/mobile con **due tab reali**: una detiene il Web Lock e possiede un libro/attività `running`; la seconda non ne altera lo stato, ma lo recupera al suo successivo avvio dopo il rilascio del lock. CI/Pages su `main`.

## Limiti

Questo impedisce **una particolare corruzione multi-tab allo startup**, non coordina automaticamente editor manuali o browser di dispositivi distinti. Se un browser senza Web Locks contiene un vecchio run `running`, lo stato rimane conservativamente intatto, non viene inventato un crash. Rimangono aperti il fencing transazionale delle modifiche manuali, il gap GitHub/IndexedDB, il clock skew moderato e i test con dispositivi fisici della #10.
