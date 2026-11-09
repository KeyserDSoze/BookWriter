# ADR 0103 — Recupero supervisionato di remediation non riprendibili

- **Stato:** accettato per v0.11.71
- **Data:** 2026-11-09
- **Issue:** [#108](https://github.com/KeyserDSoze/BookWriter/issues/108)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0099](0099-complete-editorial-review-checkpoint-gate.md), [ADR 0100](0100-author-confirmed-editorial-checkpoint-recovery.md), [ADR 0101](0101-live-historical-sources-at-editorial-gates.md), [ADR 0102](0102-live-prior-narrative-witnesses.md)

## Problema

Il runner rifiuta correttamente un `repairPrompt` con fonte ritirata, giudizio non più autorizzato o prova narrativa obsoleta sia prima di chiamare il modello sia al momento di applicare la risposta. Ma il recupero supervisionato #105 non era disponibile in `stage=repair`, creando un blocco senza via di uscita.

## Decisione

1. Il recupero può apparire soltanto quando la prossima remediation è **non eseguibile**. `editorialRecoveryProblem` richiede un giudizio con `verdict=repair`, cursore valido e prossima scena fra le correzioni accettate. Richiama `repairPrompt`, lo stesso gate live usato dal runner, **senza rete**.
2. **Prima della prima riscrittura** verificare anche `assertEditorialReviewCoverage(...,true)`: un giudizio incompleto o vecchie citazioni non possono sbloccare una correzione. **Dopo almeno una riscrittura** i timbri dei vecchi report possono essere obsoleti intenzionalmente; non utilizzare la matrice come prova di errore, ma rivalidare solo il prossimo `repairPrompt`. Le remediation sane proseguono.
3. Riutilizzare invariata `recoverEditorialCheckpoint` di #105: conferma autore, Web Locks writer/outbox, CAS `updatedAt`, limite otto archivi, snapshot integrale con giudizio e `repairCursor`, transazione `books+activities+outbox`, disabilitazione autosync. Non toccare testo, memoria, fonti, stati `draft`, freeze o canone; le riparazioni già salvate **non vengono annullate**. Dopo il recupero la redazione riparte solo su click `Riprendi` dal primo dei dodici revisori.
4. `blocked` e `reconcile` restano fuori dall'azione; nessuna attestazione, consenso AI o giudizio viene inventato o ereditato dal nuovo ciclo.

## Verifiche e limiti

Vitest: repair valido (prima/dopo un edit), fonte ritirata al secondo repair, matrice incompleta, cursor/giudizio mancanti, consenso, archive pieno, testo draft immutato. Playwright desktop/mobile: giudizio `repair` con 12 report ma fonte ritirata; blocco prima della chiamata AI, conferma annullabile, archivio integrale e ripartenza senza push. CI, EPUBCheck, Pages e cleanup devono risultare verdi su main.

Il recupero non è un rollback, non certifica correttezza del testo esistente e non corregge una fonte mancante o un canon malformato. La nuova review deve valutare criticamente ogni scena e l'autore è invitato a salvare prima un backup ZIP.
