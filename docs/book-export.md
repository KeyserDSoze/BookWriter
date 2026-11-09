# Esportare il manoscritto — EPUB, DOCX e PDF

BookWriter mantiene il progetto nel browser (IndexedDB). L'esportazione editoriale produce un file leggibile **senza inviare la prosa a servizi esterni**. Per creare un'edizione, apri **Archivio → Esporta libro**, seleziona il libro e scegli **EPUB**, **Word (DOCX)** o **PDF**.

## Quali testi vengono inclusi

L'esportazione prende **soltanto scene con stato `canon` e testo non vuoto**, nell'ordine dei capitoli e delle scene attualmente presenti. I capitoli senza scene canoniche non vengono pubblicati e l'ordine originale dei numeri dei capitoli viene conservato nei titoli. Se non esiste alcuna scena canonica, BookWriter segnala un errore e non genera un file vuoto. `brief`, cronologia delle chiamate AI, memory, segreti non presenti nella prosa, bozze `draft`/`planned`, API key e PAT GitHub **non entrano nel manoscritto esportato**.

**Attenzione:** una scena `canon` può contenere volutamente segreti o spoiler letterari. EPUB, DOCX e PDF non sono file cifrati. Condividili come condivideresti una bozza o un manoscritto: **solo con destinatari autorizzati**. Per ripristinare il lavoro e la storia editoriale, usa invece il backup ZIP content-only o full (con password se serve protezione dei dati).

## Matrice EPUBCheck su più manoscritti — v0.11.64

Il gate ufficiale EPUBCheck valida ora **quattro** file EPUB distinti prodotti dal vero generatore `buildEpub`. I campioni coprono selezione del canone e bozze, primo capitolo presente solo in posizione avanzata del progetto, Unicode e caratteri XML malformati sanificati, e volumi lunghi con scene multiple. Ogni file deve essere scritto e verificato separatamente; l'assenza di uno solo dei quattro o un errore del validatore causa fallimento della CI.

I libri di prova sono sintetici: nessuna storia o credenziale personale viene caricata in GitHub Actions. La matrice amplia la copertura, **non costituisce la certificazione di tutti i libri**. [Guida CI](epubcheck-ci.md), [ADR 0096](../ADR/0096-epubcheck-fixture-matrix.md), [issue #101](https://github.com/KeyserDSoze/BookWriter/issues/101).

## EPUBCheck ufficiale nel workflow CI — v0.11.63

Il repository controlla adesso la compatibilità EPUB mediante **EPUBCheck 5.4.0**, validatore ufficiale mantenuto dal consorzio DAISY per W3C. Ad ogni push su `main` e a ogni PR, un job dedicato della Frontend CI genera **un libro di prova sintetico** usando l'effettivo `buildEpub` dell'app, contenente accenti, emoji, titoli con caratteri XML, capitoli/scene canonici e bozze da escludere. EPUBCheck verifica poi il file ZIP prodotto, il package, i contenuti XHTML e le relative regole di conformità. Qualunque uscita non-zero della CLI blocca il job.

Il controllo usa la distribuzione ufficiale `5.4.0` con hash SHA-256 verificato. Non riceve o carica libri personali, credenziali o dati dal browser. Per istruzioni di riproduzione locale e interpretazione del risultato: [Guida EPUBCheck CI](epubcheck-ci.md), [ADR 0095](../ADR/0095-official-epubcheck-ci.md), [issue #100](https://github.com/KeyserDSoze/BookWriter/issues/100).

**Portata della verifica:** il test ufficiale valida un EPUB rappresentativo creato dal builder, non ogni combinazione di manoscritto possibile. I test unitari, quelli browser e la prova su un e-reader reale restano controlli distinti. Non è un attestato di accessibilità o di compatibilità universale per l'EPUB personale di un autore.

## EPUB 3 — validazioni v0.11.57

Il generatore locale `buildEpub` produce un ZIP con il file `mimetype` **come prima voce non compressa**, il contenitore `META-INF/container.xml` e il package `OEBPS/content.opf`. Il package dichiara l'identificatore stabile del libro, titolo, lingua `it`, data di generazione UTC, manifest e ordine di lettura `spine`. Ogni capitolo con prosa canonica è un documento XHTML distinto, collegato dall'indice `nav.xhtml` e dal CSS.

Titoli e prosa vengono escapati per XML (`&`, `<`, `>`, virgolette, apostrofi). I controlli proibiti da XML 1.0 vengono omessi e gli eventuali surrogati Unicode malformati sono sostituiti, mentre gli accenti e le emoji rimangono. Questa misura impedisce che un testo generato con caratteri invisibili renda il documento XHTML malformato; **non corregge errori di prosa**.

I test `export-book.test.ts` aprono il ZIP e verificano struttura e contenuto; Playwright desktop/mobile scarica l'EPUB tramite interfaccia e analizza container, OPF, nav e XHTML con il parser XML di Chromium. Questi controlli **non sono una certificazione EPUBCheck** e non sostituiscono la prova con il lettore o il dispositivo di destinazione.

## Frontespizio e landmarks di lettura — v0.11.61

Il file EPUB esportato contiene ora un **frontespizio XHTML** con il titolo effettivo del libro. È la prima voce di lettura nel `spine` di `content.opf`, seguita dai soli capitoli con scene canoniche; non vengono inventati un autore, una copertina grafica o altri dati mancanti dal progetto. Il titolo mantiene accenti, emoji e escaping XML, anche se arriva da contenuto importato malformato.

L'indice `nav.xhtml` ha due aiuti di navigazione distinti: l'indice `toc` capitoli→scene e una guida `landmarks` con **Frontespizio** e **Inizio del libro**. I landmarks usano i valori EPUB 3 standard `titlepage` e `bodymatter` e portano a pagine reali del package. Il secondo link porta al primo capitolo **pubblicato**, anche se i primi capitoli nel progetto erano bozze; il numero originale del capitolo rimane visibile nel TOC. Il frontespizio non aggiunge prosa privata e non rende pubblicabili le bozze.

Vitest controlla manifest/spine, escaping e landmark; Playwright desktop/mobile scarica l'EPUB e risolve gli href della guida a elementi strutturali XHTML via `DOMParser`. È interoperabilità strutturale EPUB 3, **non** certificazione EPUBCheck né verifica su dispositivi reali. [ADR 0093](../ADR/0093-epub3-titlepage-landmarks.md), [issue #97](https://github.com/KeyserDSoze/BookWriter/issues/97).

## Navigazione per scene canoniche — v0.11.58

L'indice EPUB mostra ora, sotto ogni capitolo effettivamente esportato, un secondo livello con le **singole scene canoniche**. Ogni voce porta all'ancora relativa `chapter-N.xhtml#scene-M`, collegata alla sezione XHTML e al suo titolo `h2`. `N` e `M` sono posizioni consecutive **fra i capitoli e le scene esportati** (non gli UUID e non i numeri originari del piano editoriale); il numero originale del capitolo resta visibile nell'indice. Bozze, scene pianificate e scene vuote non generano link.

L'escaping è identico a quello della prosa: titoli con `&<>"'` non diventano markup. Vitest verifica ordine e integrità dei riferimenti, mentre Playwright desktop/mobile segue i link dell'EPUB scaricato fino all'ID di sezione e al titolo usando `DOMParser`. È una miglioria di **navigabilità e semantica**, non una certificazione EPUBCheck o una verifica completa di accessibilità: comportamento su lettori fisici e tutti i controlli editoriali restano da verificare.

Decisione: [ADR 0090](../ADR/0090-epub3-scene-navigation.md), [issue #94](https://github.com/KeyserDSoze/BookWriter/issues/94).

## DOCX — pacchetto Word verificabile v0.11.59

Anche l'esportazione DOCX ha un builder indipendente dal download: `buildDocx` crea i byte del file Word, mentre il pulsante **Word (DOCX)** scarica localmente il file senza trasferire il manoscritto in rete. La struttura ZIP OPC contiene `[Content_Types].xml`, le relazioni e il documento `word/document.xml` con titoli dei capitoli e delle scene `canon` e relativi paragrafi, nell'ordine del libro. Capitoli solo bozze, scene `draft/planned` e informazioni extra-manuscript non sono esportati.

Titoli e paragrafi passano attraverso la stessa sanitizzazione XML dell'EPUB: caratteri di controllo XML proibiti sono eliminati, surrogati UTF-16 isolati vengono sostituiti e gli accenti e le emoji sono preservati. Il serializzatore Word si occupa dell'escaping XML; i contenuti AI rimangono testo. Test Vitest aprono il DOCX reale come ZIP; Playwright desktop/mobile lo scarica e controlla package e WordprocessingML con `DOMParser`.

Questo verifica **integrità strutturale e parsing XML** sul file generato, non compatibilità garantita con tutte le versioni di Word/LibreOffice, qualità tipografica, accessibilità o firma/validazione formale Office Open XML. Vedi [ADR 0091](../ADR/0091-docx-canonical-xml-package.md) e [issue #95](https://github.com/KeyserDSoze/BookWriter/issues/95).

## Numerazione delle pagine PDF — v0.11.62

Il PDF ora numererà le pagine **a partire dal primo capitolo effettivamente esportato**: sotto ciascuna pagina del corpo del romanzo appare `Pagina X di Y`. La numerazione prosegue attraverso i capitoli successivi e i salti pagina automatici di capitoli lunghi. **Il frontespizio resta non numerato**: anche quando un titolo molto lungo si distribuisce su più pagine, la numerazione inizia da `Pagina 1` sul primo capitolo canonico.

Il numero è inserito dopo che jsPDF ha completato la disposizione del contenuto, centrato nel margine inferiore separato dall'area della prosa. Non vengono esportati numeri di pagine di scene `draft/planned`, brief o memoria. Test Vitest controllano i numeri nei byte PDF generati, anche su contenuti lunghi; Playwright desktop/mobile conferma i footer nel file scaricato. Non sono test di impaginazione professionale, rendering su stampanti o accessibilità PDF. [ADR 0094](../ADR/0094-pdf-canonical-folios.md), [issue #99](https://github.com/KeyserDSoze/BookWriter/issues/99).

## PDF — controllo dei glifi prima dell'esportazione v0.11.60

Il generatore PDF continua a usare Times, un font standard di jsPDF, **non** un font Unicode completo. Ora `buildPdf` prepara e controlla, prima di creare il file, titolo del libro, titoli di capitoli/scene e paragrafi delle sole scene canoniche. Accetta caratteri ASCII, lettere accentate Latin-1 e punteggiatura WinAnsi comune (per esempio `città`, `L’ombra`, `—` ed `€`).

Se una parte da pubblicare contiene caratteri non rappresentabili (es. emoji, ideogrammi, surrogati Unicode malformati), **non viene scaricato alcun PDF**. L'Archivio mostra un messaggio che identifica il codice Unicode del carattere e consiglia EPUB/DOCX, che conservano tali caratteri. Una bozza o una nota privata con emoji non blocca il PDF: questi dati non sarebbero esportati. I controlli XML vietati vengono eliminati come negli altri formati.

I test Vitest verificano la struttura del PDF (`%PDF`, `%%EOF`, oggetti pagina) e il rifiuto degli input non rappresentabili; Playwright desktop/mobile scarica realmente un PDF valido, controlla header/trailer/pagine ed esclusione di segreti e bozze, oltre all'assenza di download nel caso non supportato. **Non sono test di resa tipografica o certificazione PDF/A/accessibilità**: la soluzione completa richiederà un font Unicode incorporato, autorizzato e verificato. [ADR 0092](../ADR/0092-pdf-preflight-and-portable-export.md), [issue #96](https://github.com/KeyserDSoze/BookWriter/issues/96).

Il pulsante PDF esporta la prosa canonica con intestazioni, ma usa per ora un font base di jsPDF, che **può non rappresentare tutti i caratteri Unicode**. Copertine, layout, font e accessibilità editoriali restano aperti nella [issue #4](https://github.com/KeyserDSoze/BookWriter/issues/4). La validazione EPUB originale è descritta in [ADR 0089](../ADR/0089-epub3-canonical-export-validation.md), [issue #93](https://github.com/KeyserDSoze/BookWriter/issues/93).
