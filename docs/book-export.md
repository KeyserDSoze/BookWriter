# Esportare il manoscritto — EPUB, DOCX e PDF

BookWriter mantiene il progetto nel browser (IndexedDB). L'esportazione editoriale produce un file leggibile **senza inviare la prosa a servizi esterni**. Per creare un'edizione, apri **Archivio → Esporta libro**, seleziona il libro e scegli **EPUB**, **Word (DOCX)** o **PDF**.

## Quali testi vengono inclusi

L'esportazione prende **soltanto scene con stato `canon` e testo non vuoto**, nell'ordine dei capitoli e delle scene attualmente presenti. I capitoli senza scene canoniche non vengono pubblicati e l'ordine originale dei numeri dei capitoli viene conservato nei titoli. Se non esiste alcuna scena canonica, BookWriter segnala un errore e non genera un file vuoto. `brief`, cronologia delle chiamate AI, memory, segreti non presenti nella prosa, bozze `draft`/`planned`, API key e PAT GitHub **non entrano nel manoscritto esportato**.

**Attenzione:** una scena `canon` può contenere volutamente segreti o spoiler letterari. EPUB, DOCX e PDF non sono file cifrati. Condividili come condivideresti una bozza o un manoscritto: **solo con destinatari autorizzati**. Per ripristinare il lavoro e la storia editoriale, usa invece il backup ZIP content-only o full (con password se serve protezione dei dati).

## EPUB 3 — validazioni v0.11.57

Il generatore locale `buildEpub` produce un ZIP con il file `mimetype` **come prima voce non compressa**, il contenitore `META-INF/container.xml` e il package `OEBPS/content.opf`. Il package dichiara l'identificatore stabile del libro, titolo, lingua `it`, data di generazione UTC, manifest e ordine di lettura `spine`. Ogni capitolo con prosa canonica è un documento XHTML distinto, collegato dall'indice `nav.xhtml` e dal CSS.

Titoli e prosa vengono escapati per XML (`&`, `<`, `>`, virgolette, apostrofi). I controlli proibiti da XML 1.0 vengono omessi e gli eventuali surrogati Unicode malformati sono sostituiti, mentre gli accenti e le emoji rimangono. Questa misura impedisce che un testo generato con caratteri invisibili renda il documento XHTML malformato; **non corregge errori di prosa**.

I test `export-book.test.ts` aprono il ZIP e verificano struttura e contenuto; Playwright desktop/mobile scarica l'EPUB tramite interfaccia e analizza container, OPF, nav e XHTML con il parser XML di Chromium. Questi controlli **non sono una certificazione EPUBCheck** e non sostituiscono la prova con il lettore o il dispositivo di destinazione.

## DOCX e PDF

Gli altri due pulsanti esportano la prosa canonica con intestazioni dei capitoli e delle scene. PDF usa per ora un font base di jsPDF, che **può non rappresentare tutti i caratteri Unicode**; la tipografia, le copertine, le illustrazioni, l'accessibilità e l'integrazione di font rimangono attività aperte nella [issue #4](https://github.com/KeyserDSoze/BookWriter/issues/4).

Decisione progettuale: [ADR 0089](../ADR/0089-epub3-canonical-export-validation.md). Tranche sviluppata in [issue #93](https://github.com/KeyserDSoze/BookWriter/issues/93).
