# ADR 0088 — Prova bounded di commit Git storici attraverso merge binari

- **Stato:** accettato per v0.11.56
- **Data:** 2026-11-09
- **Issue:** [#92](https://github.com/KeyserDSoze/BookWriter/issues/92)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0082, 0084, 0085, 0086, 0087

## Problema

La v0.11.55 permette all'autore di riconciliare un `ManualPushIntent` sospeso anche quando il suo commit non è più la HEAD, ma solo se dalla HEAD il commit è raggiungibile su una catena **strettamente lineare** di parent. Un merge Git binario successivo alla pubblicazione interrompeva l'esame pur lasciando il commit originario realmente raggiungibile dal branch. Scegliere solo il primo parent di un merge sarebbe scorretto: un vecchio tentativo potrebbe trovarsi sul secondo ramo, oppure il DAG potrebbe contenere due commit che fingono di essere la stessa operazione.

## Decisione

1. Cambiare esclusivamente la routine read-only `verifyPublishedManualPush(intent)`, già invocata solo dalla riconciliazione esplicita dell'autore (ADR 0086). Dalla HEAD della repository e branch originali, esaminare tramite `GET /git/commits/<sha>` **entrambi i parent** dei merge Git standard a due parent. Sono ammessi anche commit lineari a un parent e root a zero parent su rami indipendenti. Nessun `compare`, POST/PATCH, force push o ricerca in altri branch.
2. Imporre un limite di **32 oggetti commit distinti visitati in totale**, indipendentemente dal numero di rami. Ogni SHA/parent deve essere valido; rifiutare parent duplicato, self-parent, ciclo nel grafo, ref/oggetto mancante, merge con tre o più parent, o superamento del budget. Non trattare la visita ripetuta di un antenato condiviso come ciclo: ricostruire il grafo dei parent visitati e verificare un ciclo effettivo tramite DFS con stati `active` e `finished`.
3. Trattare `intent.baseSha` come confine di verifica: nessun commit prima della baseline originale è necessario per provare il tentativo; non si legge il commit della baseline. Ogni ramo raggiungibile **sopra** tale confine deve però essere completamente esaminato entro il budget. Una prova incontrata su un ramo non permette di interrompere la verifica degli altri rami.
4. Accettare **un solo commit candidato** il cui messaggio sia esattamente `bookwriter: sync <operationId>`, con **unico parent** uguale alla `baseSha` dell'intento se nota. Il marker `.bookwriter/sync.json` deve essere richiesto con `ref=<sha del candidato>` e attestare esattamente `bookId`, `operationId`, `sourceRevision`. Una seconda occorrenza dello stesso messaggio in un altro ramo, marker mancante/malformato, parent diverso o commit irraggiungibile dalla HEAD annullano tutta la prova, senza cancellazioni locali. Il candidato originale rimane distinto dalla HEAD di merge del secondo dispositivo.
5. Soltanto dopo **l'ispezione completa** del DAG bounded, la verifica di assenza di cicli e la conferma dell'unicità, rileggere via GET la HEAD e richiedere **lo stesso SHA iniziale**. Se varia, fail-closed. Restituire lo SHA **storico** del candidato per l'archiviazione dell'intento.
6. L'use case `reconcileSuspendedManualPush` resta immutato: `window.confirm` dell'autore in UI, Web Locks writer→outbox, CAS transazionale `books+meta`, rimozione soltanto del `ManualPushIntent` verificato; nessuna modifica a libro, canon, remote, outbox o PAT. Il push ordinario e il recovery immediato di ACK incerto **non** adottano questa ricerca storica: esigono ancora HEAD identica al commit appena pubblicato.
7. L'interfaccia aggiorna il testo per spiegare che può ispezionare merge Git **binari** entro il budget e che l'archiviazione non esegue una fusione dei manoscritti.

## Verifiche

Vitest con commit candidato su primo o secondo ramo di merge, merge annidato, marker allo SHA storico e due GET della HEAD; errori per candidato duplicato, marker falso, parent iniziale errato, ciclo, self-parent, parent duplicato, octopus merge, ramo mancante, storia oltre 32 oggetti, cambio HEAD durante GET, commit estraneo e rete assente. Il test Playwright desktop/mobile usa **due schede** e una HEAD che punta a un merge a due parent; la prima prova con marker non valido non archivia e la seconda, valida, cancella solo il record di `meta` dopo conferma esplicita. Nessuna richiesta HTTP non-GET.

**Limiti espliciti:** 32 è un limite prudenziale **globale di commit** e può bloccare cronologie valide molto grandi; merge octopus, storia riscritta, altri ref o commit mancanti richiedono review guidata. La doppia lettura HEAD non blocca un altro dispositivo dopo la verifica. GitHub e IndexedDB non condividono una transazione, quindi i problemi di fencing e sincronizzazione distribuita restano nelle epic #10/#3.
