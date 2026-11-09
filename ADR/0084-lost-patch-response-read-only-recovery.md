# ADR 0084 — Recupero immediato read-only di un PATCH GitHub applicato con ACK perso

- **Stato:** accettato per la v0.11.52
- **Data:** 2026-11-09
- **Issue:** [#88](https://github.com/KeyserDSoze/BookWriter/issues/88)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0076, 0082, 0083

## Contesto

Una scrittura GitHub `PATCH /git/refs/heads/<branch>` può riuscire sul server mentre la risposta si perde, o un HTTP 5xx può essere restituito **dopo** l'applicazione. Fino alla v0.11.51 `pushGitHubBook` propagava l'errore e non registrava `lastSyncedCommit`, anche se la HEAD puntava al commit creato. Il worker autosync poteva verificare il marker remoto `.bookwriter/sync.json` al **successivo** tentativo soltanto se riutilizzava lo stesso `operationId` durabile in outbox. Un push manuale, con ID temporaneo, perdeva questa possibilità in un nuovo click.

## Decisione

1. Conservare lo stesso protocollo: push con un unico `PATCH force:false`, senza ripetizione implicita. Una risposta valida continua a richiedere `patched.object.sha === commit.sha` **e** una rilettura esatta della HEAD (ADR 0083). Risposte HTTP 2xx incomplete o incoerenti, HTTP 409/422 e altri conflitti certi continuano a essere rifiutati, senza tentare un recovery permissivo.
2. Soltanto quando **la richiesta PATCH stessa** fallisce ambiguamente (`GitHub non raggiungibile` per errore di trasporto, oppure HTTP 5xx), `pushGitHubBook` effettua la verifica read-only, nell'ordine: (a) GET della HEAD e confronto con `commit.sha` creato dalla chiamata, (b) GET del commit esatto e confronto del messaggio con `bookwriter: sync <operationId>`, (c) GET di `.bookwriter/sync.json?ref=<commit.sha>` e parsing `operationId`, `bookId`, `sourceRevision`. Tutti e tre devono coincidere; in questa stessa chiamata, `sourceRevision` deve anche essere uguale a `current.updatedAt` dello snapshot appena pubblicato.
3. In caso di prova positiva, registrare l'ACK con `persistRemoteAcknowledgment`, che conserva l'atomicità `books+outbox`, la baseline pre-PATCH e ogni checkpoint locale nuovo. Restituire `recovered:true` e il commit/operazione originali anche a un push **manuale**. Nessun nuovo POST, PATCH, ref aggiornato forzatamente o spesa AI.
4. Se manca una qualsiasi prova (HEAD vecchia/estranea, messaggio o marker falso, rete irraggiungibile, marker incompleto), propagare l'errore PATCH originario senza ACK. L'outbox non deve essere cancellata e il book non deve riportare `lastSyncedCommit` fittizio. In questi casi gli errori sono ancora ambigui: il test non deve promettere certezza remota dove non c'è.
5. Riutilizzare una piccola routine interna `matchingPublishedMarker` anche nel **recovery già esistente al retry** con `options.operationId`. Il retry conserva la capacità di riconoscere in sola lettura un commit su HEAD non coincidente con la baseline locale, senza nuovo PATCH. Non modificare i protocolli dei lease del writer AI.

## Test e portata

Vitest con simulatore GitHub stateful per: PATCH perso prima/dopo l'applicazione, HTTP 503 dopo il commit, HEAD estranea, marker `operationId`/`bookId`/`sourceRevision` falsi o assenti, messaggio estraneo, readback perso e HTTP 409 certo. Verificare **un solo PATCH**, nessun altro POST/PATCH durante il recovery, ACK/outbox invariati se l'esito non è dimostrato, e conferma del push manuale se invece il server lo ha applicato. E2E desktop/mobile con due tab: un primo 2xx che non muove HEAD viene rifiutato (ADR 0083), poi PATCH applicato con ACK perso e checkpoint scritto da altra tab; l'ACK recuperato mantiene il lavoro nuovo.

**Non è una transazione distribuita** GitHub–IndexedDB: HEAD e marker possono essere verificati solo in un istante e un altro dispositivo può avanzare dopo. Un browser interrotto prima del recovery manuale perde ancora l'operationId generato nel processo; questo ADR non introduce una coda manuale persistente. Restano aperti fencing cross-device, commit HTTP/IndexedDB separati, dispositivi fisici, import ZIP remoti e gestione semantica dei conflitti.
