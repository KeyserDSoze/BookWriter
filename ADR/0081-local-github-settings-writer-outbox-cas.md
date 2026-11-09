# ADR 0081 — Collegamento GitHub e autosync manuali: writer/outbox lock e CAS locale

- **Stato:** accettato per v0.11.49
- **Data:** 2026-11-09
- **Issue:** [#85](https://github.com/KeyserDSoze/BookWriter/issues/85)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **Precedenti:** ADR 0007, 0078, 0079, 0080

## Contesto

Nel pannello GitHub il collegamento di una repository e la modifica della policy di autosync applicavano una mutazione manuale a `book.remote` con `getBook` seguito da `saveBook` **senza il writer lock né la precondizione di versione**. La schermata poteva basarsi su un `book` React obsoleto mentre l'autopilot avanzava un checkpoint, un'altra scheda collegava una repository diversa o cambiavano le condizioni di sicurezza editoriale. Inoltre il worker autosync conserva già il Web Lock `bookwriter:github-outbox` durante l'invio GitHub.

## Decisione

1. Separare dalla UI i due use case `connectBookRemote(bookId, expectedUpdatedAt, target)` e `setBookAutoSync(bookId, expectedUpdatedAt, enabled, allowPublicSync)`. Acquisire il token di revisione **effettivamente mostrato** prima dei controlli di repository che richiedono rete: un `inspectRepository` completato tardi non autorizza a scrivere uno snapshot vecchio.
2. Per ogni modifica, acquisire `bookwriter:writer:<bookId>` e poi `bookwriter:github-outbox`, **entrambi** con `ifAvailable:true`. È lo stesso ordine utilizzato dalla conferma editoriale. Senza Web Locks oppure con writer/sync già attivi, fallire senza attendere né scrivere. Nessun lock via `localStorage` o mutex in memoria; nessun HTTP dentro la sezione critica.
3. Sotto entrambi i lock, rileggerne la versione IndexedDB, confrontare `updatedAt`, rifiutare `status=running` e, in caso di collegamento, verificare **di nuovo** l'immobilità della destinazione per libri che hanno già `lastSyncedCommit`. Validazione della destinazione invariata.
4. Prima di abilitare autosync, ricontrollare **il libro corrente**: `editorialReviewSceneIds`, `editorialCycle`, scene non pianificate in capitoli non congelati e commit manuale precedente. Non ereditare il consenso a repository pubbliche inavvertitamente: i controlli esistenti `inspectRepository` e `publicConsent` rimangono nel pannello.
5. Scrivere soltanto il campo `remote` su una copia del record corrente tramite `saveBook(next, queueSync, expectedUpdatedAt)`: seconda verifica atomica in `books+outbox`. Abilitando autosync, il checkpoint idoneo viene accodato; disabilitando, nessun elemento di outbox viene cancellato o aggiunto. Su conflitto/lock occupato la UI aggiorna i dati e mostra un errore, **senza retry implicito**.
6. Restano invariati il protocollo GitHub, la verifica pubblica, gli SHA senza `force`, il writer lease remoto e la gestione di richieste già inviate. In particolare non è possibile revocare una sincronizzazione GitHub **già in corso**: l'outbox lock fa rifiutare un cambio di policy finché termina.

## Verifiche e limiti

Vitest su collegamento valido/obsoleto, repository sincronizzata immutabile, enabling/disabling autosync, outbox persistente, review o scene non congelate, stato `running`, mancanza Web Locks, writer/outbox occupati e due click sullo stesso `updatedAt`. Playwright desktop/mobile con **due schede reali**, collegamento obsoleto rifiutato, writer lock durante toggle, attivazione riuscita e seconda modifica stale rifiutata con coda invariata. CI/Pages verdi sullo stesso SHA finale `main`.

**Portata:** questo ADR riguarda **soltanto** collegamento manuale della repository e opt-in/out autosync nello stesso browser. Non risolve l'ACK GitHub separato dall'IndexedDB, altri editor manuali, i device differenti, né il clock skew moderato; gli epic #10/#3/#6 rimangono aperti.
