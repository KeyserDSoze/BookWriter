# ADR 0126 — Freschezza esatta del dossier per il revisore storico e il giudice

- **Stato:** implementazione su `main`, verifiche finali CI pendenti
- **Data:** 2026-11-11
- **Issue:** [#144](https://github.com/KeyserDSoze/BookWriter/issues/144), epic [#23](https://github.com/KeyserDSoze/BookWriter/issues/23) e [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** [ADR 0028](0028-author-attested-source-dependencies.md), [ADR 0034](0034-historical-dossier-revalidation-convergence.md), [ADR 0124](0124-editorial-reconcile-checkpoint-fence.md), [ADR 0125](0125-autopilot-ai-commit-cas.md)

## Problema

Il software già rivalida le citazioni dei rilievi storici sul dossier **corrente** prima di giudizio e congelamento. Tuttavia non tutti i rapporti contengono rilievi storici: dopo un prompt a revisore storico o giudice, un import/restore può mutare il dossier senza modificare `updatedAt`. Anche un report `pass` può quindi essere approvato come se fosse riferito alle nuove fonti, benché il modello abbia visto altri estratti, revisioni, stati attivi, piste bibliografiche o relazioni di provenienza.

Il confronto CAS sul timestamp (ADR 0125) e la validazione di singole citazioni (ADR 0034) non dimostrano che il **contesto documentale inviato al modello** sia ancora quello esaminato.

## Decisione

1. Alla pianificazione del solo revisore storico (`chapterReview/review`) e del giudice (`chapterReview/adjudicate`) catturare un oggetto **effimero nella closure della richiesta** con capitolo, fase, round, numero report e `JSON.stringify(chapter.historicalDossier ?? null)`. La serializzazione include tutte le fonti archiviate/attive, eventuali relazioni, DOI, LoC, OCR e trascrizioni presenti. Un dossier assente rimane un valore distinto da uno appena inserito.
2. Prima di validare e accettare il report o il verdetto, `assertCurrentHistoricalPromptDossier` rilegge **il libro live**, ricontrolla fase `chapterReview`, capitolo, stage, round e report count, poi confronta esattamente il dossier. Se differisce, la risposta AI è **obsoleta**, senza diritto di creare report, giudizio, freeze o modificare canone; fallire anche con `updatedAt` invariato.
3. Lo snapshot non è persistito in IndexedDB, Activity, outbox, backup né esportato al provider separatamente dal prompt già autorizzato. Nessuna nuova ricerca Wikipedia/Wikisource/LoC, nuova chiamata AI, retry o credito inventato.
4. L'errore è generico in italiano, non cita né registra estratti, URL, fonte o segreti. Il runner mantiene il comportamento prudente già esistente per il tentativo AI fallito e l'usage effettivamente osservato; l'autore decide se ripetere la revisione.
5. Per gli altri undici ruoli non introdurre un dossier nei prompt e non modificare la separazione delle competenze. La verifica letterale delle prove, il giudice critico, la protezione CAS e i dodici rapporti restano indipendenti. La corrispondenza dello snapshot non è autenticazione di un originale né prova semantica della conclusione.

## Verifiche

Vitest: dossier invariato/assente, sostituzione estratto/revisione/attivi/relazioni, fase/stage/round/report count, capitolo e freeze, giudice. Integrazione runner con `updatedAt` invariato modificato durante la chiamata dello storico e del giudice, senza applicazione dei due output stale. Frontend CI, Playwright desktop/mobile, EPUBCheck 5.4.0 sui quattro EPUB, Pages e cleanup devono risultare `completed/success` sulla **medesima HEAD di main** prima della chiusura #144.

Limiti: un backup può comunque essere falsificato *prima* del prompt, e non si dimostra indipendenza, licenza, provenienza o verità storica delle fonti; tali criticità richiedono verifica manuale dell'autore e ulteriori sviluppi della #23.
