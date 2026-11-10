# ADR 0112 — Sinossi editoriali non vuote e corrispondenza del passo di sintesi

- **Stato:** accettato per v0.11.80
- **Data:** 2026-11-10
- **Issue:** [#117](https://github.com/KeyserDSoze/BookWriter/issues/117)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** [ADR 0011](0011-independent-editorial-board-and-chapter-freeze.md), [ADR 0106](0106-provider-usage-before-editorial-validation.md), [ADR 0111](0111-saved-freeze-judgment-and-summary-gate.md)

## Problema

Dopo la review 12×N e il giudizio indipendente `freeze`, l'autopilot richiedeva al modello `chapterSummary` e `bookSummary`. Il solo `z.string().min(25)` esaminava la lunghezza grezza: 25+ spazi, tab o newline superavano lo schema e potevano diventare sinossi canoniche **prive di testo**, aggiornare `bookSummaryAtFreeze` e impostare `frozenAt`. Il validatore dei checkpoint `summaryCursor>0` già rifiutava sinossi progressive senza 25 caratteri dopo `trim`, ma il commit della sintesi non applicava lo stesso criterio. Inoltre il callback di apply non controllava esplicitamente che la risposta fosse per lo stesso chapterId e summaryCursor che avevano generato il prompt.

## Decisione

1. Mantenere i limiti massimi esistenti di 6.000 caratteri per `chapterSummary` e 9.000 per `bookSummary`, ma richiedere anche almeno **25 caratteri dopo trim** a entrambi i campi. Questo rifiuta contenuti fatti soltanto di whitespace anche in una risposta HTTP 200 e JSON valido. Non tagliare, abbreviare né inventare prosa; non attribuire una verità semantica alla lunghezza.
2. Prima di interpretare o applicare la risposta, `assertCurrentEditorialSummaryStep` verifica l'esatto `cycle.stage=summary`, `cycle.chapterId` e `cycle.summaryCursor` corrispondente al passo che ha letto l'AI. `assertEditorialReviewCoverage` e `assertSavedEditorialFreezeJudgmentIntegrity` continuano a operare **sul libro corrente** prima del commit.
3. Una risposta senza sinossi effettive rimane un'Activity `failed` con usage numerico valido, modello e tariffa rilevata prima del fetch; non modifica capitoli, scene, canone o sinossi e non prosegue in automatico. L'eventuale vecchio `bookSummary` non viene sostituito con un testo vuoto.
4. Nessun aumento delle chiamate AI, nessun nuovo backend, migrazione o schema ZIP; la recovery supervisionata di #105 continua a segnalare un checkpoint di sintesi intermedio con sinossi progressive vuote, preservando i vecchi audit.

## Prove

Vitest: flusso redazionale completo 12 rapporti, direttore `freeze`, provider con due sinossi bianche ma usage 243/72, uno e un solo tentativo di summary fallito, canone e `frozenAt` intatti, precedente sinossi preservata; flusso positivo con sinossi valida rimane coperto; test puro su mismatch di stage/capitolo/summaryCursor. Playwright Chromium desktop/mobile: sessione di summary valida in IndexedDB, risposta HTTP 200 solo spazi e usage, errore conservativo e zero retry. CI, EPUBCheck, Pages e cleanup sulla HEAD main finale.

## Limiti

Questo gate assicura una quantità minima di testo effettivo, **non** la correttezza o la completezza narrativa del riassunto, né la provenienza attestata di ogni sua affermazione. I rapporti letterali, il giudice critico e il controllo dell'autore restano necessari.
