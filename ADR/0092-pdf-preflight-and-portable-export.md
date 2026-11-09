# ADR 0092 — PDF verificabile e preflight Unicode conservativo

- **Stato:** accettato per v0.11.60
- **Data:** 2026-11-09
- **Issue:** [#96](https://github.com/KeyserDSoze/BookWriter/issues/96)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Allineamento:** [ADR 0089](0089-epub3-canonical-export-validation.md), [ADR 0091](0091-docx-canonical-xml-package.md)

## Contesto

L'esportazione PDF v0.11.59 usa Times tra i font standard di jsPDF, senza font Unicode incorporati. Scene canoniche contenenti emoji, ideogrammi o segni fuori dalla codifica del font possono produrre un PDF formalmente scaricabile ma **testualmente falso** perché parti del romanzo non sono rappresentate. Non esiste un builder PDF separato dal download, né prove browser sul PDF reale. Scaricare nuove font da CDN sarebbe incompatibile con l'uso local-first/offline e senza consenso; incorporarli richiede licenze, provenienza e verifiche visuali non presenti in questa tranche.

## Decisione

1. `buildPdf(book): Promise<Uint8Array>` chiama `ensureChapters`, esamina soltanto il titolo del libro, capitoli e scene canoniche e i loro paragrafi e **prima** di creare il PDF passa ognuno a `printablePdfText`. Quest'ultimo elimina solo controlli XML 1.0 illeciti, sostituisce surrogati isolati come nella pipeline EPUB/DOCX e rifiuta poi codepoint che le font standard non possono codificare, segnalando `U+XXXX` e alternativa EPUB/DOCX. La whitelist conservativa è ASCII stampabile, Latin-1 e segni speciali WinAnsi comuni, più newline.
2. Solo dopo un preflight riuscito, `jsPDF` genera un PDF A4 con paginazione già esistente e output in `Uint8Array`. `exportPdf` preserva la firma UI ma scarica quei byte con `Blob application/pdf`. Niente HTTP, nuove dipendenze o salvataggi cloud; nessun PDF parziale su errore. Il PDF conserva lo stesso ordine e selezione dei capitoli canonici; brief, memory, segreti fuori dalla prosa, draft/planned e token non vengono esaminati né serializzati.
3. Questa non è una promessa di resa universale nemmeno fra lettori PDF: il preflight evita la sostituzione silenziosa di caratteri **notoriamente fuori dal repertorio**, non verifica singoli glyph mapping dei font o l'aspetto finale. I segreti effettivamente raccontati nel canone restano nel PDF come negli altri formati.

## Verifiche

Vitest controlla PDF serializzato in byte, `%PDF`, `%%EOF`, pagine del titolo e dei soli capitoli pubblicati, ordine, esclusione di stringhe private, italiano accentato e punteggiatura WinAnsi ammessi, fail-closed su emoji/CJK/surrogati in titolo, capitolo, scena e testo, e canon vuoto. Playwright desktop/mobile verifica che un PDF incompatibile produca errore italiano **senza evento download**, poi sostituisce il testo con caratteri supportati e scarica/ispeziona il PDF vero.

## Limiti

Mancano ancora font Unicode incorporati con licenza e provenienza, validazione su più lettori/rendering, PDF/A, accessibilità, copertine, impaginazione professionale e certificazione editoriale: la epic #4 rimane aperta. Per pubblicazioni contenenti Unicode esteso usare EPUB o DOCX fino alla tranche dedicata.
