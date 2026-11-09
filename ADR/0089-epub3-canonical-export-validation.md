# ADR 0089 — EPUB 3 verificabile, XHTML sicuro e solo scene canoniche

- **Stato:** accettato per v0.11.57
- **Data:** 2026-11-09
- **Issue:** [#93](https://github.com/KeyserDSoze/BookWriter/issues/93)
- **Epic aperta:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Contesto:** export editoriale già implementato in `infrastructure/export-book.ts`

## Problema

La funzione `exportEpub` costruiva un EPUB 3 nel browser senza esporre il risultato a test indipendenti della struttura ZIP, del MIME primo/uncompressed, del package OPF, dell'indice XHTML o dell'esclusione di scene non canoniche. Testi provenienti da generatori AI e ZIP importati possono contenere code point proibiti da XML 1.0 (es. NUL, controlli C0, surrogati UTF-16 isolati): il solo escaping `&<>"'` non rende automaticamente un XHTML valido. Un file scaricato ma non parsabile da un e-reader può creare falsa fiducia nel backup editoriale.

## Decisione

1. Introdurre `buildEpub(book: BookProject, modifiedAt = new Date()): Uint8Array`, **pura**, che produce lo ZIP EPUB 3 e può essere aperta nei test con `fflate.unzipSync`. `exportEpub` conserva la firma UI corrente, chiama il builder e gestisce soltanto il download locale `.epub`. Nessun network, server, token, PAT o endpoint LLM.
2. Conservare il `mimetype` come **prima voce ZIP non compressa (method STORE, senza extra)**, con byte esatti `application/epub+zip`, poi `META-INF/container.xml`, `OEBPS/content.opf`, `OEBPS/nav.xhtml`, CSS e un file XHTML per ciascun capitolo che contiene prosa canonica. Il package ha identificatore `urn:uuid:<bookId>`, titolo, lingua italiana, `dcterms:modified` UTC, manifest e spine nell'ordine del romanzo.
3. Proiettare esclusivamente scene con `status === "canon"` e testo non vuoto. Non esportare `brief`, `memory.secrets`, appunti `planned`/`draft`, credenziali, rapporti interni di redazione o contenuti della coda. La prosa canonica può contenere volontariamente segreti narrativi: **l'EPUB non è un backup pubblico o sanitizzato dei segreti già inseriti nel romanzo**.
4. Prima dell'escaping XML, eliminare caratteri di controllo vietati da XML 1.0, convertire eventuali surrogati UTF-16 isolati al carattere di sostituzione Unicode, e preservare sequenze surrogate valide (emoji) e diacritici. Continuare a codificare correttamente `&`, `<`, `>`, virgolette e apostrofi nei nodi HTML/XML.
5. Se nessuna scena canonica è presente, fallire con messaggio italiano invece di scaricare un pacchetto vuoto. Non inventare copertina, autore, timestamp di storia o capitoli mancanti.

## Verifiche

Vitest con builder indipendente: header ZIP locale e ordine del `mimetype` STORED, roundtrip `fflate.unzipSync`, package OPF, nav, manifest e spine di capitoli non consecutivi, esclusione testo `draft/planned` e memoria segreta, XML escaping di titoli/prosa, controllo/emoji/surrogati, errore su canon vuoto. E2E Playwright desktop/mobile scarica un file EPUB tramite **l'interfaccia reale**, apre l'archivio ZIP e usa `DOMParser(application/xml)` in Chromium su OPF/container/nav/XHTML, con testo canonico, bozze e segreti distinti.

## Limiti

La verifica copre integrità strutturale e parsing XML in browser; **non equivale a certificazione EPUBCheck** né garantisce compatibilità per ogni e-reader. PDF/DOCX, cover, metadati d'autore, accessibilità e layout avanzato restano in #4. I file esportati contengono la prosa canonica e devono essere condivisi come un manoscritto, non come una copia anonima.
