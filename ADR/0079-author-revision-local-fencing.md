# ADR 0079 — Richieste di revisione dell'autore protette da Web Lock e CAS locale

- **Stato:** accettato per v0.11.47
- **Data:** 2026-11-09
- **Issue di consegna:** [#83](https://github.com/KeyserDSoze/BookWriter/issues/83)
- **Epic ancora aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **Precedenti:** ADR 0007, 0077, 0078

## Contesto

Il feedback dell'autore può trasformare l'intero stato del libro: aggiunge `authorConstraints`, imposta `revision` con un nuovo ID, transiziona a `phase=revision` e `status=paused`. Prima della v0.11.47, `requestRevision` leggeva il record, verificava che non fosse `running` e lo riscriveva con `saveBook`, ma **non coordinava la modifica con la sessione AI Web Locks** e non confrontava la revisione mostrata all'utente. Una seconda scheda con un libro obsoleto poteva produrre una perdita di checkpoint o canon tra lettura e scrittura.

## Decisione

1. Il submit del feedback passa il `current.updatedAt` **visualizzato dalla scheda** come parametro obbligatorio `expectedUpdatedAt`; i vincoli vuoti vengono rifiutati prima di acquisire il lock, e quelli accettati vengono normalizzati con `trim`. Un token assente non è un'autorizzazione a scrivere.
2. Prima di rileggere IndexedDB, la funzione richiede in modalità **non bloccante** il Web Lock esclusivo `bookwriter:writer:<bookId>`, identico a quello detenuto per tutto l'autopilot. Senza API Web Locks o se un writer lo detiene, nessuna mutazione, e messaggio in italiano. Non adottare fallback basati su mutex in memoria o flag `localStorage`.
3. Dentro il lock, la funzione rilegge il record del libro, confronta `updatedAt` con il token visualizzato, e rifiuta lo stato `running`, la redazione attiva o le scene fuse in attesa di conferma, preservando i messaggi preesistenti. Solo dopo queste verifiche aggiunge un vincolo e avvia la revisione.
4. Il commit usa `saveBook(book, true, expectedUpdatedAt)`, che esegue un **secondo controllo dentro la stessa transazione IndexedDB `books+outbox`**. Se un writer non cooperativo ha cambiato lo stato dopo la lettura, il save fallisce senza alterare libro, outbox o attività. Non inventare merge automatici e non riprovare una modifica stale.
5. Sul rifiuto, l'interfaccia esegue un `refresh` del libro ma mantiene nel campo il **testo del feedback non accettato**. Svuota il campo **soltanto** dopo un salvataggio completato; l'autore può confrontare lo stato corrente e inviare consapevolmente una nuova richiesta.

## Verifiche e compromessi

Vitest su richiesta valida, testo vuoto, Web Locks assente/occupato, revisione stale senza effetti collaterali, stato `running`, redazione/scene fuse e due submit con lo stesso token. Playwright su due schede reali desktop/mobile: prima revisione, submit della scheda obsoleta rifiutato senza perdita del testo, blocco di un writer attivo e retry soltanto dopo rilascio. TypeScript, smoke, build, CI browser e Pages devono risultare verdi sulla stessa HEAD di `main`.

**Portata:** è il fencing delle **richieste di revisione**, non del resto delle modifiche manuali. L'IndexedDB locale è condiviso solo fra schede dello stesso origin/browser: lo SHA e il lease GitHub non compongono una transazione distribuita con IndexedDB e non garantiscono sincronizzazione fra dispositivi. Ulteriori editor, casi di sospensione su dispositivi mobili fisici e conflitti canon rimangono nelle epic aperte.
