# Copertura e freschezza dei rapporti prima del giudizio (v0.11.68)

La redazione di BookWriter produce un rapporto indipendente per ognuno dei **sette specialisti** e **cinque lettori** su ciascun segmento del capitolo. Solo dopo questa fase il direttore editoriale può scegliere se accettare o respingere motivatamente i rilievi. Prima della v0.11.67 il runner considerava conclusa la fase quando il numero dei report coincideva con il numero atteso; un checkpoint interrotto/importato o manomesso poteva però contenere duplicati oppure ruoli e segmenti sbagliati.

## Cosa controlla BookWriter

- **Matrice completa:** 12 ruoli × il numero di segmenti, nell'ordine deterministico dei revisori. Ogni rapporto deve avere `role`, `segmentIndex`, `segmentCount`, data valida e un esito `pass/issues` coerente con i finding.
- **Impronta del testo letto:** i rapporti nuovi includono `segmentTextStamp` della prosa di quel preciso segmento, anche quando il revisore dice `pass`. Una modifica alla scena dopo la sua lettura rende il rapporto non più aggiornato. Questa impronta è una checksum locale **non crittografica**, non garantisce l'autenticità del rapporto e non costituisce prova che il modello abbia effettivamente eseguito una review indipendente.
- **Evidenze verificabili:** finding con ID, scena e citazione letterale devono essere coerenti con il segmento corrente e con l'ancoraggio archiviato. Un duplicato o una prova cambiata blocca il processo.
- **Gate ripetuti:** prima di inviare il prossimo segmento a un revisore, prima di chiamare il giudice, prima di applicare il suo verdetto e **prima del freeze**. L'esito è sempre calcolato sul libro corrente, così non vengono avallati checkpoint diventati obsoleti.

## Recupero supervisionato di checkpoint invalidi (v0.11.68)

Se il gate ferma una review attiva nelle fasi di revisione, giudizio o sinossi, il pannello presenta **Recupera checkpoint e ricomincia** con spiegazione del problema. L'autore può annullare oppure confermare. La conferma archivia l'intera sessione (inclusi report, verdetti e tornate precedenti) e crea una nuova review, senza modificare la prosa o i capitoli già congelati. L'archivio resta consultabile nel pannello e nel backup ZIP, fino a otto recuperi; non viene mai cancellato automaticamente per liberare spazio.

Prima del recupero conserva un backup ZIP. Dopo la conferma **autosync è spenta**, l'outbox remota è svuotata e i nuovi 12 revisori richiederanno nuove chiamate AI soltanto quando premi Riprendi. I checkpoint validi, i cicli in `repair` o `blocked` e le redazioni già finite non vengono azzerati tramite questa azione. Il comando non permette di ignorare il giudice o forzare il freeze.

[Procedura dettagliata](editorial-checkpoint-recovery.md), [ADR 0100](../ADR/0100-author-confirmed-editorial-checkpoint-recovery.md), [issue #105](https://github.com/KeyserDSoze/BookWriter/issues/105).

## Se il libro si ferma

Un errore che menziona «checkpoint redazionale obsoleto», «fuori ordine» o «redazione incompleta» indica che BookWriter **non può dimostrare** la copertura prevista con i dati presenti. Il sistema non deve cancellare rapporti, sostituire il canone né pagare altre chiamate AI tentando riparazioni automatiche. Conserva un backup ZIP, controlla le modifiche intervenute e **riavvia la revisione editoriale del capitolo sotto supervisione dell'autore** con gli strumenti di riapertura/revisione disponibili. Non usare la vecchia conferma del giudice per forzare il freeze.

I vecchi rapporti senza `segmentTextStamp` **rimangono visibili** negli archivi: l'assenza dell'impronta impedisce soltanto di trattarli come un controllo nuovo e corrente quando occorre avanzare automaticamente. Anche una review formalmente completa non certifica che i rilievi siano veri: il direttore editoriale e l'autore devono considerarne il merito, i segreti, i punti di vista, la cronologia e le fonti.

## Per chi sviluppa

`src/frontend/src/domain/editorial-board.ts` contiene `editorialSegmentTextStamp`, `assertEditorialReviewCoverage`, `validateReport` e `nextReviewSlot`. `src/frontend/src/application/autopilot.ts` applica il gate prima del giudice, dell'applicazione del verdetto e dei riepiloghi congelabili. Unit test: `editorial-coverage-gate.test.ts`; E2E desktop/mobile: `editorial-coverage-gate.spec.ts`. Nessuna nuova dipendenza, chiamata LLM o backend.

[ADR 0099](../ADR/0099-complete-editorial-review-checkpoint-gate.md) · [Issue #104](https://github.com/KeyserDSoze/BookWriter/issues/104) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
