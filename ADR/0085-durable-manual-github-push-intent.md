# ADR 0085 — Intento durabile per push GitHub manuale dopo crash e reload

- **Stato:** accettato per v0.11.53
- **Data:** 2026-11-09
- **Issue:** [#89](https://github.com/KeyserDSoze/BookWriter/issues/89)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0006, 0078, 0081, 0082, 0084

## Problema

La v0.11.52 riconosce in lettura un commit GitHub il cui `PATCH` è stato applicato ma l'ACK è andato perso, **se la stessa chiamata è ancora attiva**. Nel push manuale l'`operationId` veniva generato in memoria da `pushGitHubBook`. Se la scheda veniva chiusa o sospesa prima della verifica, il successivo clic creava un identificatore nuovo e non poteva riconoscere sulla HEAD il marker `.bookwriter/sync.json` dell'operazione originaria. La conseguenza era un conflitto apparentemente esterno e difficoltà di recupero, nonostante il commit fosse quello scritto da BookWriter.

La `outbox` IndexedDB già esistente è una coda di checkpoint autosync keyed per `bookId`. Non è sicuro requisirla o cancellarla per un push manuale, perché dopo la disattivazione dell'autosync può ancora contenere lavoro non sincronizzato o bloccato.

## Decisione

1. Salvare un record `ManualPushIntent` sotto `meta["manual-github-push:<bookId>"]` nella **struttura IndexedDB già esistente**, senza migrazione DB: `bookId, operationId UUID, owner, repository, branch, baseSha, sourceRevision, preparedAt`. Non contiene PAT né segreti narrativi; il campo `remote` nel libro non cambia.
2. Aggiungere `pushManualGitHubBook(bookId, consentPublic)` come **unico percorso del pulsante manuale**. Acquisire `bookwriter:writer:<bookId>` e poi `bookwriter:github-outbox`, entrambi `ifAvailable:true`, prima della preparazione e del push. Se Web Locks non è disponibile, un writer o sync sono attivi, **non scrivere**: fallire chiuso. Il lock rimane fino al completamento dell'ACK locale.
3. Dentro una transazione `books+meta` leggere il libro corrente e il vecchio intento. Se mancante, creare e persistere il nuovo UUID **prima di qualunque richiesta HTTP GitHub**. Se presente, riusarlo anche dopo reload/crash, mantenendo `sourceRevision` originaria come testimonianza del primo tentativo. Se destinazione GitHub o `lastSyncedCommit` locale sono cambiati, non cancellare, ruotare o riutilizzare silenziosamente l'UUID: il conflitto richiede verifica esplicita.
4. Chiamare l'esistente `pushGitHubBook(...,{operationId})`. Se la HEAD remota differisce dalla baseline del libro e il commit/marker contengono proprio quell'UUID, il recovery in sola lettura di ADR 0084 riconosce il commit e la sua vera `sourceRevision`, anche se la prosa locale è avanzata dopo il push. Se il commit remoto non è stato applicato, il nuovo invio conserva lo stesso UUID finché la baseline e la destinazione rimangono valide. I conflitti di SHA e i permessi restano invariati; **mai** `force:true`.
5. Ampliare la transazione di `persistRemoteAcknowledgment` da `books+outbox` a `books+outbox+meta`: dopo aver validato destinazione e baseline, salvare solo i metadata GitHub, decidere l'outbox e **cancellare soltanto l'intento con `operationId` e destinazione esatti**. In caso di errore o conflitto l'operazione è un'unità atomica: nessuna cancellazione dell'intento o della coda senza ACK. Un intent differente non deve essere cancellato.
6. La UI mantiene il consenso esplicito per le repository pubbliche e mostra, quando `recovered:true`, «Commit GitHub recuperato e confermato». In caso di errore lascia l'intento durabile e comunica la causa; il successivo clic dell'autore riutilizza lo stesso ID, senza sincronizzazione automatica non richiesta.

## Verifiche

Vitest per persistenza/reuse del token, due preparazioni concorrenti, revisione locale avanzata, destinazione o baseline cambiate, running/autosync, Web Lock assente o occupato, ACK valido che cancella atomica l'intento, ACK fallito che lo preserva, ACK estraneo che non lo elimina, outbox indipendente preservata. Playwright desktop/mobile con due schede e GitHub simulato: PATCH applicato remotamente ma risposta e prima verifica perse; simulazione reload dopo il fallimento, seconda tab che scrive una nuova revisione, nuovo clic che **esegue soltanto GET e recupera il vecchio UUID senza nuovi POST/PATCH**, preservando libro e outbox.

## Limiti

L'intento è persistente **nello stesso browser/origin**, non tra dispositivi. Le scritture HTTP GitHub e IndexedDB non diventano una transazione distribuita; il lease GitHub resta separato. Se un altro dispositivo modifica la baseline o la destinazione, il retry non forza alcun merge. Un intento obsoleto dopo una divergenza reale richiede un flusso esplicito di riconciliazione: non aggiungiamo un pulsante per «dimenticare il tentativo» senza dimostrarne la sicurezza remota. La scelta mantiene aperte le epic #10, #3 e #6.
