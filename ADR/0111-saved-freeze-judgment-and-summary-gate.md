# ADR 0111 — Giudizio freeze salvato rivalidato prima del summary e del congelamento

- **Stato:** accettato per v0.11.79
- **Data:** 2026-11-10
- **Issue:** [#116](https://github.com/KeyserDSoze/BookWriter/issues/116)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Predecessori:** [ADR 0099](0099-complete-editorial-review-checkpoint-gate.md), [ADR 0100](0100-author-confirmed-editorial-checkpoint-recovery.md), [ADR 0104](0104-saved-editorial-judgment-integrity.md)

## Difetto

Il ciclo `chapterReview/summary` rivalidava la copertura 12×N delle recensioni e il solo campo `judgment.verdict === "freeze"`. Un giudizio importato o recuperato con `verdict=freeze` ma decisioni assenti, duplicate, inventate o accettate poteva superare i gate della sintesi fino a `chapter.frozenAt`, benché ogni finding debba ricevere un giudizio critico esatto. `editorialRecoveryProblem` non rilevava la contraddizione e non esponeva il recupero supervisionato.

## Decisione

1. Prima di **ogni** chiamata AI di summary e **dentro** l'apply sul libro corrente, richiedere `assertEditorialReviewCoverage(book,cycle,true)` e `assertSavedEditorialFreezeJudgmentIntegrity(book,cycle)`. Il giudizio persisted deve avere `verdict=freeze`, timestamp valido, schema giudizio valido e decisioni effettivamente coerenti.
2. Non duplicare né indebolire gli invarianti del giudice: su una copia dei dati salvati, chiamare il medesimo `validateJudgment` che rilegge tutte le decisioni contro tutti i finding, i conflitti fra remediation, il dossier storico e i testimoni narrativi/di conoscenza quando pertinenti. Il verdetto **derivato** deve restare `freeze`: qualunque `accept` comporta `repair` e blocca la sintesi. La rivalidazione non muta né aggiorna `createdAt` del giudizio originale.
3. `summaryCursor` deve essere intero sicuro fra 0 e N−1; se punta oltre il primo segmento, esigere sinossi progressive presenti e nei limiti del validatore (non riempire i campi inventando testo). Il controllo non è una firma né può riconoscere una sinossi plausibile ma falsificata: riduce salti accidentali e import incompleti.
4. Il pannello e `editorialRecoveryProblem` usano **lo stesso gate** per proporre il recupero supervisionato #105: consenso autore, Web Locks, CAS, archival completo del ciclo, canone e capitoli congelati intatti, autosync disabilitata e nessuna chiamata AI al recupero.
5. Nessuna nuova chiamata aggiuntiva ai modelli, nessuna migrazione distruttiva, nessuna modifica a segreti, prezzi, prompt di produzione, API provider o struttura dello ZIP. Le vecchie sintesi sane proseguono se già complete e coerenti.

## Verifiche

Vitest su matrice 12×1 e 12×2 sana, decisioni mancanti/duplicate/inventate, `accept` con `freeze`, schema/timestamp, cursore fuori range e sinossi parziali assenti; Playwright desktop/mobile iniettando giudizio freeze contraddittorio con report completi correnti, stop **prima** del provider e recupero esplicito senza perdere prosa o audit. CI, EPUBCheck, Pages e cleanup devono essere verdi sul commit HEAD finale.

## Limiti

Questa verifica è **strutturale e di provenienza**. Una decisione formalmente coerente non dimostra che l'AI abbia interpretato correttamente un anacronismo, un segreto o una contraddizione. La verifica semantica e l'indipendenza effettiva dei revisori rimangono compiti distinti dell'epic #20 e dell'autore.
