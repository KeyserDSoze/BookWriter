# ADR 0109 — Audit della fusione AI riuscita: conservare la tariffa del tentativo

- **Stato:** accettato per v0.11.77
- **Data:** 2026-11-10
- **Issue:** [#114](https://github.com/KeyserDSoze/BookWriter/issues/114)
- **Epic:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17), [#15](https://github.com/KeyserDSoze/BookWriter/issues/15), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Predecessore:** [ADR 0108](0108-price-snapshot-ai-budget.md)

## Contesto

La v0.11.76 fotografa la tariffa del provider nella `Activity` prima di una chiamata (anche nelle fusioni scena). In `generateSceneMergeDraft` la registrazione di una proposta riuscita passa da `persistDraft`, che salva bozza e Activity nella stessa transazione IndexedDB. Questo metodo sostituisce il record con l'**identico ID** con un audit `succeeded` costruito da zero, copiando modello e token ma **non** `priceRateSnapshot`. Ne consegue una rivalutazione non voluta del prezzo della fusione riuscita se l'autore aggiorna il listino manuale. La chiamata fallita non perde invece la tariffa perché il suo catch salva l'attività originale.

## Decisione

1. Nel solo audit di `persistDraft` con `draft.source === "ai"`, trasferire una **copia** di `attempted.priceRateSnapshot` alla nuova Activity `succeeded`. Riutilizzare sempre `id`, `runId`, `createdAt`, `aiRequested`, endpoint/modello e token già registrati. Nessun secondo addebito, nessun secondo record.
2. Le bozze manuali non devono avere `aiRequested` né tariffa; gli audit di errore continuano a preservare il tentativo con snapshot. Nessuna modifica al canone, a `mergeDrafts.status=proposed`, all'approvazione autore, alla sincronizzazione GitHub, alla Web Lock o al lease distribuito.
3. La Dashboard deve stimare la fusione riuscita usando la **tariffa salvata al momento della chiamata** e non rivalutarla cambiando `AppSettings.aiPriceRates`. La tariffa aggiornata resta valida per i nuovi preflight. `legacyPricedCount` rimane zero per la chiamata nuova. Poiché `generateSceneMergeDraft` non modifica `BookProject`, `App` rilegge il registro anche **al cambio pagina** verso Dashboard; la lettura asincrona non può applicare dati se nel frattempo libro o pagina cambiano.
4. Non migrare retroattivamente fusioni 0.11.76 già persistite senza snapshot: non esiste un prezzo storico verificabile; rimangono evidenziate come legacy secondo ADR 0108. Non inventare tariffari provider né promettere fatture corrette.

## Verifiche

Vitest su audit di una fusione AI riuscita con token osservati, una sola Activity, stesso snapshot nonostante cambio tariffe, bozza proposed/canon intatto, nuovi preflight al prezzo aggiornato; copertura manuale con `aiRequested=false` e snapshot assente. Playwright desktop/mobile su fusione GitHub con provider mock e consenso autore: uso 321/48, tariffe 3/9, stima 0,0014 €, cambio prezzi 30/90, reload e stima costante, senza accettazione automatica della scena. CI/EPUBCheck/Pages/cleanup richiesti su main finale.

## Limiti

Solo i prezzi **inseriti dall'autore**, non una fattura autentica o un limite duro di billing. L'audit di fusione resta un registro locale e non implica push su GitHub; verificare manualmente il costo effettivo dal provider.
