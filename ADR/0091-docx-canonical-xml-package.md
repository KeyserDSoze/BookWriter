# ADR 0091 — DOCX verificabile, XML-safe e solo scene canoniche

- **Stato:** accettato per v0.11.59
- **Data:** 2026-11-09
- **Issue:** [#95](https://github.com/KeyserDSoze/BookWriter/issues/95)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Coerenza con:** [ADR 0089](0089-epub3-canonical-export-validation.md) e [ADR 0090](0090-epub3-scene-navigation.md)

## Contesto

In v0.11.58 `exportDocx` genera un file Word nel browser chiamando `Packer.toBlob` direttamente e lo scarica. Il file non è apribile da unit test indipendenti, non esistono prove end-to-end della validità XML delle parti DOCX, né l'input AI potenzialmente contenente caratteri XML 1.0 vietati viene sanificato prima del writer. L'export usa solo il canone ma questo non è verificato in un archivio Word effettivo.

## Decisione

1. Estrarre `buildDocx(book): Promise<Uint8Array>` senza download, che proietta esclusivamente `ensureChapters(book)` (capitoli con scene `canon` non vuote), genera `Document`/`Packer.toBlob` e ritorna i byte del package OPC. `exportDocx` mantiene la UI precedente e si occupa del solo download Blob con MIME Office Open XML. Non sono introdotti servizi, nuove librerie o modifiche al canone.
2. Passare `book.title`, intestazioni capitoli, titoli scene e paragrafi a `safeXmlText` prima del writer `docx`. La funzione rimuove controlli XML 1.0 invalidi e sostituisce surrogati UTF-16 isolati, preservando Unicode legittimo; escaping di XML è gestito dal serializer della libreria Word. Non importare brief, memoria privata, segreti extra-prosa, credenziali, audit o scene non canoniche nel package.
3. Zero scene canoniche produce un errore italiano senza documenti vuoti. Mantenere la progressione di intestazioni titolo/capitolo/scena e paragrafi esistenti; nessuna conversione dei segreti volontariamente scritti nella prosa canonica, e nessun filtro che censuri la narrativa.

## Validazioni

Vitest apre il DOCX byte per byte come ZIP con `fflate.unzipSync`, verifica `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `docProps/core.xml`, ordine del testo/heading e assenza di bozze, brief/memory, testando controlli, surrogate e Unicode valido. Playwright desktop/mobile scarica il DOCX vero da Archivio, apre OPC e sottopone le parti XML al `DOMParser` di Chromium, confrontando la sequenza canonica.

## Limiti

La verifica di package e parsing XML non equivale a una certificazione Word/LibreOffice, a una convalida OOXML secondo tutti gli schemi, o a un audit di accessibilità. Font Unicode PDF, tipografia, copertine, illustrazioni, test dispositivi e restore ZIP avanzato restano attività della epic #4.
