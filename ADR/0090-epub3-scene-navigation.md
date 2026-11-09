# ADR 0090 — Navigazione EPUB 3 per singola scena canonica

- **Stato:** accettato per v0.11.58
- **Data:** 2026-11-09
- **Issue:** [#94](https://github.com/KeyserDSoze/BookWriter/issues/94)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedente:** [ADR 0089](0089-epub3-canonical-export-validation.md)

## Contesto

Il builder EPUB 3 della v0.11.57 esporta in modo strutturalmente verificabile soltanto scene canoniche e colloca un titolo h2 per ogni scena. L'indice nav XHTML tuttavia elenca soltanto i capitoli; per accedere a una scena specifica il lettore deve scorrerli. Gli ID reali delle scene derivano da dati locali/importati e non devono diventare frammenti URL senza validazione; titoli di IA possono contenere markup testuale malformato.

## Decisione

1. Conservare `buildEpub`, la politica di scene `canon` non vuote, ordine capitoli/scene e package EPUB di ADR 0089. L'indice nav avrà due livelli, con un collegamento al capitolo e sotto una lista per ogni scena realmente serializzata. Il capitolo mostra il suo **numero originale**; il path `chapter-N.xhtml` resta relativo alla sequenza dei soli capitoli pubblicati.
2. Assegnare alla j-esima scena pubblicata di ogni capitolo `section id="scene-j" aria-labelledby="scene-j-title"` e `h2 id="scene-j-title"`, usando indici 1-based della sequenza filtrata. Il sommario usa `chapter-N.xhtml#scene-j`. Non esporre UUID, slug o dati non sanitizzati negli ID/fragment, e non creare voci per scene `draft/planned` o prosa vuota.
3. Passare tutti i titoli attraverso la stessa funzione di escaping/sanitizzazione XML del manoscritto. Il testo di origine non è mai interpretato come XHTML. Non introdurre dipendenze, HTTP, telemetry, nuovi stati o variazioni a DOCX/PDF e backup.

## Prove

Vitest verifica indice gerarchico, anchor unici e corrispondenti, draft intercalati, scene vuote, numeri capitoli non contigui, escaping e immutata esclusione dei segreti extra-manuscript. Playwright desktop/mobile scarica l'EPUB, apre ZIP e XML, poi controlla per ogni link di scena che il frammento esista davvero nel relativo XHTML e abbia l'h2 correlata.

## Limiti

Questo intervento migliora la navigabilità ma non equivale a EPUBCheck o audit di accessibilità generale, né documenta un comportamento certificato su lettori fisici. Font PDF Unicode, layout tipografico e backup/restore avanzati continuano nell'epic #4.
