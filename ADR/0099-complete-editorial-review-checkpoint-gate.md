# ADR 0099 — Gate di copertura integrale dei rapporti di redazione

- **Stato:** accettato per v0.11.67
- **Data:** 2026-11-09
- **Issue:** [#104](https://github.com/KeyserDSoze/BookWriter/issues/104)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0011](0011-independent-editorial-board-and-chapter-freeze.md), [ADR 0032](0032-literal-narrative-evidence-gate.md), [ADR 0098](0098-grapheme-safe-editorial-segmentation.md)

## Problema

`nextReviewSlot` sceglie il prossimo ruolo calcolando il rapporto fra `cycle.reports.length` e il numero dei segmenti. Se i report fossero importati, ripresi dopo un'interruzione, duplicati, riordinati o divenuti obsoleti dopo una modifica della scena, `reports.length` potrebbe risultare corretto pur mancando una revisione. Per un rapporto `pass` senza finding né evidenceAnchor, non c'era neppure un identificatore di freschezza del testo letto. Il giudice e il freeze non devono basarsi su una falsa copertura.

## Decisione

1. `validateReport` registra `segmentTextStamp` come lunghezza UTF-16 e FNV-1a 32 bit dell'esatto testo del segmento corrente. L'impronta è **non crittografica e non autenticante**, usata per intercettare modifiche accidentali: non è prova di esecuzione del modello. Non duplicare la prosa né inviare chiamate AI extra. Il campo è opzionale nell'interfaccia di archivio per conservare lettura ZIP/IndexedDB legacy, ma **obbligatorio** per riprendere la review attiva.
2. `assertEditorialReviewCoverage(book,cycle,requireComplete)` deve ricostruire il capitolo vivo e confrontare ogni rapporto del prefisso con lo slot `EDITORIAL_ROLES[roleIndex]` + segmento `slot % segmentCount`. Verificare round, Zod verdict/pass/findings, ruolo, indice e numero dei segmenti, `createdAt`, checksum, ID finding univoci nell'intera tornata, scene e citazioni con ancore locali attuali; fallire se i report eccedono 12×N.
3. `nextReviewSlot` richiama il gate su prefisso per **qualsiasi** passaggio ai revisori successivi. `AutopilotRunner` richiede matrice **completa** (12×N) e valida prima di emettere la richiesta al giudice, prima di applicarne la risposta, prima di ogni chiamata di sintesi e prima del commit delle sinossi/freeze. Revalidare sul libro appena caricato: un checkpoint mutato dopo la chiamata LLM non può attivare il giudizio favorevole.
4. Il controllo deve essere **fail closed** con errore comprensibile, senza deletions di reports, canone o segreti, sincronizzazioni GitHub, tentativi AI aggiuntivi o freeze arbitrario. Non trattare dati legacy attivi senza impronta come freschi. I report storici rimangono leggibili e non sono migrati con firme inventate.
5. Ottimizzare ricalcolo delle impronte **una volta per segmento**, non una volta per rapporto, per limitare il costo per capitoli lunghi. Nessuna libreria esterna, backend, schema ZIP distruttivo né segreti aggiunti ai prompt dei lettori.

## Prove e limiti

Unit test Vitest su 12×2 ruoli/segmenti, report `pass` mutato, ordine, duplicati, timestamp, ID, anchor stale, legacy senza checksum e report extra. E2E Playwright desktop/mobile con checkpoint `adjudicate` incomplete: **zero chiamate LLM, zero freeze**, audit mantenuto. La chiusura richiede TS, Vitest, smoke, build, Playwright desktop/mobile, matrice EPUBCheck W3C, Pages e cleanup tutti verdi sulla stessa HEAD.

Una matrice completa non dice se i dodici agenti abbiano ragionato indipendentemente né che i rilievi siano corretti: il direttore continua a poter respingere critiche infondate con motivazione, e il libro può necessitare ulteriori interventi umani. Un autore o script con accesso completo al checkpoint può riscrivere sia la prosa sia l'impronta FNV: non si rivendica resistenza alla manomissione deliberata.
