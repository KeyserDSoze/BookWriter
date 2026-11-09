# ADR 0100 — Recupero supervisionato dei checkpoint editoriali invalidi

- **Stato:** accettato per v0.11.68
- **Data:** 2026-11-09
- **Issue:** [#105](https://github.com/KeyserDSoze/BookWriter/issues/105)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0099](0099-complete-editorial-review-checkpoint-gate.md), [ADR 0011](0011-independent-editorial-board-and-chapter-freeze.md)
- **Procedura:** [docs/editorial-checkpoint-recovery.md](../docs/editorial-checkpoint-recovery.md)

## Contesto

La #104 impedisce di proseguire da rapporti editoriali senza coverage/freschezza adeguate. Tuttavia la procedura `reopenChapterReview` autorizza soltanto capitoli congelati senza ciclo attivo o redazioni `blocked` dopo tre tentativi. In una review attiva `review`, `adjudicate` o `summary` invalidata da rapporti legacy, duplicati o staleness, l'autore non disponeva di un'azione non distruttiva per ripartire. È necessario conservare l'intero audit, non trasformare un rapporto non giudicato in un verdetto fittizio, e non cancellare il canone o i capitoli precedenti.

## Decisione

1. Esporre `editorialRecoveryProblem(book)` usando esattamente il gate `assertEditorialReviewCoverage` attuale e mostrando la ragione all'autore. Solo checkpoint **invalidi** nelle fasi `review/adjudicate/summary` possono mostrare l'azione `Recupera checkpoint e ricomincia`; `repair`, `blocked`, nessun ciclo e checkpoint validi continuano a seguire il flusso ordinario.
2. Richiedere un **consenso esplicito** tramite conferma modale con informazioni sulle chiamate AI da ripetere, backup e autosync. `recoverEditorialCheckpoint(bookId,confirmed)` rifiuta il falso consenso; usa i Web Locks già richiesti alla riapertura ordinaria (writer e outbox), verifica che non vi siano processi attivi, che il checkpoint sia ancora invalido e che `updatedAt` non sia variato.
3. Persistire una copia `structuredClone` **integrale** del ciclo precedente con data, capitolo e motivo in `BookProject.editorialRecoveryArchives`, **non** in `editorialRounds`: il ciclo può non avere un giudizio. Limite massimo di **otto** snapshot, validato anche nello schema di backup: al raggiungimento del limite rifiutare il recupero senza rimuovere vecchi rapporti. Nessun evento/timestamp viene inventato nel contenuto dei report.
4. In un'unica transazione IndexedDB scrivere nuovo `createEditorialCycle(chapterId)`, stato `paused/chapterReview`, `remote.autoSync=false`, nuova Activity di audit e eliminazione outbox. Il testo, la memoria, la struttura dei capitoli, i freeze anteriori e la cronologia originale restano immutati. Ripartire dal primo revisore soltanto quando l'autore preme `Riprendi`, senza nuove chiamate automatiche né backend.
5. Mostrare nel pannello la lista degli snapshot recuperati con timestamp, report e JSON completo consultabile. Il backup ZIP content-only o full mantiene l'archivio tramite `backup.ts`; i segreti del vault non vanno inseriti negli snapshot e l'archivio non va interpretato come prova crittografica di correttezza.

## Test e limitazioni

Vitest verifica recupero valido, consenso, blocco durante running e fasi non recuperabili, lock, archivio pieno, report `pass` stale, report/scene invariati, outbox e ZIP. Playwright desktop/mobile crea un checkpoint legacy/incompleto in IndexedDB, annulla e conferma il dialog, osserva i vecchi rapporti nell'archivio e verifica **zero chiamate AI** prima della ripresa. CI, EPUBCheck sui quattro libri, Pages e cleanup devono essere tutti `completed/success` sulla HEAD finale.

Il recupero non prova che i dodici revisori abbiano ragionato indipendentemente, non riporta automaticamente a una versione precedente del testo e non corregge problemi di Unicode malformato o di prosa in sé. Se l'origine è nel testo, va corretta prima della nuova review; un backup ZIP è raccomandato.
