# ADR 0080 — Conferma manuale della scena: revisione atomica per canon e audit

- **Stato:** accettato per v0.11.48
- **Data:** 2026-11-09
- **Issue:** [#84](https://github.com/KeyserDSoze/BookWriter/issues/84)
- **Epic ancora aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#15](https://github.com/KeyserDSoze/BookWriter/issues/15), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **Precedenti:** ADR 0008, 0009, 0078, 0079

## Difetto

`confirmEditorialScene` permette all'autore di canonizzare una scena fusa soltanto dopo rilettura e conferma esplicita, Web Lock del writer, Web Lock dell'outbox, controllo di `updatedAt`, autosync disabilitato e scena ancora draft. In seguito salva il libro modificato e la nuova attività di audit con `saveBookAndActivity`. Quest'ultima funzione leggeva il valore già persistito per calcolare un timestamp monotono, **ma non confrontava la revisione letta con quella approvata dall'autore**. Il piccolo intervallo tra `getBook` e la transazione può consentire a un writer non cooperativo di aggiornare il romanzo: il commit della conferma sovrascriverebbe il canon più recente e registrerebbe comunque una falsa approvazione.

## Decisione

1. Estendere `saveBookAndActivity(book, activity, expectedUpdatedAt?)` con un token di revisione **facoltativo**. Dentro **l'unica transazione readwrite** `books+activities+outbox`, leggere `stored.updatedAt` e confrontarlo con `expectedUpdatedAt` prima di qualsiasi `put`. In caso di mismatch, attendere la conclusione della transazione invariata e lanciare `BookRevisionConflict`. Non aggiornare `book.updatedAt`, la scena, la lista pending, il registro attività o la coda sync.
2. La conferma `confirmEditorialScene(bookId,sceneId,expectedUpdatedAt)` già richiede questo token dall'interfaccia e verifica immediatamente sotto Web Locks. Ora passa **lo stesso token** al salvataggio con audit, coprendo anche la finestra di concorrenza fino al commit IndexedDB. Nessuna approvazione implicita, niente provider AI o push GitHub.
3. Conservare le API precedenti e l'autopilot: i callsite `saveBookAndActivity` che non hanno ancora un token e operano con il loro writer guard continuano a funzionare. La precondizione non viene applicata indiscriminatamente senza un audit dei relativi percorsi e lock.
4. Se l'approvazione fallisce, la Dashboard/Lettore mostra l'errore in italiano e **ricarica i libri** per invalidare la copia React. La scena non viene auto-approvata né ritentata: l'autore deve rileggerla e confermare una nuova revisione.

## Test e compromessi

Vitest con `fake-indexeddb`: successo con un solo audit, modifica concorrente tra lettura e commit, outbox/attività/stato immutati dopo CAS fallita, due approvazioni con lo stesso token (una sola può vincere), vecchi callsite senza precondizione. Playwright desktop/mobile con **due schede reali**: lock writer occupato, rilascio, approvazione valida nella prima tab, rifiuto della conferma obsoleta nella seconda tab, una sola attività e nessuna sincronizzazione remota.

Questo è un CAS **locale** e per un percorso manuale specifico. Il lease GitHub resta un meccanismo separato e non costituisce una transazione atomica con IndexedDB. Lo SHA remoto, la latenza cross-device, gli editor manuali non auditati e le prove su mobile fisico sospeso restano aperti nella issue #10. Non cambiano schema DB/ZIP, formato canon, outbox, policy autosync né credenziali.
