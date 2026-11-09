# ADR 0102 — Rivalidazione dei testimoni narrativi precedenti nei checkpoint

- **Stato:** accettato per v0.11.70
- **Data:** 2026-11-09
- **Issue:** [#107](https://github.com/KeyserDSoze/BookWriter/issues/107)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0042](0042-attested-contextual-editorial-witnesses.md), [ADR 0044](0044-unattested-prior-scene-witnesses.md), [ADR 0099](0099-complete-editorial-review-checkpoint-gate.md), [ADR 0101](0101-live-historical-sources-at-editorial-gates.md)

## Problema

Un rapporto `continuity/timeline/secrets/characterVoice` può marcare una testimonianza precedente `narrativeConflict` (evento esplicitamente attestato dall'autore) o `priorSceneConflict` (citazione non attestata di una scena congelata). `validateReport` verifica il testimone quando nasce; `validateJudgment` ricontrolla prima di **accettare** una correzione. Ma se l'autore ritira l'attestazione, cambia alias/freeze o modifica una scena precedente, la matrice 12×N può ancora passare il gate di copertura: la scena corrente e i suoi stamp non sono cambiati. Il giudice rischia di discutere un testimone che i revisori attuali non riceverebbero.

## Decisione

1. `assertCurrentNarrativeReviewWitnesses(book,chapter,cycle)` rivalida tutti i finding marcati nei report dell'attuale tornata, senza rete, mutazioni o invio AI. Rifiuta marche da qualsiasi ruolo oltre i quattro specialisti autorizzati e la presenza contemporanea di entrambi i tipi nello stesso finding.
2. Per ciascun finding ricostruisce il **segmento esatto** con `chapterSegments`. Per `narrativeConflict` cerca l'identificatore nel pack corrente `buildAttestedReviewContext(book,chapter,segment.text)`: la ri-validità include decisione autore, provenienza, alias, priorità e campionamento. Il pack si calcola una volta per segmento per evitare lavoro ripetuto. Per `priorSceneConflict` usa `isUnattestedSourceCurrent` sullo stesso segmento, richiedendo freeze, timestamp, offset, testo e selezione lessicale correnti.
3. Il gate entra in `assertEditorialReviewCoverage` dopo la validazione dei report e delle fonti storiche. `nextReviewSlot` e il runner hanno già controlli prima del giudice, verdetto, sintesi e freeze: un testimone ritirato invalida il checkpoint **anche se la scena corrente è intatta**, senza presumere che l'autore abbia autorizzato un nuovo giro. L'azione supervisionata #105 archivia il vecchio ciclo e permette una nuova review solo su conferma.
4. Mantenere `validateJudgment` e `repairPrompt` con i propri controlli live già esistenti per **accettare** una remediation: il nuovo gate non trasforma una testimonianza in fatto o autorizza un fix da solo. Le API dirette di giudizio senza matrice completa restano strumenti di dominio separati; il runner impone la matrice.
5. Nessuna migrazione del formato backup: rapporti e citazioni precedenti rimangono negli archivi, ma non vengono promossi a prova corrente. Nessun backend, endpoint, nuova dipendenza o permesso AI.

## Prove e limiti

Vitest copre matrice 12×1 valida, fonte precedente non attestata modificata/scongelata, attestazione revocata, campo in ruolo non autorizzato, due fonti incompatibili nello stesso finding e assenza di mutazioni. Playwright desktop/mobile inietta un checkpoint completo con freeze precedente cambiato, verifica recupero supervisionato, stop prima del giudice e zero chiamate al provider.

Rimane una prova tecnica di **provenienza e selezione**, non di identità, verità narrativa, cronologia o indipendenza cognitiva dei 12 revisori. Il direttore critica le ipotesi; l'autore sceglie se avviare una nuova review.
