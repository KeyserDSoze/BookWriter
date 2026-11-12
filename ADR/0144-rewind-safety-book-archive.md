# ADR 0144 — ZIP di sicurezza verificabile, libro corrente isolato, prima del rewind

- Stato: accettato per protezione **preparatoria**, non funzionalità di rewind
- Data: 2026-11-12
- Issue: #170, parent #158; dopo ADR 0140–0143

## Contesto

Il backup standard `createBackup("content")` esporta l'intera libreria, con letture successive non atomiche di libri/attività/merge drafts. Prima di introdurre un futuro rewind serve poter conservare una copia **coerente del solo libro corrente** senza includere per sbaglio altri libri, credenziali o copie private opt-in `meta`. Uno ZIP soltanto generato in memoria non attesta che l'autore abbia salvato il file sul dispositivo. Le versioni delle sole scene canoniche #167 **non** ricostruiscono il progetto storico e non sostituiscono il backup del canone corrente.

## Decisione

1. `prepareBookSafetyBackup(bookId,expectedRevision,activityId)` è azione volontaria nella scheda task, con `navigator.locks.request("bookwriter:writer:"+bookId,{ifAvailable:true})` obbligatorio e fail-closed. Non procedere se lock non ottenibile, assente, se `BookProject.status==="running"`, `updatedAt` diverso dalla revisione attesa, libro non presente o task estraneo. Leggere `books+activities+mergeDrafts` **in una sola transazione readonly**, filtrando gli ID ai dati del libro selezionato. Rifiutare race CAS prima del completamento. Non mutare né importare alcun BookProject.
2. ZIP in formato esistente `bookwriter-backup` versione 1, `mode:"content"`, due file `manifest.json` e `content.json`. Comprende intero BookProject corrente, Activity e mergeDrafts del libro, con output privato, note e segreti **narrativi**: contenuto sensibile **non cifrato**. Esclude app settings, chiavi API, file di altri libri e tutto lo store `meta` (snapshot prose, consent, traces, tombstones, limiti); mai aggiungere ZIP a outbox, GitHub o prompt. Validare con `readBackup` che applica lo schema, i limiti ZIP di 40 MiB e raw di 80 MiB, e ricontrollare identità/revisione/contatori. Calcolare impronta SHA-256 **dei byte ZIP finali**.
3. Solo il pulsante «Genera e scarica ZIP di sicurezza del libro corrente» avvia il download. La UI mostra hash, bookId, revisione e conteggi verificati in memoria, **non** dichiara ancora verificato il file fisico. La selezione successiva «Verifica ZIP scaricato» rilegge bytes da un `File` scelto dall'autore, ricontrolla size/digest/schema/bookId/revisione/activityId/conteggi e quindi segnala **File scaricato verificato**. Il file è custodito dall'utente, non viene caricato, e lo stato volatile viene azzerato su cambio task/libro. Non salvare automaticamente impronte o file in IDB per evitare duplicazioni.
4. Un backup corrente non ricostruisce capitoli al momento di un task storico; import manuale segue le protezioni precedenti di `importBackup`, creando una **copia nuova** con autorizzazioni AI sensibili revocate, mai sovrascrivendo il canone. La verifica di un file non è consenso al rewind e non concede patch/undo/fork, non certifica dependences, freeze o lease multi-dispositivo. Parent #158 rimane aperta.

## Evoluzione successiva — ADR 0145 / #171

La generazione/validazione ZIP #170 **da sola** non crea fork, autorizzazioni o restore. [ADR 0145](0145-supervised-current-book-fork.md) introduce **solo dopo** rilettura del file e due gesti espliciti la possibilità di creare una **copia locale non distruttiva dello stato corrente**, con CAS atomico nel write transaction e protezioni import esistenti; non recupera il passato.

## Limiti e verifiche

- Un'altra scheda può mutare dati non rispettando le Web Locks: le revisioni vengono controllate prima e dopo la preparazione, ma senza una transazione di scrittura o lock distribuito non si certificano salvataggi remoti dopo la verifica. Se un file viene cancellato o modificato dopo la verifica, il badge precedente non è una garanzia. Non promettere copertura delle snapshot `meta`.
- Vitest fake IndexedDB: isolamento libri/audit/merge drafts, round-trip ZIP content-only/import come copia, digest SHA, tampering, lock assente/occupato, CAS stantio/running, impossibilità di alterare canone. Playwright desktop/mobile con download e nuovo input file reale, pulizia su cambio task/libro. Chiusura #170 solo con Frontend CI TypeScript/Vitest/smoke/build, 4/4 Playwright shard, EPUBCheck 4/4, Pages e cleanup tutti **completed/success sulla stessa HEAD**.
