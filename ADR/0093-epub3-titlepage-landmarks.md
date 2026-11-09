# ADR 0093 — EPUB 3: frontespizio e landmarks di lettura

- **Stato:** accettato per v0.11.61
- **Data:** 2026-11-09
- **Issue:** [#97](https://github.com/KeyserDSoze/BookWriter/issues/97)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedente:** [ADR 0089](0089-epub3-canonical-export-validation.md), [ADR 0090](0090-epub3-scene-navigation.md)
- **Riferimento normativo:** [W3C EPUB 3.3 §7.4.4 — landmarks nav](https://www.w3.org/TR/epub-33/#sec-nav-landmarks)

## Contesto

L'EPUB 3 v0.11.60 ha un TOC XHTML di capitoli e scene canoniche (ADR 0090), ma il `spine` inizia direttamente dal primo capitolo e manca un frontespizio esplicito. Alcuni lettori offrono comandi per raggiungere il front matter o per saltare al testo tramite una `landmarks nav` EPUB 3.3, distinta dal TOC. La specifica richiede che ogni collegamento dentro `nav epub:type="landmarks"` contenga il proprio `epub:type`, e sconsiglia di replicare l'intero indice. Il progetto non ha un autore verificato da esporre automaticamente o una copertina grafica.

## Decisione

1. Aggiungere `OEBPS/titlepage.xhtml` con lo **stesso titolo pubblico** usato nell'OPF (senza informazioni private e senza metadati inventati), dentro una `section epub:type="titlepage" aria-labelledby="book-title"` e un `h1 id="book-title"`. Usare namespace EPUB e XHTML e `html()` per sanificare/escapare il titolo, preservando emoji e accenti validi.
2. Dichiarare `titlepage.xhtml` nel `manifest` EPUB e inserirlo come **primo** `itemref` nello `spine`, prima di tutti i capitoli del canone. Ogni capitolo pubblicato dichiara il proprio documento `body epub:type="bodymatter"`; la sequenza `chapter-N.xhtml` e gli ID delle scene esistenti non cambiano. Capitoli senza scene canoniche e scene `draft/planned` non sono serializzati.
3. Tenere `toc` a due livelli invariato e aggiungere esattamente una `nav epub:type="landmarks"` con due soli link: `epub:type=titlepage` a `titlepage.xhtml` e `epub:type=bodymatter` a `chapter-1.xhtml`. Quest'ultimo è il primo **capitolo esportato**, indipendentemente da numeri mancanti o capitoli di sola bozza: `ensureChapters` garantisce che esista. Nessun link vuoto, remoto o generato da UUID/slug.
4. Non aggiungere cover immagini, bibliografia, autore, dipendenze, servizi di rete o nuovi dati persistenti. Non modificare DOCX, PDF o backup.

## Prove

- Vitest controlla file aggiunto, XHTML escaped, `manifest`/`spine` ordinati, `toc` immutato, un solo `landmarks`, link e semantica, assenza di brief, segreti extra-manuscript e bozze, titoli malformati Unicode, caso in cui il primo capitolo canonico sia il 3 originario e nessun canon.
- Playwright desktop/mobile scarica un EPUB da Archivio, apre ZIP, analizza XML per container/OPF/nav/frontespizio/capitoli e segue `landmarks` tramite `DOMParser` fino ai target XHTML, confermando `epub:type` e titolo attesi; risolve **tutte le entry del manifest** a file reali del ZIP e **ogni idref dello spine** al relativo href, senza file o riferimenti mancanti, e mantiene il controllo dei collegamenti di scena.

## Limiti

Non sono state eseguite validazioni ufficiali EPUBCheck, verifiche su e-reader fisici o audit di accessibilità; `landmarks` non certifica il comportamento di ogni lettore. L'epic #4 rimane aperta per EPUBCheck/lettori, font Unicode PDF, cover e layout, backup/restore avanzato.
