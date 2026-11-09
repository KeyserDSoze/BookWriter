# ADR 0087 — Riconciliazione storica lineare e limitata dei push manuali GitHub

- **Stato:** accettato per v0.11.55
- **Data:** 2026-11-09
- **Issue:** [#91](https://github.com/KeyserDSoze/BookWriter/issues/91)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0082, 0083, 0084, 0085, 0086

## Problema

Con ADR 0086 l'autore può verificare manualmente un precedente `ManualPushIntent` rimasto sospeso quando la repository o la baseline locale sono cambiate. La verifica era però limitata al caso in cui il **commit originale coincidesse con HEAD** sul branch di origine. Dopo un ulteriore push di un altro dispositivo sullo stesso branch, la HEAD contiene un commit diverso: il vecchio tentativo è un antenato effettivo, ma il protocollo lo rifiuta e lascia il promemoria bloccato.

Non è sicuro cercare soltanto un messaggio `bookwriter: sync <operationId>` in una lista di commit non ancorata alla HEAD, o fidarsi del marker alla HEAD di un altro writer. Serve dimostrare una **catena di antenati Git** dal ref corrente al commit originario e poi al suo parent atteso, prima di cancellare un record locale.

## Decisione

1. `verifyPublishedManualPush(intent)` legge la HEAD esatta della **destinazione originaria**, non della repository attuale del libro. Segue con `GET /git/commits/<sha>` i parent Git uno per volta **a partire dalla HEAD**, per **massimo 32 commit**.
2. Ogni commit visitato deve avere un **singolo parent** con SHA Git valido, non già visto. In presenza di merge a più parent, root o metadati malformati, loop o chain oltre il limite, il protocollo si ferma **fail-closed**. Non usa `compare`, non controlla un ref di un'altra branch e non può scegliere un parent arbitrario di merge.
3. Quando il messaggio di un commit sulla catena coincide **esattamente** con `bookwriter: sync <operationId>`, richiede che il suo unico parent corrisponda alla `baseSha` memorizzata, se esiste. Il candidato deve essere quindi un **figlio diretto della vecchia baseline**, sebbene possa essere antenato della HEAD attuale.
4. Il marker `.bookwriter/sync.json` viene letto esplicitamente con `ref=<SHA del commit candidato>`, **non** con `ref=HEAD`. Si controllano esattamente `operationId`, `bookId` e `sourceRevision`; se manca una prova, la verifica fallisce. Se si incontra il parent originario senza aver trovato l'operazione, la ricerca termina senza archiviarla.
5. Dopo l'evidenza completa, una **seconda GET della HEAD** deve tornare lo stesso SHA iniziale. Se il branch è cambiato durante le letture, nessuna cancellazione viene autorizzata. `verifyPublishedManualPush` restituisce lo **SHA del candidato storico**, non quello della nuova HEAD, così la UI non può attribuire al vecchio writer il commit di un altro dispositivo.
6. La transazione locale rimane quella di ADR 0086: consenso autore, Web Locks writer→outbox e CAS `books+meta`. Si elimina **solo** il vecchio intento durabile provato; non si aggiornano libro, canone, `lastSyncedCommit` della nuova repository, outbox o credenziali. Un ref che cambia **dopo** la seconda GET non viene protetto da un lock remoto distribuito, quindi non promettiamo atomicità GitHub→IndexedDB.
7. Il normale push e il suo recovery immediato (ADR 0084) **non** usano la ricerca storica: continuano a richiedere HEAD identica al commit appena creato. Solo la riconciliazione umana esplicita può verificare un antenato storico.

## Test

Vitest su commit candidato a uno e due antenati dalla HEAD, marker letto **allo SHA storico**, seconda HEAD immutata, marker falso/mancante, messaggio estraneo, parent non corrispondente, merge, loop, SHA malformato, baseline raggiunta senza operazione, limite di 32 commit e rete indisponibile; nessun POST/PATCH. Playwright desktop/mobile con due schede reali: una modifica il romanzo corrente, mentre la prova vede un secondo commit GitHub dopo l'operazione vecchia; primo marker falso rifiutato, poi prova valida e archiviazione soltanto dell'intento.

**Fuori portata:** ramificazioni con merge, cronologia oltre i 32 commit, commit raggiungibile solo da un altro ref, analisi della storia riscritta, conflitti cross-device su canon e atomicità HTTP–IndexedDB. Non sono motivi per resettare automaticamente l'intento: rimangono per revisione guidata nelle epic #10/#3.
