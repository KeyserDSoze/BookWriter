# ADR 0094 — Numerazione delle pagine del manoscritto PDF canonico

- **Stato:** accettato per v0.11.62
- **Data:** 2026-11-09
- **Issue:** [#99](https://github.com/KeyserDSoze/BookWriter/issues/99)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedente:** [ADR 0092](0092-pdf-preflight-and-portable-export.md)
- **Operatività Pages:** [issue #98](https://github.com/KeyserDSoze/BookWriter/issues/98)

## Contesto

`buildPdf` genera un frontespizio e un blocco di pagine per ogni capitolo con scene `canon` (ADR 0092), interrompendo il download per caratteri impossibili da rappresentare con il font standard. L'assenza di numerazione dei fogli complica revisione, confronto e citazioni nel PDF stampabile; l'ordine delle scene è stabile ma capitoli lunghi attraversano più pagine. Non è corretto numerare solo le intestazioni dei capitoli o assumere che il frontespizio occupi sempre una pagina.

## Decisione

1. Conservare filtro `ensureChapters`, preflight `printablePdfText`, formato A4/Times, generatore locale e API UI. Iniziare il rendering del libro senza footer; alla creazione della prima pagina del **primo capitolo pubblicato**, registrare `firstBodyPage = pdf.getNumberOfPages()`, indipendentemente da pagine del titolo che lo precedono.
2. Dopo tutte le righe e i salti pagina automatici, ottenere `lastPage` e il conteggio `lastPage-firstBodyPage+1`. Usare `pdf.setPage` per aggiungere a **ciascuna pagina del corpo** un footer centrato `Pagina X di Y` in Times normale, 9pt, con numerazione progressiva da 1 e totale coerente. Non includere il titolo neppure quando si estende su più pagine.
3. Distanziare il footer dal testo con baselines in mm (`bottom=276` per la prosa, `footer y=286`) senza modificare le interruzioni esistenti. Nessun nuovo campo persistente, dipendenza, token, processo remoto, font o chiamata HTTP.

## Prove

- Vitest genera PDF A4 reali in memoria, ispeziona intestazione e trailer, verifica il numero di pagine, confronta in ordine tutti i marker testuali `Pagina X di Y`, prosa lunga che attraversa più fogli e titolo multipagina non numerato. Mantiene test di privacy e preflight del repertorio WinAnsi.
- Playwright desktop/mobile prima verifica il blocco dell'export per emoji canoniche e assenza di download; poi scarica un PDF da Archivio, conta pagine/folio e controlla che non siano presenti contenuti di brief, memory o scene non canoniche.

## Limiti e distribuzione

Non equivale a conformità PDF/A, PDF accessibile con tag, controllo dei glifi su renderer esterni, tipografia professionale o supporto Unicode completo. Il deploy Pages ha avuto run senza job sulla v0.11.61: anche con CI verde il sito non è dichiarato aggiornato finché la pipeline Pages sulla HEAD finale non è `completed/success`. Tenere #98 aperta in quel caso e non chiudere #99 se i test applicativi falliscono.
