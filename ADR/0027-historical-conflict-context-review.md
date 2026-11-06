# ADR 0027 — Contesto per fonte e decisione critica obbligatoria nei conflitti storici

- **Stato:** Accettato per v0.10.4 (PR #39)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessore:** ADR 0026, oltre agli invarianti di ADR 0011 e 0015

## Problema

La release 0.10.3 verifica che due citazioni appartengano a documenti distinti, ma la presenza letterale di frasi diverse non prova incompatibilità. Persino un agente che indica `supports` e `disputes` potrebbe confondere la pubblicazione di una fonte con la data dell'evento, fasi sperimentali con avvio pubblico, luoghi simili, cronache derivanti dallo stesso originale oppure edizioni diverse. La decisione finale del direttore rimane autonoma, ma non sempre documenta *quali dimensioni abbia controllato*.

## Decisione

1. **Nuovi findings solo con contesto esplicito.** `HistoricalClaim.conflictContext` è facoltativo nel tipo serializzato per preservare report legacy; per ogni NUOVO `assessment=conflicting_excerpts` è però obbligatorio. `sources` contiene una voce per ciascun `sourceId` citato, con `subject`, `period`, `place`, `edition` e `uncertainty`. I primi quattro sono stringhe brevi oppure `null` quando il testo non li determina. Si richiedono motivazioni non vuote e limiti dimensionali per evitare omissioni e payload non controllati.
2. **Identità evento non inventata.** `comparison.eventIdentity` può essere `same|different|unknown` con `rationale`. Se il revisore dichiara `different`, il software rifiuta il rilievo come `conflicting_excerpts`: non è una divergenza sullo stesso fatto. `same` e `unknown` sono **proposte semantiche del modello**, non prove che l'evento sia effettivamente lo stesso. Il revisore può usare `unverified` senza citazioni se manca una base comparabile.
3. **Secondo controllo indipendente.** Ogni decisione del direttore su un finding `conflicting_excerpts` deve includere `conflictReview`: `eventIdentity`, `chronology`, `geography`, `edition`, `independence` e `conclusion`. Le motivazioni sono obbligatorie, anche per respingere. Se il direttore dichiara eventi `different`, non può accettare una remediation basata su quel conflitto. Non è ammesso `conflictReview` su rilievi non di questo tipo.
4. **Compatibilità.** I report di vecchie tornate v0.10.3 restano visibili anche quando mancano `conflictContext` e `conflictReview` e ricevono un avviso in UI. Si valida lo schema dei nuovi output AI, non si riscrive o migra il loro storico. Le attività del capitolo, le decisioni e il freeze seguono l'invariante del direttore già esistente: nessun modello riscrive prosa prima della remediation approvata.
5. **Privacy.** Nessun nuovo servizio, ricerca o chiamata esterna. Il revisore storico usa solo il dossier approvato, il giudice vede il materiale e i rilievi; gli altri undici ruoli non ricevono fonti o contesto. Le nuove schede sono parte dei normali report editoriali/backup, quindi possono raggiungere GitHub solo secondo i consensi e i blocchi già applicati.

## Confini tecnici ed epistemici

- Il software **non** verifica in modo deterministico se una posizione temporale/geografica sia corretta o se due testimoni provengano davvero da originali indipendenti. I controlli sulla presenza di citazioni rimangono testuali.
- Il valore `same` non è prova di identità evento, così come `unknown` non è prova che l'evento sia differente. La classificazione resta fallibile, deve essere criticata dal direttore e, quando necessario, dall'autore.
- I limiti delle licenze, dell'OCR, dei pixel IIIF e della provenienza dei documenti restano identici. Non autorizziamo nuovo fetch e non certifichiamo diritti.

## Accettazione e rilascio

- Testare sourceId mancanti/duplicati, `null` dichiarati, violazioni dei limiti, `eventIdentity=different`, giudice senza `conflictReview` e correzione indebita di eventi differenti.
- Verificare via browser desktop/mobile la visualizzazione del contesto per fonte e della valutazione finale, con compatibilità dei report precedenti.
- Prima del merge: typecheck, Vitest, smoke, build e Playwright sulla HEAD esatta della PR; dopo: CI main, deploy Pages e cleanup branch.
