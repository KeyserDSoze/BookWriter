# ADR 0034 — Convergenza del rewind storico sulla catena cross-chapter

- **Stato:** Accettato per v0.11.1 (PR #47)
- **Data:** 2026-11-06
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20) e [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0033 (catena cross-chapter), ADR 0013–0030 (dossier storici)

## Problema

Nella v0.11.0, `markDownstreamContinuity` collegava solo la riapertura editoriale manuale e la revisione retroattiva dell'autopilot. Le azioni su evidenze storiche (aggiunta, ispezione, collazione, provenienza e quarantena) invalidavano correttamente freeze/sinossi dei capitoli successivi, ma **non** impostavano `continuityRecheck`. Il downstream rimaneva quindi senza origine tracciata per il controllo di continuità e con meno contesto per i revisori. La modifica del dossier storico non implica però una modifica della prosa: confondere le due cause genererebbe affermazioni ingannevoli.

## Decisione

1. Estendere `ContinuityTrigger` con **`historical_evidence`**, esplicitamente distinto da `author_reopen` e `retroactive_revision`. Riutilizzare `markHistoricalEvidenceChanged(book,chapter)` **esclusivamente nei rami di riapertura di un capitolo già congelato**: il helper marca i capitoli successivi già scritti tramite l'algoritmo della v0.11.0 e cancella la vecchia attestazione del capitolo originario. Gli ID di scene restano **vuoti**: una fonte non è un manoscritto modificato. L'origine più antica già pendente prevale e non vengono memorizzati testi dei dossier nel marker.
2. Applicare il helper a **tutte e dodici** le operazioni storiche che già effettuano il rewind: Wikipedia approvata, bibliografia DOI, catalogo LoC, ispezione dei metadati, riferimento IIIF, OCR LoC, quarantena OCR, collazione visiva, estratto manuale attestato, ricerca Wikisource, quarantena Wikisource e dichiarazione di relazione fra fonti. Il comando esistente di invalidazione, gli outbox lock, il preflight di snapshot e i vincoli dell'autore **non vengono bypassati**.
3. Il campione pubblico cross-chapter dei capitoli precedenti viene fornito ai quattro specialisti della continuità **e, solo se il trigger è `historical_evidence`, anche allo specialista storico**. Il direttore lo riceve, ma gli si ricorda espressamente che **gli estratti del romanzo non sono fonti documentali** né rendono vera una pretesa storica. Gli altri sette ruoli (in particolare i cinque lettori ciechi) mantengono i propri confini di contesto. `finding.evidence` resta una citazione letterale del segmento corrente e non dei campioni precedenti.
4. Interfaccia: distinguere `dossier storico modificato` da `modifica narrativa a monte` negli avvisi e nello storico di audit; nessuna attestazione di verità semantica. La rivalidazione richiede ancora predecessori scritti e congelati in ordine.
5. ZIP legacy restano compatibili (campo facoltativo); lo schema di backup accetta il nuovo enum `historical_evidence` e continua a rifiutare trigger arbitrari e istruzioni ostili. Smoke test garantisce che tutti e dodici i rami di rewind storici chiamino l'helper e conservino l'outbox/sinossi. Vitest ed e2e verificano privacy, origini e modelli.

## Privacy, limiti e rischi

- Nessuna richiesta HTTP o AI **aggiuntiva** dovuta al marker. Le azioni di ricerca esistenti restano autorizzate dall'autore e non inviano prosa alle fonti pubbliche. I prompt della review possono crescere: il preflight budget resta invariato.
- Il marker è un **obbligo di review**: aggiungere o escludere una fonte non significa che i capitoli di valle contengano errori, né che una fonte sia indipendente o storicamente autentica.
- La copertura documentale dei campioni è limitata: due scene per origine e ultimo predecessore, finestre letterali con offset. Il revisore storico vede il testo pubblico precedente, non un nuovo dossier riservato e non documenti scaricati automaticamente.
- L'intervento riguarda i dodici use-case storici già dotati di rewind. Altre future modalità di editing/importazione dovranno integrare esplicitamente l'helper e relativi test; nessuna pretesa di copertura universale delle mutazioni.
- I report precedentemente archiviati rimangono leggibili, e la verifica v0.10.9 delle citazioni narrative continua a bloccare remediation da rapporti stale.

## Gate

- Test unitari su origine storica, priorità della modifica più antica, nuovi prompt storico/giudice contro lettori ciechi, audit al freeze, quarantena OCR e manual evidence; test ZIP e smoke sulle dodici integrazioni.
- Playwright desktop/mobile: attesta una relazione locale di provenienza, verifica marker di valle e assenza di chiamate esterne.
- `npm ci`, TypeScript, Vitest, smoke, build, Playwright desktop/mobile sulla HEAD PR; poi merge con SHA atteso, CI main, GitHub Pages e cleanup controllati separatamente.
