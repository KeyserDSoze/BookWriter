# ADR 0086 — Riconciliazione verificata degli intenti GitHub manuali sospesi

- **Stato:** accettato per v0.11.54
- **Data:** 2026-11-09
- **Issue:** [#90](https://github.com/KeyserDSoze/BookWriter/issues/90)
- **Epic ancora aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0082, 0083, 0084, 0085

## Contesto

La v0.11.53 memorizza `ManualPushIntent` per recuperare dopo crash un `PATCH force:false` applicato ma privo di ACK. Il normale retry deve, per sicurezza, **bloccare** un tentativo quando la repository, il branch o `lastSyncedCommit` del libro sono cambiati rispetto ai valori dell'intento. Tuttavia un autore può aver già pubblicato il vecchio commit e aver successivamente cambiato destinazione o baseline (import, riconciliazione, backup). In questo caso un intento obsoleto resta bloccante e non si può cancellarlo alla cieca: il tentativo remoto potrebbe non essere stato applicato, o potrebbe appartenere a un commit estraneo.

## Decisione

1. Introdurre `verifyPublishedManualPush(intent)`, una prova **soltanto HTTP GET** sulla **destinazione originale** nel record durabile. La HEAD deve essere uno SHA Git valido e **diverso** dalla `baseSha` originaria. Il messaggio del commit sulla HEAD deve essere esattamente `bookwriter: sync <operationId>`; se `baseSha` è presente, il commit deve avere **un solo parent** pari a quella baseline. Leggere `.bookwriter/sync.json?ref=<HEAD>` e pretendere che `operationId`, `bookId` e `sourceRevision` siano esattamente quelli dell'intento. Nessun 404, mismatch, errore di rete o commit estraneo equivale a una prova positiva.
2. Introdurre `reconcileSuspendedManualPush(bookId)` per la sola riconciliazione **richiesta esplicitamente dall'autore**. Richiedere Web Locks **writer per libro → github-outbox**, entrambi `ifAvailable:true`, e il libro non in `running`. Deve esistere un intento il cui target o `baseSha` sia effettivamente diverso dal `remote` corrente. Se sono ancora uguali, il percorso corretto resta il pulsante di sincronizzazione, che può recuperare l'ACK con lo stesso ID.
3. Sotto i lock leggere `BookProject` e `ManualPushIntent`, eseguire la prova **remota in sola lettura**, poi aprire una transazione IndexedDB `readwrite books+meta`, rileggere entrambi e verificare ancora identità completa dell'intento, stato/target/baseline e revisione `updatedAt` del libro. Soltanto dopo questi confronti cancellare **esclusivamente** `meta["manual-github-push:<bookId>"]` con UUID corrispondente. Mai aggiornare `books`, `outbox`, `lastSyncedCommit`, `updatedAt`, credenziali, consent pubblico o canone. Su qualsiasi conflitto conservare i record.
4. In `GitHubSyncPanel` mostrare il tentativo e la vecchia destinazione; se target/baseline hanno divergenze, presentare il pulsante **Verifica e archivia tentativo precedente** con `window.confirm` esplicito. Spiegare chiaramente che non è un merge o un nuovo push, che la nuova repository non viene sincronizzata e che una HEAD ambigua non consente cancellazione. Nessuna azione automatica mentre la pagina si apre.
5. Non fornire in questa tranche un pulsante di reset forzato degli intenti quando la HEAD è avanzata altrove oppure il commit non è verificabile. Richiede una revisione guidata della cronologia e dei due dispositivi; un'assenza di marker sulla HEAD **non dimostra** che il commit non sia stato pubblicato in precedenza.

## Test e limiti

Vitest: prova remota positiva, HEAD immobile, commit con messaggio/parent estranei, marker con book ID/operation ID/revisione errati o assente, perdita della rete, **zero POST/PATCH**. Use case locale: repository o baseline diverse, assenza di mismatch, writer/outbox lock assenti o occupati, `running`, intent o revisione modificati durante la verifica, preservazione di libro e outbox. Playwright desktop/mobile con due tab: simulazione di intento bloccato e nuova destinazione, un primo marker errato che lascia tutto intatto e un secondo marker corretto che archivia solo `meta`, dopo consenso autore, senza richieste di scrittura GitHub.

**Limiti:** la verifica riguarda esclusivamente la **HEAD attuale** sulla repository originaria. Non dimostra la cronologia di un commit poi superato; in tale caso l'intento resta sospeso per revisione futura. Web Locks valgono soltanto nello stesso browser. GitHub e IndexedDB non sono una transazione distribuita: restano aperte #10 e #3.
