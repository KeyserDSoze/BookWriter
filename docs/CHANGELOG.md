# Changelog — BookWriter

## 0.11.71 — 2026-11-09 (main, issue #108, epic #20)

**Recupero supervisionato dei checkpoint `repair` che non possono più proseguire**

- `editorialRecoveryProblem` prova giudizio/cursore/prossima scena e `repairPrompt` live; prima del primo edit richiede anche 12×N report correnti. Dopo una remediation già salvata non considera l'alterazione intenzionale del testo di un rapporto un motivo per forzare restart.
- Il recupero già protetto da consenso, Web Locks writer/outbox, CAS, archive bounded e transazione atomica salva vecchi rapporti, giudizio e cursore prima di ricominciare. Non modifica le scene neppure se già riscritte in `draft`, non fa rollback del canon e non contatta AI durante il recupero.
- Vitest su repair sano/stale, dopo primo commit, matrice, giudizio/cursor invalidi e archivio pieno; Playwright desktop/mobile su un repair storico con fonte ritirata, conferma/annullamento e zero chiamate AI.
- ADR 0103, guida, README/AGENTS e versioni package/lock 0.11.71. Nessun backend o nuova dipendenza. Le epic #20/#23 restano aperte.


## 0.11.70 — 2026-11-09 (main, issue #107, epic #20)

**Rivalidazione dei testimoni narrativi precedenti nei checkpoint di review**

- Nuovo gate locale `assertCurrentNarrativeReviewWitnesses`: per ogni finding `narrativeConflict` o `priorSceneConflict` nei rapporti della tornata, il testimone deve **ancora** essere presente nel contesto autorizzato dello stesso segmento della scena corrente. Solo i quattro specialisti di continuità possono citarlo; nessuna doppia fonte nello stesso rilievo.
- Eventi precedenti attestati sono ricontrollati mediante `buildAttestedReviewContext` (decisione, alias, provenance, campionamento), citazioni non attestate via `isUnattestedSourceCurrent` (freeze, contenuto, offset, finestra campionata). Il gate entra in `assertEditorialReviewCoverage` prima di revisori successivi, giudice, applicazione verdetto e freeze, anche quando testo corrente e numero dei 12 report sono invariati.
- Il recupero supervisionato #105 rende leggibile lo stallo e conserva vecchie testimonianze per audit; nessuna modifica automatica di prosa, attestazioni, giudizi o consenso, e nessuna chiamata provider durante la verifica.
- Vitest su attestazioni e citazioni valide/scadute, ruoli vietati e doppio riferimento; Playwright desktop/mobile su checkpoint completo con testimone revocato prima del giudice, senza chiamate LLM. ADR 0102, guida autore, AGENTS, README e package/lock 0.11.70.
- **Limite:** riferimenti correnti non significano verità narrativa, identità o contraddizione provata; il giudice resta indipendente e l'epic #20 aperta.


## 0.11.69 — 2026-11-09 (main, issue #106, epic #20 e #23)

**Gate documentale live delle fonti storiche fra revisori, giudice e remediation**

- `assertCurrentHistoricalReviewSources` ricalcola `validateHistoricalClaim` sui report del **solo revisore storico** contro il dossier corrente del capitolo. Controlla revisioni **ancora attive**, estratti e citazioni letterali associati a ciascun sourceId, relazioni di derivazione e indipendenza delle fonti, contesto delle divergenze. Rifiuta fonti storiche iniettate da ruoli non autorizzati e fonti rimosse, modificate o invalidate dal nuovo dossier.
- Il gate è ora richiamato da `assertEditorialReviewCoverage` (#104), che decide se avanzare al prossimo revisore e se un checkpoint può autorizzare giudice e freeze. Un checkpoint con testo identico ma fonte scaduta è considerato obsoleto; l'azione di recupero supervisionato della #105 lo può archiviare e riavviare dall'inizio, su conferma autore. Non inviare richieste AI su fonti non correnti.
- Le funzioni `adjudicationPrompt`, `validateJudgment` con capitolo live e `repairPrompt` rivalidano anche per chiamate dirette o checkpoint `repair` ripresi/importati; il runner verifica di nuovo `repairPrompt` quando applica la risposta per impedire correzioni su fonti ritirate durante la chiamata LLM.
- Vitest copre fonte attiva, nuova revisione che ritira la precedente, testo della fonte alterato, `unverified` senza fonte, ruolo falso, judgment e remediation invalidati, conservazione immutata dei vecchi report. Playwright desktop/mobile usa un checkpoint completo **12×1** con una fonte storica sostituita: deve mostrare il recupero disponibile e bloccare il giudice con **zero chiamate AI**.
- ADR 0101, manuale, AGENTS, feature, README e versioni package/lock 0.11.69 aggiornati; nessuna nuova dipendenza o endpoint. Il gate verifica **provenienza e citazione**, non la verità di un fatto, la correttezza dell'interpretazione LLM o l'indipendenza cognitiva dei revisori. Epic #20 e #23 restano aperte.

## 0.11.68 — 2026-11-09 (main, issue #105, epic #20)

**Recupero esplicito dei checkpoint di redazione invalidi, con archivio non distruttivo**

- Il pannello **Redazione multi-agente** mostra `Recupera checkpoint e ricomincia` solo quando il controllo della copertura della #104 rileva un checkpoint non valido nelle fasi `review`, `adjudicate` o `summary`. Il comando richiede una conferma dell'autore e avverte di ripetizione delle chiamate AI, backup e sospensione della sincronizzazione.
- La nuova `recoverEditorialCheckpoint` opera con Web Locks esclusivi del libro e outbox, controlla che l'autopilot sia fermo, che il checkpoint sia realmente invalido e che i rapporti non possano essere riutilizzati. Prima di creare una nuova `createEditorialCycle`, salva la copia **integrale e datata** della precedente sessione nell'archivio `editorialRecoveryArchives`, con motivazione e tutte le tornate, senza attribuire giudizi falsi né toccare prosa, memoria o capitoli congelati.
- In una sola transazione IndexedDB: nuovo ciclo `review` round 1, libro `paused`, `remote.autoSync=false`, outbox eliminata e Activity tracciabile. Confronto ottimistico `updatedAt` e massimo **8** snapshot; al limite l'operazione si ferma senza eliminare materiale precedente.
- Lo storico viene mostrato nel pannello per sola consultazione e incluso nella validazione del backup ZIP. Vitest verifica conferma, capitolo/canone invariati, salvataggio/ZIP, limiti, privacy e lock; Playwright desktop/mobile conferma annullamento, archiviazione via UI, nuova review senza chiamata al provider.
- ADR 0100, guida, AGENTS, README, feature e manifest/lock v0.11.68. Nessun backend, nuova dipendenza o nuovo costo AI non approvato; la review deve essere riavviata **dall'autore**, non dal sistema autonomamente.
- **Limiti:** lo snapshot è archivio locale di audit, non prova crittografica né certificazione del giudizio semantico. Per i cicli in fase `repair`, `blocked` o già conclusi restano le procedure di riapertura/supervisione distinte. L'epic #20 resta aperta.

## 0.11.67 — 2026-11-09 (main, issue #104, epic #20)

**Gate strutturale completo dei report prima del giudizio e del freeze**

- `EditorialReport.segmentTextStamp` registra per ciascun report nuovo una **impronta locale deterministica** (lunghezza UTF-16 e checksum FNV-1a) del segmento effettivamente letto, anche per `verdict=pass`. È un rilevatore di modifiche accidentali, **non una firma crittografica**, e non duplica il testo canonico. I vecchi archivi senza impronta restano leggibili; i checkpoint attivi legacy non sono automaticamente ritenuti aggiornati.
- `assertEditorialReviewCoverage` confronta il checkpoint con la matrice attesa di **12 ruoli × N segmenti**: ordine e identità dei ruoli, indici e conteggio dei segmenti, impronte, esito/pass/findings, ID univoci e citazioni letterali ancorate ai segmenti correnti. Report fuori ordine, duplicati, parziali, oltre la matrice o non più freschi bloccano la progressione invece di usare soltanto `reports.length`.
- `nextReviewSlot` verifica ogni prefisso prima di programmare il revisore seguente; il runner richiede matrice **completa** prima di chiamare il giudice, prima di applicare il suo verdetto e prima di ciascun passo di sintesi/freeze. Il controllo è ripetuto sul libro corrente al momento dell'applicazione, evitando approvazioni basate su un checkpoint cambiato. Nessuna nuova chiamata AI e nessuna riscrittura automatica.
- Vitest su 12×2 report, duplicazioni, ordine, stamp, legacy, pass stale, findings, quote e limite. Playwright desktop/mobile controlla un checkpoint incompleto in stato `adjudicate`: non deve inviare alcuna richiesta al provider, né congelare il capitolo. AGENTS, ADR 0099, guida, feature, changelog e package/lock 0.11.67.
- **Limiti:** verifica strutturale e freschezza **non** certificano indipendenza dei giudizi, correttezza delle critiche né verità storica. Un report legacy attivo senza stamp richiede una nuova revisione guidata dall'autore, non viene elevato automaticamente a «pass». Epic #20 resta aperta.

## 0.11.66 — 2026-11-09 (main, issue #103, epic #20)

**Segmentazione della prosa Unicode senza perdita per la redazione multi-agente**

- `chapterSegments` usa `Intl.Segmenter` con granularità `grapheme` per selezionare confini sicuri **dopo** la divisione preferenziale su frase o a capo, mantenendo ogni emoji, sequenza ZWJ, accento combinato e `CRLF` intero all'interno di un singolo segmento destinato ai 7 specialisti e ai 5 lettori.
- Corretto il limite di 10.000 unità UTF-16 per segmento: `lastIndexOf` non può includere una newline oltre il confine; gli input vengono **ricomposti esattamente senza alterare un carattere**, e rimane il blocco oltre 40 segmenti. Unicode UTF-16 malformato, un singolo grafema sopra limite o browser senza `Intl.Segmenter` su scene lunghe fermano la review con errore esplicito anziché produrre prompt ambigui/corrotti.
- Vitest verifica surrogate pair, accento combinante, sequenza emoji ZWJ, CRLF, newline/punto al confine, ricostruzione, limiti, prova narrativa Unicode ancorata al segmento corretto, browser senza API e input malformato. Playwright desktop/mobile intercetta i primi due prompt reviewer generati dal vero runner con testo Unicode al confine, confrontando la prosa ricostruita e i codepoint.
- ADR 0098, guida `docs/editorial-unicode-segmentation.md`, `docs/editorial-board.md`, AGENTS, README, feature e package/lock 0.11.66 aggiornati. Nessun cambiamento a contratti dei provider, dati persistiti, sincronizzazione o numero di chiamate AI; nessun pacchetto aggiunto.
- **Limiti:** il rispetto dei grafemi non certifica che un finding sia valido, non abilita nuove lingue nel modello e può modificare il confine di segmenti di review ancora aperte. Citazioni e prove stale non possono autorizzare accettazioni; rieseguire la review quando necessario, con consenso autore. Epic #20 ancora aperta.

## 0.11.65 — 2026-11-09 (main, issue #102, epic #4)

**PDF Unicode offline per latino esteso e cirillico con PT Serif incorporato e preflight cmap**

- Per manoscritti che contengono soltanto caratteri WinAnsi, `buildPdf` conserva il percorso rapido e l'impaginazione Times standard, con pagine e numerazione `Pagina X di Y` invariati.
- Se **solo il contenuto canonico** usa caratteri fuori WinAnsi, BookWriter carica in modo differito il modulo `pdf-unicode-font.ts` con PT Serif Regular/Bold, due **TTF statici originali** da Google Fonts sotto SIL Open Font License 1.1 (copyright ParaType, licenza integralmente conservata in `pdf-fonts/OFL.txt`). I file vengono inlined nei byte JS da Vite (`?inline`), non scaricati in fase di esportazione; nessuna API esterna o nuova dipendenza.
- Prima di creare qualunque PDF, un parser della tabella TrueType `cmap` format 4 verifica ogni carattere previsto nel titolo, nei capitoli, nelle scene e nei paragrafi canonici contro **entrambi** i font, normale e grassetto. Latin Extended e cirillico che hanno glifi reali sono permessi; emoji, CJK, scritture senza shaping verificato e surrogati malformati sono bloccati con codice `U+XXXX` e invito a EPUB/DOCX. Nessuna sostituzione silenziosa dei glifi non coperti.
- Vitest testa header/trailer, strutture PDF font embedded (`FontFile2`, `ToUnicode`), pagine, Unicode e limiti del repertorio; Playwright desktop/mobile scarica realmente un PDF con cirillico e latin extended, oltre al percorso fail-closed per emoji. Brief, segreti fuori canone, draft e scene planned restano esclusi.
- ADR 0097, AGENTS, README, guida e feature aggiornati; `package.json`/`package-lock.json` v0.11.65; nessun cambio al modello dei dati, API di rete, branch o PR.
- **Limiti:** questa non è copertura Unicode completa: arabo/RTL, CJK, emoji e complessità di shaping/ligature richiedono font e test specifici. Mancano PDF/A, tagging accessibile e certificazione tipografica; epic #4 rimane aperta.

## 0.11.64 — 2026-11-09 (main, issue #101, epic #4)

**EPUBCheck ufficiale su una matrice di quattro libri sintetici generati da BookWriter**

- `epubcheck-fixture.test.ts` genera quattro manoscritti **distinti** tramite `newBook` e `buildEpub`, con UUID sintetici separati e data fissa: misto canonico/draft/planned; primo capitolo pubblicato solo dopo capitoli interamente esclusi; Unicode multilingua, apostrofi, emoji, escaping XML 1.0, controlli e surrogati malformati; sei capitoli canonici con scene multiple e prosa lunga.
- Vitest per ciascuno controlla ZIP, titolo/frontespizio, `toc` e `landmarks`, numero e ordine dei capitoli/scene, `spine`, assenza di materiali privati e byte Unicode vietati. I test ordinari generano solo dati in memoria; con `EPUBCHECK_OUTPUT_DIR` impostata dalla CI scrivono un file EPUB a nome fisso per ogni caso.
- Il job `epubcheck` espone `EPUBCHECK_OUTPUT_DIR` **solo negli step** che lo usano, così il riferimento a `runner.temp` è valutato in un contesto valido; la prima run con la variabile in `jobs.epubcheck.env` non avviava alcun job per errore di workflow e viene corretta senza aggirare i test.
- Il job `epubcheck` verifica che esistano **esattamente quattro** file non vuoti ed esegue EPUBCheck **5.4.0 ufficiale su ciascuno**. Fallimento bloccante su test, checksum, file mancante o codice di uscita non zero di qualsiasi singolo EPUB. Release e digest SHA-256 non cambiano.
- Aggiornati guida, ADR 0096, README, AGENTS, feature, changelog e package/lock 0.11.64. Nessuna nuova dipendenza, nessun cambio all'export in produzione o ai libri persistiti; CI frontend, Playwright desktop/mobile, Pages e cleanup restano obbligatori.
- **Limiti:** quattro casi rappresentativi non certificano tutte le combinazioni di autori, e-reader, accessibilità o font Unicode PDF. Epic #4 aperta.

## 0.11.63 — 2026-11-09 (main, issue #100, epic #4)

**Validazione EPUB ufficiale con EPUBCheck 5.4.0 nella CI**

- Aggiunto un job parallelo `epubcheck` nel workflow Frontend CI, obbligatorio sui push `main` e sulle PR. Il job usa Temurin Java 21, il CLI EPUBCheck W3C/DAISY **v5.4.0**, scaricato dall'asset ufficiale della release e verificato con SHA-256 `33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c` ottenuto dal digest dell'asset GitHub.
- Un test Vitest crea un **manoscritto sintetico** con titolo escaped/emoji, capitoli con prosa `canon`, scene `draft/planned`, capitoli da omettere, memoria e brief riservati. Il test invoca il vero `buildEpub`, controlla ZIP, selezione, nav e privacy; solo con `EPUBCHECK_OUTPUT` impostata dalla CI scrive il file EPUB da sottoporre alla CLI ufficiale. Nessun libro personale viene letto o caricato.
- Esecuzione bloccante: exit code non-zero di `java -jar epubcheck.jar <file.epub>` fallisce il job, senza `continue-on-error`, output nascosto o download non verificati. Mantiene i test precedenti Vitest/Playwright desktop/mobile.
- Documentati procedura locale, versione e hash in `docs/epubcheck-ci.md` e ADR 0095; README, AGENTS, feature e package/lock `0.11.63` aggiornati, senza nuove dipendenze runtime né variazioni del canone persistito o dell'export utente.
- **Limite esplicito:** la validazione ufficiale si applica al *campione sintetico CI*, non equivale alla certificazione di ogni libro generato o al test su un e-reader fisico. Compatibilità Unicode PDF, accessibilità, immagini e ZIP avanzato restano nell'epic #4.

## 0.11.62 — 2026-11-09 (main, issue #99, epic #4)

**PDF con numerazione editoriale delle pagine dei capitoli canonici**

- Dopo il rendering dei titoli, delle scene e dei paragrafi, `buildPdf` calcola tutte le pagine e aggiunge in basso al centro il footer `Pagina X di Y`, con **X=1** sulla prima pagina del primo capitolo pubblicato e **Y** pari al numero totale delle pagine del testo canonico (inclusi i fogli di continuazione).
- Il titolo/frontespizio non riceve folio, nemmeno quando il titolo molto lungo occupa più pagine. Il numero non compare nelle aree della prosa: margine inferiore riservato, font standard Times 9 pt, nessun cambio al file input o al suo stato persistito.
- La whitelist WinAnsi fail-closed e i confini di privacy restano invariati: nessuna scena `draft/planned`, brief, memory o chiave; i PDF con caratteri non supportati continuano a bloccarsi prima del download, con alternativa EPUB/DOCX.
- Vitest verifica intestazione/trailer PDF, conteggio pagine e footer in sequenza, capitoli canonici lunghi su più pagine e frontespizio multipagina; Playwright desktop/mobile apre il PDF scaricato realmente e controlla i footer oltre alle verifiche privacy e fail-closed preesistenti.
- [ADR 0094](../ADR/0094-pdf-canonical-folios.md), AGENTS, README, guida, feature e `package.json`/`package-lock.json` 0.11.62 aggiornati, senza nuove dipendenze o endpoint. La verifica di deploy Pages rimane separata nella [issue #98](https://github.com/KeyserDSoze/BookWriter/issues/98); nessuna dichiarazione di pubblicazione web finché Pages non è verde.
- Limitazioni ancora aperte nell'epic #4: font Unicode incorporati, PDF accessibile/PDF-A, veri lettori, copertine e impaginazione avanzata.

## 0.11.61 — 2026-11-09 (main, issue #97, epic #4)

**EPUB 3 con frontespizio nel reading order e landmarks semantici**

- `buildEpub` crea `OEBPS/titlepage.xhtml` con soltanto il titolo pubblico, in `h1` etichettato e `section epub:type="titlepage"`. Il testo è passato dall'escaping/sanitizzazione XML già usata per l'EPUB; non sono inventati autore, copertina o contenuti narrativi.
- Il frontespizio è dichiarato nel manifest e compare come **primo `itemref` dello spine**. I capitoli `canon` mantengono l'ordine esistente; i rispettivi XHTML dichiarano `body epub:type="bodymatter"` e continuano ad avere le ancore di scena v0.11.58.
- `nav.xhtml` mantiene un solo `toc` a due livelli capitoli→scene e aggiunge un solo `nav epub:type="landmarks"`: due link semanticamente distinti verso `titlepage.xhtml` e `chapter-1.xhtml`, che è il **primo capitolo pubblicato** anche quando il capitolo numerato 1 è solo bozza. Nessuna credenziale o bozza raggiungibile da TOC o landmarks.
- Vitest verifica struttura ZIP/manifest/spine, HTML-escaping/Unicode, ordine e caso primo capitolo draft; Playwright desktop/mobile scarica l'EPUB, segue i due landmarks con `DOMParser(application/xml)` e **risolve ogni elemento di manifest verso un entry ZIP esistente e ogni idref di spine verso il manifest**, oltre ai link TOC per scena.
- ADR 0093, guida, AGENTS, feature, README, versioni `package.json`/`package-lock.json` 0.11.61 aggiornati senza nuove librerie o API. **Non** equivale a EPUBCheck o audit su e-reader fisici.

## 0.11.60 — 2026-11-09 (main, issue #96, epic #4)

**PDF fail-closed per glifi non supportati e builder verificabile**

- `infrastructure/export-book.ts` separa `buildPdf(book): Promise<Uint8Array>` dal download `exportPdf`, che resta locale e usa MIME `application/pdf`. La prosa non lascia il browser, e non sono stati aggiunti font di terze parti, dipendenze o chiamate di rete.
- Prima di renderizzare, `printablePdfText` filtra controlli XML vietati e verifica titolo, intestazioni e paragrafi canonici. Sono ammessi ASCII, Latin-1 e segni speciali WinAnsi (euro, apostrofi/virgolette tipografiche, trattini). Unicode non rappresentabile come emoji/CJK/surrogati invalidi blocca l'esportazione **senza scaricare** un PDF corrotto, indicando EPUB o DOCX.
- I controlli non prendono in esame `brief`, memoria, sceneggiature `draft/planned` o altri contenuti privati. Solo scene `canon` non vuote producono pagine; nessun canon = errore già previsto.
- Vitest controlla byte PDF, pagine, ordine dei capitoli e delimitazione degli input Unicode; Playwright desktop/mobile verifica l'assenza di download su emoji e il download PDF reale con italiano accentato e parti private escluse.
- ADR 0092, AGENTS, README, guida, feature e package/lock v0.11.60 aggiornati. **La compatibilità Unicode completa resta aperta**: servono font incorporati, licenze e test visivi/di estrazione su lettori PDF; questa release evita una perdita silenziosa, non la risolve universalmente.

## 0.11.59 — 2026-11-09 (main, issue #95, epic #4)

**DOCX controllabile come ZIP OPC, WordprocessingML XML-safe e prosa solo canonica**

- `infrastructure/export-book.ts` introduce `buildDocx(book): Promise<Uint8Array>` senza download e mantiene `exportDocx` come wrapper locale con MIME e file `.docx` invariati. `Packer.toBlob` genera il package Word, il builder lo rende ispezionabile dai test.
- Libro, titoli capitoli, titoli scene e paragrafi passano attraverso la stessa sanitizzazione XML 1.0 dell'EPUB **prima** di entrare in `docx`, rimuovendo controlli illeciti e sostituendo surrogati UTF-16 isolati senza perdere accenti o emoji. Il serializer Word gestisce l'escaping di `&<>"'`; i dati AI sono testo, non markup.
- Contenuto ammesso: solo capitoli con scene `canon` e testo non vuoto, con titoli e prosa in ordine. Nessun testo `draft/planned`, `brief`, memoria, credenziale o log nell'edizione. Libro privo di canon ⇒ errore italiano, nessun download.
- Vitest apre il package DOCX con `fflate.unzipSync`, controlla `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `docProps/core.xml`, ordine, privacy e input XML avversari. Playwright desktop/mobile scarica un DOCX vero da Archivio e sottopone i documenti XML al parser Chromium, confrontando i paragrafi canonici.
- ADR 0091, guida export, README, AGENTS, features, changelog e package/lock 0.11.59 aggiornati, senza nuove dipendenze né chiamate remote. **Non** equivale a test Word/LibreOffice su dispositivo, certificazione accessibilità, tipografia completa, correzione Unicode PDF o restore ZIP avanzato; #4 resta aperta.

## 0.11.58 — 2026-11-09 (main, issue #94, epic #4)

**Indice EPUB 3 navigabile per singole scene canoniche, con ancore XHTML semantiche**

- `buildEpub` mantiene il sommario EPUB per capitoli e aggiunge una sottolista di link relativi `chapter-N.xhtml#scene-M` per **ogni scena canonica effettivamente esportata**, nell'ordine della prosa. Le scene `draft`, `planned` e canoniche con testo vuoto non creano ancore o voci, neppure se compaiono tra due scene valide.
- Ogni pagina XHTML riceve `section id="scene-M" aria-labelledby="scene-M-title"` e `h2 id="scene-M-title"`, con numerazione locale deterministica, senza esporre UUID e senza usare titoli/slug come ID. I link e i titoli dell'indice continuano ad avere escaping XML; il nome del capitolo nell'indice include il numero originale per evitare ambiguità.
- Vitest verifica link, ancore, ordinalità, testo malformato/escaping e contenuti esclusi; Playwright desktop/mobile scarica l'EPUB vero, analizza tutto l'XML e risolve i link dell'indice fino ai titoli delle scene con `DOMParser`.
- ADR 0090, AGENTS, README e guida aggiornati, package e lock 0.11.58. Nessun nuovo pacchetto, API, modifica dei libri locali o trasferimento di testo in rete.
- Le validazioni strutturali non costituiscono certificazione EPUBCheck o accessibilità completa: font PDF, layout/illustrazioni, verifica e-reader e backup avanzati restano aperti nell'epic #4.

## 0.11.57 — 2026-11-09 (main, issue #93, epic #4)

**EPUB 3 con struttura ZIP verificabile, XHTML sicuro e controllo della sola prosa canonica**

- `infrastructure/export-book.ts` separa il builder puro `buildEpub(book, modifiedAt?)` dal download `exportEpub`. Il pacchetto EPUB è ora ispezionabile/testabile senza eseguire DOM o simulare clic, mentre l'API dell'interfaccia e l'esportazione DOCX/PDF rimangono compatibili.
- Il test del pacchetto verifica primo entry ZIP `mimetype` **STORED (method 0)** senza extra, byte MIME esatti, `META-INF/container.xml`, OPF con identificatore/metadata/manifest/spine, indice nav XHTML e file XHTML dei soli capitoli con scene `canon`. L'ordine dei capitoli pubblicati segue il libro; il loro **numero originale** rimane nei titoli.
- La funzione di escaping XML esclude controlli illegali XML 1.0 e sostituisce surrogati UTF-16 isolati, preservando accenti, emoji, newline e tipografia valida. Tutti i contenuti narrativi continuano a ricevere escaping di `&<>"'`; un provider AI non può generare caratteri XML invisibili che invalidino il file.
- Test Vitest con `fflate.unzipSync`, verifica header ZIP locale, manifest/spine, esclusione scene `draft/planned`, brief/memory non canonici, Unicode e errore su libro privo di scene canoniche. Test Playwright desktop/mobile esporta un file reale dall'interfaccia, apre il ZIP scaricato e sottopone OPF/container/nav/XHTML al `DOMParser(application/xml)` del browser.
- Nuova [guida export](book-export.md), [ADR 0089](../ADR/0089-epub3-canonical-export-validation.md), AGENTS, README e documentazione aggiornati; nessuna dipendenza aggiuntiva, nessun dato inviato fuori dal browser.
- Questa tranche **non** certifica EPUBCheck né risolve ancora font Unicode PDF, cover/illustrazioni, layout e accessibilità DOCX/EPUB/PDF o import/export ZIP completo: la [epic #4](https://github.com/KeyserDSoze/BookWriter/issues/4) rimane aperta.


## 0.11.56 — 2026-11-09 (main, issue #92, #10, #3, #6)

**Intenti GitHub manuali sospesi riconciliabili attraverso merge binari verificati**

- Prima la verifica del vecchio push sospeso richiedeva una catena parent **lineare**, quindi un successivo merge Git impediva di riconoscere un commit già pubblicato, pur essendo antenato della HEAD. Ora la riconciliazione **esplicita dell'autore** percorre via sole GET **entrambi i parent** dei merge Git standard e l'intero grafo raggiungibile dal branch originale, sopra la baseline originaria.
- Il budget è di **32 commit distinti complessivi** (non 32 per ramo). Parent SHA devono essere validi, senza duplicati o self-parent; un controllo DFS verifica assenza di cicli, distinguendo gli antenati condivisi da veri loop. I merge octopus (>2 parent), commit mancanti, grafi più grandi e prove incomplete restano fail-closed.
- Un solo commit storico può corrispondere al messaggio `bookwriter: sync <operationId>`; deve avere parent **unico e uguale alla baseline** (se nota), e il marker `.bookwriter/sync.json` letto con `ref=<sha del candidato>` deve attestare `bookId,operationId,sourceRevision` esatti. Un secondo candidato sul ramo opposto o marker incoerente impediscono l'archiviazione. La HEAD viene riletta **dopo aver verificato tutti i rami**, e deve rimanere invariata.
- Le garanzie locali della v0.11.54 rimangono: consenso umano, Web Locks writer→outbox, CAS `books+meta`, cancellazione **solo dell'intento durabile** verificato. Nessun push, force push, merge di contenuti, modifica di canon, libro, outbox, remote o PAT. Il risultato indica lo SHA originale, non la successiva HEAD di merge.
- Unit test Vitest su merge valido sui due rami e annidato, doppio candidato, marker falso, parent sbagliato, loop, octopus, budget esaurito, HEAD mobile e rete persa. Playwright desktop/mobile con due schede, HEAD in merge e primo marker falso seguito dalla prova valida, sempre tramite GET. ADR 0088, AGENTS, README e guide aggiornati.
- **Limitazioni:** il controllo puntuale della HEAD non crea fencing remoto e GitHub/IndexedDB restano transazioni distinte. Storie profonde, octopus merge e sincronizzazioni cross-device complesse restano nelle issue #10/#3/#6.


## 0.11.55 — 2026-11-09 (main, issue #91, #10, #3, #6)

**Riconciliazione dei push GitHub storici sulla catena lineare della HEAD**

- La riconciliazione esplicita degli intenti manuali sospesi (v0.11.54) prima accettava soltanto un commit **sulla HEAD corrente**. Se un secondo dispositivo aveva successivamente avanzato lo stesso branch, l'operazione originale poteva essere un antenato legittimo ma non veniva più riconosciuta.
- Ora `verifyPublishedManualPush` segue in **sole GET** la catena parent Git dalla HEAD della **repository originaria** per massimo **32 commit**, richiedendo a ogni passo un **solo parent con SHA valido** e senza cicli, merge o storia incompleta. Un commit con messaggio `bookwriter: sync <operationId>` viene verificato soltanto se ha parent unico == `baseSha` dell'intento (quando presente), e il marker `.bookwriter/sync.json` allo **SHA del commit storico** contiene `bookId,operationId,sourceRevision` esatti.
- Una nuova GET della HEAD deve ritrovare **lo stesso SHA iniziale** prima dell'archiviazione. Commit non raggiungibili, branch cambiato, parent o marker non validi, cronologia oltre il limite, merge e errori di rete restano **fail-closed**; non si cancella un intento in base a prove parziali.
- Lo use case protetto di ADR 0086 conserva conferma autore, Web Locks writer→outbox e CAS `books+meta`; viene cancellato **solo l'intento già provato**, mai manoscritto, nuova baseline, outbox o PAT. Il risultato restituisce lo **SHA del commit originale**, senza attribuire all'autore l'ultimo commit di un'altra scheda.
- Il push normale e il recovery immediato di un ACK perso continuano a richiedere HEAD identica al commit appena pubblicato. Nessuna scansione storica è usata per giustificare un push automatico.
- Vitest su commit storico a uno/due salti, prova marker allo SHA originario, HEAD che cambia, marker/messaggio/parent falsi, merge/cicli, limite profondità e rete persa. Playwright desktop/mobile con due schede e HEAD avanzata da altro dispositivo, prova negativa e positiva senza POST/PATCH. ADR 0087, AGENTS, README e guide aggiornati.
- **Limiti aperti:** il percorso non attraversa merge né storie oltre 32 commit e non è fencing cross-device atomico. Cronologia complessa e modifiche concorrenti remote richiedono review guidata, non reset forzato (#10/#3/#6).


## 0.11.54 — 2026-11-09 (main, issue #90, #10, #3, #6)

**Riconciliazione esplicita dei push GitHub sospesi quando cambiano repository o baseline**

- Il push manuale conserva dalla v0.11.53 l'identificatore del tentativo in IndexedDB, ma se la repository/branch o `lastSyncedCommit` cambiano il retry viene bloccato per non attribuire il vecchio push alla nuova destinazione. Ora il pannello mostra **Tentativo manuale GitHub sospeso**, indicando la destinazione originale, e offre l'azione volontaria **Verifica e archivia tentativo precedente** con conferma autore. Nessuna cancellazione automatica all'apertura della pagina.
- `verifyPublishedManualPush` effettua soltanto **GET** sulla repository originaria: HEAD SHA valida e diversa dal vecchio parent, commit con messaggio esatto `bookwriter: sync <operationId>`, **parent unico** uguale alla `baseSha` attesa e marker `.bookwriter/sync.json` allo SHA della HEAD con `bookId`, `operationId` e `sourceRevision` esatti. Senza tutte le prove l'intento non viene archiviato, nemmeno se la HEAD è semplicemente diversa.
- `reconcileSuspendedManualPush` prende Web Locks writer del libro → outbox `ifAvailable:true`, verifica che libro non sia in `running` e che la destinazione/baseline sia davvero divergente, attesta il vecchio commit in sola lettura e **rilegge libro+intento nella stessa transazione IndexedDB** prima di cancellare solo `meta["manual-github-push:<bookId>"]`. Se un'altra scheda cambia revisioni, remote o UUID durante le GET, la cancellazione viene rifiutata.
- Non viene eseguito nessun POST/PATCH GitHub; non si modificano canone, libro, `updatedAt`, baseline della nuova repository, PAT, permessi né outbox. Il precedente commit è considerato verificato sulla vecchia destinazione, **non** sincronizzato sulla nuova.
- Vitest per HEAD, messaggio, parent, marker errati e rete persa, prova valida, lock occupati e transazione stale. Playwright desktop/mobile con due tab, modifica concorrente, marker falso fail-closed e riconciliazione successiva verificata. ADR 0086, AGENTS, README e guida GitHub/autopilot aggiornati.
- **Rimangono aperti** recovery di commit non più sulla HEAD, cronologia di divergenze, fencing fra dispositivi, ZIP snapshot e sincronizzazione GitHub/IndexedDB non distribuita (#10/#3/#6).


## 0.11.53 — 2026-11-09 (main, issue #89, #10, #3, #6)

**Push manuale GitHub recuperabile anche dopo reload e arresto improvviso della scheda**

- Il push manuale prima generava `operationId` soltanto in memoria: dopo un crash, un nuovo click non poteva riconoscere il marker del proprio commit già pubblicato. Ora registra **prima di qualunque HTTP** un `ManualPushIntent` durabile nello store IndexedDB `meta` esistente, con libro, UUID, destinazione, baseline, revisione iniziale e timestamp, senza PAT o dati segreti.
- Il pulsante **Sincronizza su GitHub** usa `pushManualGitHubBook`, che acquisisce senza attesa i Web Lock `bookwriter:writer:<bookId>` e `bookwriter:github-outbox` nello stesso ordine delle modifiche manuali protette. Niente chiamate se il writer o la coda sono in uso, o se manca il supporto Web Locks.
- Quando l'autore riprova dopo un reload, il nuovo invio riutilizza l'UUID esatto del tentativo precedente. Se GitHub ha già pubblicato quel commit, il recovery in sola lettura della v0.11.52 verifica HEAD, messaggio Git e marker; **nessun POST/PATCH aggiuntivo**, anche quando un'altra scheda ha aggiornato il testo locale nel frattempo.
- `persistRemoteAcknowledgment` registra insieme commit GitHub, decisione sulla outbox e cancellazione del **solo intento manuale con UUID corrispondente** nella transazione `books+outbox+meta`. Un errore remoto, una baseline cambiata o un ACK estraneo non eliminano il record durabile né la coda; le modifiche al canone più recenti restano intatte.
- Un intento verso una repository/branch o baseline diversa viene rifiutato con errore esplicito, senza ruotare l'ID o aggirare il controllo dei conflitti. La coda autosync rimane separata e non viene riproposta implicitamente per il push manuale.
- Vitest su intent persistente, lock occupati/assenti, ACK atomico, outbox indipendente e mismatch; Playwright desktop/mobile con **due schede reali**, PATCH applicato ma risposta e readback persi, reload, retry senza nuovi commit e nuovo checkpoint preservato. ADR 0085, AGENTS, README e guide aggiornati. **Limitazione:** l'intento locale non è condiviso tra dispositivi; GitHub e IndexedDB restano non atomici cross-device.


## 0.11.52 — 2026-11-09 (main, issue #88, #10, #3, #6)

**Push GitHub: recupero immediato in sola lettura di un PATCH già applicato con risposta persa**

- Una richiesta PATCH del branch può aggiornare GitHub prima che la connessione si interrompa o restituisca un HTTP 5xx. Prima BookWriter vedeva solo l'errore; il worker autosync poteva recuperare al retry successivo grazie all'operationId duraturo, ma il **push manuale** generava un nuovo ID a ogni tentativo e non poteva recuperare il commit già riuscito.
- Ora, **soltanto dopo l'errore ambiguo del PATCH**, il client rilegge la HEAD e richiede lo SHA esatto del commit appena creato, controlla il messaggio `bookwriter: sync <operationId>`, poi legge il marker `.bookwriter/sync.json` da quello stesso SHA. `operationId`, `bookId` e `sourceRevision` devono coincidere con lo snapshot effettivamente pubblicato.
- Soltanto se tutte le prove corrispondono, il push (anche manuale) termina con `recovered:true` e salva l'ACK tramite la transazione atomica `books+outbox` introdotta in 0.11.50. Nuove scene, prosa o vincoli creati durante il PATCH non vengono persi; un checkpoint più recente rimane in coda. Non viene effettuato alcun nuovo PATCH né `force:true`.
- Se la HEAD non avanza, è di un altro writer, il marker è incompleto/estraneo, la rilettura perde la rete o GitHub rifiuta certamente la scrittura (409/422), l'operazione resta fallita **senza ACK locale**, senza ritentare il PATCH. Restano in vigore i controlli SHA/HEAD del 2xx dalla 0.11.51 e il recovery preesistente sul retry con operationId.
- Vitest su errore trasporto prima e dopo l'applicazione, HTTP 503 dopo commit, marker/messaggio errati, readback perso, 409, un solo PATCH e risultato manuale recuperato. Playwright desktop/mobile con due schede, primo falso 2xx fail-closed e poi PATCH applicato con risposta persa più nuovo checkpoint concorrente preservato.
- ADR 0084, AGENTS, README, guide e package/lock aggiornati. Restano aperte transazione distribuita GitHub/IndexedDB, crash dell'intero browser durante push manuale, device separati e snapshot ZIP periodici (#10/#3/#6).


## 0.11.51 — 2026-11-09 (main, issue #87, #10, #3, #6)

**Push GitHub: HEAD esatta verificata prima di confermare e svuotare l'outbox**

- `pushGitHubBook` usava `PATCH /git/refs/heads/<branch>` con `force:false` ma considerava il solo status 2xx sufficiente per attestare `lastSyncedCommit` e chiudere la coda. Ora **verifica che la risposta `object.sha` corrisponda esattamente al commit appena creato**, poi legge di nuovo la HEAD del branch e richiede lo stesso SHA prima dell'ACK locale.
- Se GitHub dichiara un SHA diverso o mancante, la HEAD resta sul commit precedente, avanza verso un altro SHA o la rilettura fallisce, il push viene rifiutato in modo conservativo: **libro, baseline GitHub e outbox non vengono falsamente confermati**. Nessun `force:true` o retry automatico del PATCH incerto.
- La logica di recupero del marker `.bookwriter/sync.json` introdotta nelle versioni precedenti rimane attiva: se l'ACK della rete è perso dopo l'aggiornamento remoto, un successivo tentativo con identico `operationId` può riconoscere in sola lettura il commit esatto senza ripetere POST/PATCH.
- L'ACK IndexedDB unico `books+outbox` della v0.11.50 segue i due controlli remoti; conserva un checkpoint creato da un'altra tab durante il push. Le verifiche di contenuti congelati, permessi PAT, repository pubbliche e lease writer AI non cambiano.
- Vitest su PATCH 2xx con risposta sbagliata o incompleta, HEAD non avanzata/diversa, perdita della verifica di rete, invio riuscito con tre letture della HEAD e recovery read-only. Playwright desktop/mobile con due schede e simulazione di falso 2xx, nuovo invio esplicito corretto e scrittura concorrente durante il PATCH. ADR 0083, AGENTS, README e guide aggiornati.
- Questa garanzia riguarda la HEAD **nell'istante della conferma**: GitHub e IndexedDB restano sistemi indipendenti e altre scritture possono arrivare dopo. Il fencing cross-device e il gap HTTP→commit locale rimangono aperti nelle epic #10/#3.


## 0.11.50 — 2026-11-09 (main, issue #86, #10, #3, #6)

**Conferma del commit GitHub e outbox atomiche nel browser**

- Dopo la conferma di un `PATCH force:false` GitHub, il precedente ACK leggeva il libro in una transazione e lo riscriveva in un'altra: una nuova revisione canonica o un vincolo dell'autore potevano andare persi. La funzione `persistRemoteAcknowledgment` ora **rilegge il libro e aggiorna soltanto i metadati GitHub nella stessa transazione readwrite che controlla l'outbox**, preservando il testo e il timestamp `updatedAt` più recenti.
- La coda viene completata **nello stesso commit locale** dell'ACK. Se la revisione pubblicata è quella corrente, la richiesta viene rimossa anche per una sincronizzazione manuale; se un writer ha creato una nuova revisione durante il PATCH, la nuova richiesta resta pendente, con ID ritentabile e contatori azzerati soltanto per l'operazione vecchia. I conflitti già bloccati o le richieste indipendenti non vengono silenziosamente sbloccati.
- Il commit locale rifiuta una repository diversa, un libro non più presente o una baseline `lastSyncedCommit` già avanzata verso un altro SHA: nessuna risposta tardiva può retrocedere la baseline. Il recupero del marker remoto `.bookwriter/sync.json` usa la stessa logica, **senza nuove chiamate POST/PATCH**.
- Rimossi da `auto-sync.ts` e `GitHubSyncPanel.tsx` gli ACK outbox successivi a `pushGitHubBook`: la doppia scrittura non è più necessaria e un arresto fra ACK e cancellazione coda non può più lasciare un duplicato locale.
- Nuovi Vitest su ACK, revisione concorrente, outbox, cambio repository, conferme obsolete, idempotenza e dati bloccati; test Playwright desktop/mobile con due schede che intercalano una modifica del libro a un PATCH GitHub simulato. ADR 0082, AGENTS, README e guide aggiornati.
- Il commit remoto **non** è parte della transazione IndexedDB: nel gap tra rete e commit locale il recovery con marker rimane conservativo. Restano le altre vulnerabilità cross-device, gli altri editor manuali e gli scenari fisici mobile (#10/#3/#6). Nessun nuovo formato, schema, provider o token.


## 0.11.49 — 2026-11-09 (main, issue #85, #10, #6, #3)

**Collegamento GitHub e policy autosync protetti dagli stessi Web Locks del writer e della coda**

- Prima, il pannello GitHub collegava una repository oppure modificava l'opzione di autosync con `getBook` / `saveBook` senza Web Locks né revisione attesa: una tab obsoleta poteva riscrivere lo stato del libro durante un checkpoint AI. Le nuove funzioni `connectBookRemote` e `setBookAutoSync` usano il token `updatedAt` visto dall'utente e acquisiscono **writer del libro → github-outbox**, senza attesa, prima di leggere e modificare `remote`.
- Collegamento GitHub: la destinazione viene ancora convalidata da `validateRemote` e `inspectRepository`, con verifica esplicita della pubblicazione su repository pubbliche. Dopo il lock vengono ricontrollati libro corrente, stato, versione e divieto di migrare silenziosamente un libro già sincronizzato. Il controllo resta valido anche se la verifica remota ha richiesto tempo.
- Opt-in/out autosync: prima dell'abilitazione il codice applicativo ricontrolla la **versione attuale** di scene fuse, ciclo editoriale, capitoli non congelati e commit GitHub precedente, anziché fidarsi della vecchia UI. L'update di `remote` salva con CAS `saveBook(...,expectedUpdatedAt)` nella transazione `books+outbox`: un conflitto non modifica né libro né richieste pendenti.
- Un invio GitHub già attivo mantiene il lock outbox: il cambio policy viene rifiutato fino al termine, non si pretende di annullare un upload già partito. Disabilitare autosync **preserva** la coda, abilitarlo accoda solo checkpoint ammessi. La UI ricarica il libro su conflitto e mostra la motivazione italiana, senza retry implicito.
- Nuovi Vitest su collegamento stale, repository già sincronizzata, writer/outbox occupati, mancanza Web Locks, `running`, guardie editoriali, coda e concorrenza; Playwright desktop/mobile con due tab reali su collegamento e toggle stale e lock realmente occupato.
- ADR 0081, AGENTS, README e guida GitHub aggiornati. Nessun nuovo endpoint, schema, commit forzato, credenziale o provider. **Restano aperti** gli altri edit manuali, l'ACK GitHub non atomico e il coordinamento fra browser/dispositivi (#10/#3).


## 0.11.48 — 2026-11-09 (main, issue #84, #10, #15, #6, #3)

**Conferma delle scene fuse: aggiornamento del canon e audit con la stessa precondizione atomica**

- La conferma editoriale manuale di una scena `draft` già verifica `updatedAt` e usa i Web Locks del writer e dell'outbox. La protezione ora arriva **fino al commit IndexedDB**: `saveBookAndActivity` accetta un `expectedUpdatedAt` facoltativo e lo confronta dentro la stessa transazione `books+activities+outbox`, **prima di qualsiasi scrittura**.
- Se fra lettura e commit il libro è cambiato, l'approvazione fallisce con `BookRevisionConflict`: nessuna scena canonizzata dalla versione obsoleta, nessuna attività di approvazione fittizia, nessuna modifica alla coda outbox. Due conferme con lo stesso token possono produrre un solo audit.
- `confirmEditorialScene` passa fino al commit il token della revisione vista dall'autore; i lock, il doppio consenso, i controlli `draft`/testo e la policy autosync disabilitata restano invariati. L'interfaccia ricarica il libro anche su errore, chiedendo una nuova rilettura; nessun retry o push implicito.
- Nuovi Vitest per successo, CAS stale senza effetti collaterali e concorrenza; Playwright Chromium desktop/mobile con **due schede reali**, lock occupato, conferma canonica valida e rifiuto della seconda conferma stale senza duplicare l'audit.
- `saveBookAndActivity` mantiene la firma compatibile per i checkpoint AI esistenti grazie al terzo parametro facoltativo. Nessun cambio al modello dati, ZIP, lease, GitHub API, token o chiamate AI. ADR 0080, AGENTS, README e guida fusioni aggiornati. **Restano aperti** il fencing degli altri editor, la concorrenza fra dispositivi e il gap tra GitHub e IndexedDB (#10).


## 0.11.47 — 2026-11-09 (main, issue #83, #10, #6, #3)

**Feedback autore: revisioni manuali senza sovrascrivere checkpoint più recenti**

- `requestRevision` richiede ora l'`updatedAt` effettivamente visualizzato dall'autore prima di introdurre un vincolo permanente e impostare `phase=revision` / `status=paused`. Senza token o su revisione stale, rifiuta la modifica senza introdurre un vincolo nell'archivio e senza sovrascrivere checkpoint/canon.
- Prima di rileggere il libro, richiede il Web Lock esclusivo `bookwriter:writer:<bookId>` con `ifAvailable:true`, lo stesso mantenuto dall'autopilot. L'assenza di Web Locks e il lock detenuto da un'altra scheda bloccano la revisione in modo conservativo, anche se l'interfaccia ancora visualizza il vecchio stato `paused`.
- La funzione ricontrolla le invarianti editoriali e salva con il CAS `saveBook(book,true,expectedUpdatedAt)`: confronto della revisione **anche nella transazione IndexedDB books+outbox**, rifiuto di conflitti senza alterare dati o coda sync. Nessuna chiamata GitHub/AI aggiuntiva o retry silenzioso.
- La Dashboard passa la revisione letta, ricarica il libro se il salvataggio viene rifiutato e **mantiene il testo digitato** per permettere una nuova decisione consapevole. Svuota il feedback solo dopo un commit riuscito.
- Vitest su successo, input vuoto, libro running, vincoli editoriali, due submit contemporanei, lock occupato/mancante e stato stale con outbox preservata; Playwright desktop/mobile con **due schede reali** che simulano stale e writer occupato, quindi retry esplicito. ADR 0079, AGENTS, README e guide aggiornati.
- Limite: protegge il **percorso feedback autore nel browser**; le altre modifiche manuali e le divergenze fra dispositivi rimangono aperte nell'epic #10, senza garanzie di fencing transazionale remoto.


## 0.11.46 — 2026-11-09 (main, issue #82, #10, #6, #3)

**Impostazioni per libro: stop a salvataggi manuali di snapshot obsoleti**

- Se due schede mostrano versioni diverse dello stesso libro, cambiare l'override dell'endpoint o modello **non** salva più l'intero record React senza controllare la revisione. `updateBookModelRoute` tenta il Web Lock esclusivo del writer per il singolo libro e legge i dati correnti solo sotto lock; se il lock è occupato, Web Locks manca o il libro è ancora `running`, la modifica è rifiutata senza interrompere l'autopilot.
- `saveBook` supporta una precondizione **facoltativa** `expectedUpdatedAt`: il confronto viene eseguito dentro la stessa transazione IndexedDB `books+outbox`, per impedire che una scrittura tra lettura e commit faccia perdere canone, altri override o stato. Su conflitto il libro e l'outbox restano intatti; i vecchi caller AI mantengono le loro firme e protezioni.
- La UI mostra un messaggio in italiano, **ricarica** il libro sul conflitto e consente di reinserire il valore desiderato; il campo modello committa **su blur** anziché su ogni carattere, per non invalidare la revisione durante la digitazione. Gli override modificano solo `modelRoutes[task]`.
- Nuovi Vitest: successo/preservazione degli altri campi, writer occupato, assenza Web Locks, libro `running`, collisione fra due edit e CAS stale con outbox invariata. Playwright desktop/mobile: due tab con snapshot obsoleto, lock reale attivo e successivo editing consentito dopo rilascio.
- ADR 0078, AGENTS, README, guide autopilot/GitHub aggiornati. Nessun nuovo formato, backend, token, provider o chiamata HTTP. **Restano aperte** nella #10 le altre modifiche manuali e il fencing inter-dispositivo.


## 0.11.45 — 2026-11-09 (main, issue #81, #6, #10, #3)

**Recovery in seconda scheda: non interrompere l'autopilot che sta ancora scrivendo**

- `recoverInterruptedRuns` non trasforma più indiscriminatamente tutti i libri `running` in `paused` e le attività `running` in `cancelled` quando si apre una nuova scheda. Prima di ogni recupero tenta il **medesimo Web Lock esclusivo** `bookwriter:writer:<bookId>` mantenuto dalla sessione AI: se il lock è occupato, conserva lo stato e l'audit della sessione viva.
- I candidati da recuperare vengono individuati per libro; le modifiche a `books` e `activities` avvengono sotto un'unica transazione IndexedDB **dentro** il lock acquisito, rileggendo i record. Attività di altri libri, attività già concluse e recovery ripetuti restano intatti. Un vero writer interrotto viene riportato in pausa con motivazione italiana e la sua attività incompleta annullata.
- Senza API Web Locks il recovery **non inventa un crash**; mantiene lo stato senza modifiche e l'autopilot rimane vietato su browser non supportati come già stabilito dalla 0.11.41.
- Vitest: due libri con un solo lock occupato, idempotenza, browser senza Web Locks e cambio di stato tra scansione e lock. Playwright desktop/mobile: **due schede reali** e mantenimento del writer attivo fino al rilascio del lock, poi recovery al reload. ADR 0077, AGENTS, README, guida autopilot e sync.
- Invariati schema DB, ZIP, canon, budget, HTTP, credenziali e lease GitHub. **Restano aperti** in #10 il fencing fra dispositivi, le modifiche manuali concorrenti, il gap remoto/IndexedDB e i clock moderatamente sfasati. Sviluppo direttamente su `main`.


## 0.11.44 — 2026-11-09 (main, issue #80, #10, #6, #3)

**Rinnovo del writer lease: conferma della HEAD esatta anche dopo errore di rete**

- `renewWriterLease` non considera più riuscito un `PATCH force:false` soltanto perché la sessione originaria risulta ancora attiva sulla vecchia HEAD: dopo il PATCH (anche se l'ACK è mancato) rilegge il lock e verifica **SHA esatto del commit appena creato**, identità di sessione, attività e scadenza.
- Un rifiuto CAS 409/422 o una richiesta smarrita prima dell'applicazione fallisce chiuso (`RemoteWriterLost`) invece di simulare un rinnovo; il writer guard interrompe il modello AI quando può. Se il PATCH era effettivamente riuscito e **solo la risposta era persa**, la lettura dell'HEAD identica riconosce il successo senza un secondo commit/retry.
- Aggiunti test Vitest per rifiuto HTTP 409, ACK mancante prima/dopo applicazione, regressione rinnovo regolare e `force:false`; la pipeline CI verifica nuovamente TypeScript, test, build e Playwright desktop/mobile.
- Invariati lease v1, Web Locks, TTL 120s, heartbeat 25s, grace 60s, controllo clock, numero di GET, endpoint e credenziali. Nessuna modifica al canone o al ZIP; **rimangono aperti** fencing transazionale cross-device, clock skew moderato e modifiche manuali (epic #10).
- Guida GitHub e autopilot aggiornate, ADR 0076, AGENTS e README. Nessun branch/PR, rilascio diretto su `main`.


## 0.11.43 — 2026-11-09 (main, issue #79, #10, #6)

**Lease GitHub: un 404 non verificato non significa «nessun lock»**

- Anche il 404 previsto quando la branch `bookwriter-lock/<bookId>` non esiste deve superare il controllo approssimativo del clock tramite `X-RateLimit-Reset`: header CORS assente/malformato o orologio macroscopicamente sfasato arrestano acquisizione e ispezione senza altri GET, POST/PATCH o chiamate AI. I normali 404 con header valido restano assenza del ramo; altri errori HTTP invariati.
- In Archivio lo stato «nessun lock» compare solo dopo una verifica GitHub **riuscita**. Durante il controllo compare «Verifica in corso»; dopo errore il vecchio lease viene invalidato e le risposte obsolete sono ignorate, senza presentare pulsanti di recupero per dati non verificati.
- Vitest su 404 senza header, header invalido, clock +24h e primo acquisto consentito quando l'header è valido; Playwright desktop/mobile su lock assente non verificabile e successiva guarigione. ADR 0075, AGENTS, README e documentazione aggiornati.
- Restano esplicitamente aperti in #10 il fencing transazionale, l'errore di clock moderato e le modifiche manuali fra dispositivi. Nessun backend, provider aggiuntivo, segreto, nuovo formato ZIP o chiamata HTTP/AI aggiuntiva.


## 0.11.42 — 2026-11-09 (main, issue #78, #10, #6)

**Lease GitHub: rifiuto conservativo degli orologi manifestamente fuori sincronizzazione**

- Tutte le risposte REST riuscite del lease GitHub sono ora validate rispetto alla finestra temporale grossolana dell'header CORS-esposto `X-RateLimit-Reset` (finestra 60 minuti + margine 5 minuti). Se l'orologio del browser è fuori finestra, l'header manca o è invalido, il lease blocca nuove verifiche, rinnovi, acquisizioni e takeover **prima** della scrittura o di una chiamata AI. Non si usa `Date`, non leggibile via CORS in modo garantito, né si fa una richiesta extra.
- `RemoteWriterLost` espone messaggi in italiano e privi di credenziali; l'Archivio dichiara il carattere **approssimativo** del controllo. TTL 120s, rinnovo 25s, grace 60s, lease v1, Web Locks e CAS `force:false` invariati; il recupero resta manuale.
- Vitest con clock falsato di +24h/−24h, header assente/malformato, ramo senza lease, verifica/rinnovo e CAS invariati; Playwright desktop/mobile su lease occupato, messaggio dell'Archivio e orologio alterato. Documentazione autopilot/sync, ADR 0075, AGENTS, README, versioni npm/lock.
- **Limite:** la finestra grossolana non rileva sfasamenti di qualche minuto e non è un clock server preciso. Il fencing distribuito manuale e l'intervallo tra controllo remoto e IndexedDB **restano aperti in #10**. Nessuna nuova chiamata HTTP/AI, backend, segreto, formato canon, ZIP o sincronizzazione.


## 0.11.41 — 2026-11-09 (main, issue #77, #6, #10)

**Autopilot locale: niente generazione AI senza protezione fra schede**

- `withWriterGuard` non consente più ai **libri locali** di eseguire chiamate AI quando Web Locks non è disponibile. In precedenza solo i libri GitHub collegati erano bloccati, mentre i libri locali entravano nel runner senza lock, rischiando doppia generazione e checkpoint concorrenti sullo stesso IndexedDB.
- Errore in italiano prima del cambio di stato e della rete, con indicazione di usare un browser aggiornato e un contesto HTTPS sicuro. Non sono aggiunti fallback `localStorage` non atomici; in presenza di Web Locks, `ifAvailable:true` e lease remoto restano invariati.
- Vitest su locale/collegato senza supporto, azione non chiamata, libro persistito intatto, locale con Web Locks e lock occupato. Playwright desktop/mobile su Dashboard, errore visibile, nessuna richiesta AI, status `idle` e nessuna attività `running` o `aiRequested`.
- ADR 0074, guida autopilot, README, AGENTS e versioni npm/lock. Nessun nuovo formato ZIP, canone, sincronizzazione, costo AI o API.

**Limite:** l'assenza di Web Locks impedisce anche l'autopilot puramente locale; è un blocco intenzionale per la sicurezza dei checkpoint, non una garanzia di coordinamento distribuito per gli editor manuali.


## 0.11.40 — 2026-11-09 (main, issue #76, #20, #4)

**Copertura onesta delle scene correnti lunghe nel ranking lessicale**

- `CurrentQueryCoverage` indica ora `lexicallyTruncatedSceneIds` e `lexicallyTruncatedSceneCount`: sono **soltanto scene correnti incluse nella query** con `scene.text + title + objective` oltre i 16.000 caratteri campionati da `scanWords`. Il numero delle scene correnti **escluse** rimane distinto in `omittedSceneCount`; nessuna modifica a punteggio, selezione o quantità di prosa letta.
- `completeContinuityRecheck` rende `partialCoverage=true` anche quando questa è **l'unica** causa di copertura lessicale parziale. Lo storico aggiunge due campi opzionali, con visualizzazione esplicita nell'interfaccia e avvertenza al direttore/editor autorizzato. Nessun dato per i cinque lettori ciechi.
- ZIP: `continuityAuditSchema` resta `strict`. La nuova coppia di campi è facoltativa per backup legacy, altrimenti deve essere completa, con massimo sei ID, senza duplicati e sottoinsieme delle scene effettivamente comprese nella query. Vitest su soglia esatta, scene escluse e incluse, audit, privacy; test ZIP su round-trip/legacy/file ostili; Playwright desktop/mobile.
- ADR 0073, guida e AGENTS aggiornati. Nessun nuovo campo di canone, call AI/HTTP, trigger, sincronizzazione o generazione automatica di conflitti. **Un match o un indicatore di copertura non certifica coerenza.**


## 0.11.39 — 2026-11-09 (main, issue #20)

**Audit trasparente della copertura delle scene correnti nel confronto cross-chapter**

- `retrievePriorContinuityScenes` restituisce ora `currentQuery` con `scope` (`chapter_sample`/`single_scene`), numero di scene correnti scritte, ID effettivamente usati nella query, e numero di scene correnti omesse. Questi contatori sono **distinti** da `candidateSceneCount`/`unscannedSceneCount` dei testimoni precedenti. Il pacchetto raggiunge soltanto quattro specialisti autorizzati (e storico con trigger) e il direttore, mai i cinque lettori ciechi.
- Dopo `completeContinuityRecheck`, `partialCoverage=true` anche se **solo scene correnti** risultano omesse e tutte le precedenti sono state campionate senza tagli. Il riepilogo conserva **campi opzionali** `currentWrittenSceneCount`, `currentQueriedSceneCount`, `currentOmittedSceneCount` e `currentQueriedSceneIds`; audit preesistenti senza questi campi restano leggibili. UI con i conteggi visibili all'autore.
- Il direttore è istruito a non dichiarare verificata la parte di capitolo fuori dalla query aggregata; la query `single_scene` omette volutamente gli altri segmenti, non dichiara una revisione complessiva.
- Test Vitest per 8 scene (6 nella query, 2 omesse), singola scena (1 vs 7), tutti i testimoni precedenti completi, `partialCoverage` con e senza omissioni e isolamento dei lettori ciechi; Playwright desktop/mobile sul conteggio nello storico. **Schema ZIP rigoroso esteso** con campi opzionali bounded (max 200 scene, max 6 ID), all-or-none e conteggi coerenti; test su round-trip, file legacy e campi alterati o incompleti. ADR 0072, guida, AGENTS, README e package/lock.
- **Invariati** selezione delle scene, punteggi, campionamento, massimo 1600 candidate/4 scene/2 per capitolo, budget AI/HTTP, canone, permessi, sync, regole di giudizio o freeze. Nessuna interpretazione semantica aggiuntiva.


## 0.11.38 — 2026-11-09 (main, issue #20)

**Rivalidazione del direttore: sei scene rappresentative anche nei capitoli lunghi**

- Per i capitoli con più di sei scene non vuote, `queryScenes` seleziona **prima, ultima e quattro scene intermedie equidistanti** nell'ordine deterministico di numero/ID, invece delle sole prime sei. Conserva l'esatto comportamento precedente con sei scene o meno e quando viene fornita una singola `currentScene`.
- La query del direttore continua a distribuire fra le sei scene rappresentate i **48 termini lessicali** e **16 nomi espliciti** e a considerare i loro metadati strutturati e date. Il budget rimane fisso: massimo sei scene correnti, scansione di 16k caratteri per scena lunga, 1.600 candidate precedenti, quattro scene selezionate e due per capitolo, due finestre originali da 1.250.
- Test Vitest per capitoli con 7, 8 e 101 scene, presenza del riferimento nell'ultima, campionamento deterministico anche con record invertiti, scena intermedia esclusa esplicitamente, review di singola scena invariata e nessuna mutazione. Playwright desktop/mobile sul nuovo avviso di campionamento. ADR 0071, AGENTS, guida, README e versione npm/lock.
- Nessuna nuova chiamata AI/HTTP, accesso ai lettori ciechi, segreti, registri alias, storage/ZIP, sincronizzazione, mutazione canonica, decisioni o freeze. Il campione resta parziale: un indizio testuale non dimostra una contraddizione.


## 0.11.37 — 2026-11-09 (main, issue #20)

**Recupero cross-chapter: bilanciamento dei 16 nomi letterali fra scene correnti**

- La query aggregata del direttore non lascia più che i metadati della prima scena riempiano tutti i **16 nomi** cercati nella prosa precedente senza tag. `balancedLiteralNames` ripartisce le etichette esplicite, valide (3–80 caratteri), **a turni fra le prime sei scene correnti**, con deduplica stabile; il controllo dei metadati strutturati `entities` mantiene la query ampia precedente.
- La query **di singola scena** resta identica; massimo 30 riferimenti espliciti per scena, 16 nomi cercati/8 riscontri per scena precedente, 48 termini bilanciati, 1.600 candidate, 4 scene selezionate/2 per capitolo e 2 finestre letterali da 1.250 caratteri.
- Nuovi Vitest con 25 personaggi nella prima scena, menzione non etichettata del personaggio della sesta in un capitolo precedente, confronto con le query singole, integrazione giudice, privacy dei cinque lettori ciechi, esclusione della settima e nessuna mutazione; Playwright desktop/mobile sull'avviso UI. ADR 0070, README, guida e AGENTS.
- Nessuna nuova chiamata AI/HTTP, lettura del registro alias o dei segreti, indice, campo persistito/ZIP, sync, cambiamenti al canone o ai permessi degli agenti. Un match resta soltanto un indizio letterale, non una diagnosi semantica.


## 0.11.36 — 2026-11-09 (main, issue #20)

**Query di continuità del direttore: termini lessicali bilanciati fra scene correnti**

- Nella rivalidazione di intero capitolo, `retrievePriorContinuityScenes` non consente più che la prima delle sei scene correnti saturi da sola il budget di **48 termini**: la query inserisce i termini distinti **a turni, uno per scena**, fino al limite. Una scena finale con riferimento a un oggetto può così recuperare una scena precedente pertinente anche quando la prima scena contiene oltre 48 parole diverse.
- Il recupero per **una singola scena** resta invariato; la query considera al massimo le prime **6 scene con testo** e le prime **96 parole campionate per scena**, senza dare alla settima scena una copertura inesistente. Restano i limiti 16k caratteri per scansione, 1.600 candidati, 4 scene mostrate, 2 per capitolo, 48 termini distinti e 2 finestre originali per scena lunga.
- Vitest sulla query multi-scena con prova pertinente solo nella sesta, richiesta con singola scena, limite sulla settima, pacchetto del direttore e nessuna esposizione ai cinque lettori ciechi; Playwright desktop/mobile sull'avviso editoriale. ADR 0069, guida, README, AGENTS e package/lock v0.11.36.
- Nessuna nuova chiamata AI/HTTP, accesso a registri alias/secret, persistenza, schema ZIP, sincronizzazione, modifica di canone, giudizi, permessi o freeze.

**Limite:** il ranking resta letterale ed euristico: trovare parole in comune non costituisce una verifica della coerenza narrativa.


## 0.11.35 — 2026-11-09 (main, issue #20)

**Continuità: confini reali per i nomi e i termini letti nelle tre porzioni di scena**

- Risolto un falso match in `retrievePriorContinuityScenes` per scene lunghe: un campione che iniziava in mezzo a `Vivo` poteva riconoscere erroneamente `Ivo`, e una porzione che finiva prima dell'ultima lettera o di un segno combinante poteva simulare una parola completa. Lo scanner locale conserva i caratteri immediatamente esterni a ogni porzione del testo originale e li usa **solo per verificare i confini**.
- Anche i termini lessicali considerati dal ranking passano lo stesso filtro ai bordi; un token nato dal taglio non incrementa più il punteggio. Il testo completo o un nome realmente separato da spazio/punteggiatura continua a essere riconosciuto. Unicode (lettere, cifre, segni combinanti, underscore e surrogati) gestito in modo conservativo.
- Rimangono immutati i 16.000 caratteri massimi complessivi campionati per scena lunga, 16 nomi, 48 termini, 1.600 candidati, massimo 4 scene/2 per capitolo e 2 finestre originali da 1.250 caratteri. Non cambia il metodo persistito `local_structured_lexical_v1` né la posizione dei frammenti.
- Nuovi Vitest per taglio su `Vivo`, `Ivoz`, diacritici/underscore/numeri, token lessicale tagliato, menzioni complete sul confine, privacy e non mutazione del libro. Playwright desktop/mobile verifica l'avviso; ADR 0068, guida, README, AGENTS e versione npm/lock aggiornati.
- Nessuna nuova chiamata AI/HTTP, accesso ai cinque lettori ciechi, memorie segrete, registro alias, indicizzazione persistita, mutazione canonica, freeze, ZIP o sincronizzazione. **Limite:** il campionamento rimane parziale e il punteggio non dimostra contraddizioni.


## 0.11.34 — 2026-11-09 (main, issue #20)

**Continuità in scene lunghe: seconda occorrenza di nomi e oggetti anche se già citati**

- `targetedLiteralWindows` non si limita più al primo match di ciascun termine. Dopo il primo estratto, cerca un **termine diverso nelle porzioni non coperte** sia prima sia dopo, anche se era già presente nell'estratto iniziale. Se non esistono termini distinti esterni, può centrare il secondo estratto su una **ripetizione distante del primo nome**; se manca anche questa, resta il fallback iniziale/finale.
- La scansione usa `RegExp.lastIndex` sul **testo originale**, range di offset UTF-16 e confini di parola; nessuna interpolazione o deduzione semantica. Rimangono max48 segnali, max2 estratti da 1.250 caratteri per scena lunga, 4 scene finali, 2 per capitolo e 1.600 candidati. Una menzione ripetuta non equivale a prova indipendente.
- Vitest su termini alternativi ripetuti, ripetizione del primo nome, preferenza del termine diverso, accuratezza degli offset e isolamento dei lettori ciechi; Playwright desktop/mobile sull'avviso UI. Guida, README, AGENTS, ADR 0067 e versione npm/lock v0.11.34.
- Nessun nuovo schema ZIP/IndexedDB, canon, timeline, secrets, decisioni autore/alias, giudizi, freeze, sync, endpoint, chiamata AI o autorizzazione aggiuntiva.

**Limite:** si tratta di un recupero locale di frammenti letterali e parziali, non di comprensione di sinonimi, omonimie o contraddizioni.


## 0.11.33 — 2026-11-09 (main, issue #20)

**Due riferimenti pertinenti nelle finestre delle scene precedenti lunghe**

- `targetedLiteralWindows` conserva il primo estratto centrato sulla menzione a parola intera di priorità più alta; se un **altro segnale** tra i primi 48 appare **fuori** da quel frammento, la seconda finestra punta a quella menzione invece di mostrare sempre un contesto generico da inizio/fine. In mancanza di un secondo testimone distinto, rimane il fallback originale.
- Non aumentano finestre (max **2 × 1.250 caratteri**), scene selezionate (4), limiti per capitolo (2) o candidati esaminati (1.600). Offset e testi originali, ordine deterministico, ricerca letterale a parola intera e limiti di recupero dichiarati rimangono invariati.
- Test Vitest su due indizi narrativi separati, indizi concentrati nella stessa finestra con fallback, nomi regex escaped, provenienza letterale e isolamento dei lettori ciechi; Playwright desktop/mobile sul nuovo avviso di campionamento. ADR 0066, guida, AGENTS, README.
- Nessuna modifica a persistenza, ZIP, canon, segreti, note autore, consenso, sync, giudizi, freeze o chiamate AI/HTTP. **Limite:** i frammenti restano parziali e non sono prova di identità, possesso, conoscenza o contraddizione.


## 0.11.32 — 2026-11-09 (main, issue #20)

**Rivalidazione cross-chapter: distribuzione equa dei candidati prima del ranking**

- Con oltre 1.600 scene precedenti, `retrievePriorContinuityScenes` non lascia più che un singolo capitolo origine molto esteso occupi l'intero budget di scansione: esamina a turni le scene dei capitoli, ordinati con priorità **origine, ultimo predecessore e intermedi più recenti**, e poi riprende il turno per le scene successive. Le scene d'origine dichiarate come modificate sono prioritarie all'interno dell'origine.
- Il limite di **1.600 scene scansionate**, i massimi di **4 scene selezionate / 2 per capitolo**, i segnali lessicali e strutturati, i due estratti letterali con offset e la privacy degli agenti sono invariati. Se i capitoli superano gli slot, solo il campione prioritario viene letto; nessuna copertura esaustiva o contraddizione dedotta.
- Test Vitest su capitoli da 1.705 scene con testimone intermedio, priorità alla scena modificata, ultimo predecessore non escluso, 1.602 capitoli, stabilità a ordine invertito e conteggi di esclusione; Playwright desktop/mobile per l'avviso di campionamento. Guida, README, AGENTS e ADR 0065.
- Nessun dato persistente o nuova migrazione, schema ZIP, canone, note autore, sincronizzazione, rete, prompt dei lettori ciechi, nuove chiamate AI o costi aggiuntivi.

**Limite:** il bilanciamento è un criterio deterministico di selezione di materiale da esaminare, non una ricerca semantica sull'intero romanzo.


## 0.11.31 — 2026-11-08 (main, issue #20)

**Finestre di continuità allineate alle menzioni letterali realmente recuperate**

- `targetedLiteralWindows` cerca il **nome completo a parola intera nella prosa originale**, non la prima sottostringa corrispondente in un testo trasformato: `Ivo` non si ferma su `vivo`, e una frase Unicode che allunga il casefold non altera l'offset originale. Escape dei metacaratteri regex, confini Unicode inclusi segni combinanti e ricerca bounded su max48 termini lunghi 3–100 caratteri.
- Per i frammenti cross-chapter si tentano prima le `literalEntities` della v0.11.30, poi `entities` strutturate e infine `terms` lessicali; non si ordina più per lunghezza ignorando il valore del segnale. Se nessun termine compare come parola intera, fallback ai contesti iniziale/finale senza affermare che vi sia una prova.
- Nessuna nuova API, rete, chiamata AI, trasferimento di note autore o decisioni alias, persistenza, schema ZIP, canone, freeze o permesso di correzione. Restano 2 finestre da max1.250 caratteri e gli stessi limiti di 1.600 candidati/4 scene.
- Test Vitest su falso positivo `vivo/Ivo`, nomi composti, priorità dei segnali, offset UTF-16 originali con Unicode e finestra centrata su scena non taggata; Playwright desktop/mobile su avviso dei limiti. Documenti aggiornati: ADR 0064, guida, README, AGENTS.

**Limite:** una citazione letterale centrata non è una prova di identità, possesso o continuità narrativa; il campione resta parziale e il giudice deve valutare criticamente.


## 0.11.30 — 2026-11-08 (main, issue #20)

**Rivalidazione cross-chapter: recupero di nomi espliciti nella prosa precedente non etichettata**

- Il ranking locale `retrievePriorContinuityScenes` controlla se personaggi, oggetti, luoghi e fazioni **dichiarati nella scena corrente** compaiono letteralmente, a **parola intera**, nel testo delle scene precedenti congelate anche senza metadati di entità nella scena storica. Il nuovo `matchSignals.literalEntities` non si confonde con `entities` e ha peso inferiore a un match strutturato. Nessuna inferenza di alias, identità, possesso o contraddizione.
- Limiti: max16 nomi espliciti (3–80 caratteri) e max8 match per scena; verifica distinta delle porzioni inizio/centro/fine max16.000 caratteri, non unione fittizia di pezzi. Finestre estratte dalla prosa originale, cap precedenti (1.600 scene analizzate, 4 scelte e 2/capitolo) invariati. I nomi non vengono recuperati dal canone segreto o dal registro alias.
- Prompt dei soli specialisti autorizzati e del direttore precisano che il match letterale non è una prova; cinque lettori ciechi esclusi. UI di rivalidazione con avviso esplicito; nessuna modifica di schemi persistiti, import, ZIP, sync, canone, freeze o chiamate AI/HTTP aggiuntive.
- Test Vitest su scena non etichettata, nomi composti, falsi match di sottostringa, campioni di lunghezza superiore al cap e privacy dei prompt; Playwright desktop/mobile su avviso, nessuna rete e layout. ADR 0063, guida, README, AGENTS.

**Limite:** il recupero è lessicale e parziale. Un nome citato non dimostra chi abbia agito o cosa sapesse un personaggio, né certifica che un problema sia stato risolto.


## 0.11.29 — 2026-11-08 (main, issue #20)

**Filtri consultivi del registro editoriale tra più revisioni**

- Filtro locale e non esecutivo per serie ambigue, citazioni spostate, controlli riformulati, verifiche non osservate nel ciclo corrente e fonti/giudizi non convalidati. La selezione avviene prima del limite UI di 12 serie, così una citazione meno recente ma rilevante non scompare dalla ricerca; **resta** il limite di 240 occorrenze e di 8 dettagli per serie.
- `buildEditorialDiffLedger(book,chapter,focus)` espone `matchingThreads` e `filteredOutThreads` distinguendoli dalle omissioni del campione e dall'overflow delle serie selezionate. Gli indicatori di cambio sono calcolati prima del taglio degli 8 dettagli. Nessun criterio equivale a `resolved` o certifica un problema narrativo.
- Selezione accessibile nella redazione, messaggi per filtri senza corrispondenze e copertura incompleta. Su capitoli congelati il filtro «non osservate» non deduce assenze in revisioni inesistenti.
- Vitest per correzioni solo suggerite, ambiguità oltre la prima pagina, spostamenti, giudizi senza prova e limiti; scenario Playwright desktop/mobile esteso a filtro archiviato, riformulazione e citazione non osservata. Documentazione aggiornata in ADR 0062 e guida. Nessuna chiamata AI, HTTP, mutazione di canone, segreti, prompt, attività, note private o sincronizzazione.

**Limite:** i filtri operano sul campione finito, non sulla storia integrale del romanzo, e non valutano semanticamente la fondatezza o risoluzione di un problema.


## 0.11.28 — 2026-11-08 (PR #74, issue #20)

**Registro cronologico dei controlli letterali di revisione per capitolo**

- Nuovo `buildEditorialDiffLedger(book,chapter)` **puro/read-only**: raggruppa solo osservazioni testuali con la stessa scena, categoria e citazione NFC da `chapter.editorialRounds` storici irrisolti, `editorialCycle.priorRounds` del capitolo e gruppi correnti già ancorati alla prosa, nello stesso ordine in cui sono stati registrati. Le ripetizioni di round non identificano un unico problema. Archivi con prove non coerenti restano **separati e non confrontabili**.
- Segnala `first_literal_witness|same_literal_position|moved_literal_position|source_not_comparable|ambiguous_literal_witness` e `first_suggestion|same_suggestion_words|different_suggestion_words|new_judge_not_available|not_comparable`, ma **nessun resolved/fixed/completed**. Due controlli sulla stessa frase nello stesso archivio sono ambigui e non creano un'autorizzazione o un nesso causale. Frase assente nel nuovo campione ⇒ **non osservata (non risolta)**.
- Lo stato del giudice corrente è mostrato solo se `buildEditorialVerificationPlan` rivalida integralmente `validateJudgment`; giudizio vecchio/manomesso ⇒ `current_unvalidated` e nessun check/approval esposto. Senza nuovo giudice ⇒ `current_awaiting_judge`. Limiti **240 osservazioni recenti**, **12 serie** e **8 osservazioni per serie**, con contatori per tutto ciò che viene omesso e per i gruppi nuovi fuori campione.
- UI per capitolo in **Redazione multi-agente → Stato dei capitoli → Registro delle differenze editoriali** sia sui congelati sia sui riaperti, con evidenze, provenienza cronologica e avvisi. Non legge `editorialVerificationChoices`: le note dell'autore restano nelle relative viste private, mai trasferite alla revisione. Nessun nuovo DTO, ZIP, IndexedDB, sync, prompt, consenso, rete, AI call, attività o modifica a prosa/canon/repair/freeze.
- Test Vitest su tornate multiple, giudizi stale, ambiguità, citazioni spostate/omesse, limiti, capitolo estraneo e privacy. Playwright desktop/mobile su freeze → nuova revisione → controllo riformulato → quote assente e nessun consenso copiato. ADR 0061, guida, README, AGENTS, changelog.

**Limite:** identità letterale non dimostra identità del problema; lo storico dei dubbi non certifica la correttezza di una modifica. Serve la valutazione critica dell'autore.

## 0.11.27 — 2026-11-08 (PR #73, issue #20)

**Confronto letterale e non esecutivo fra suggerimenti archiviati e nuova revisione**

- Nuovo `compareEditorialArchiveToCurrentRevision(book,chapter,cycle)` **puro/read-only**: solo dopo riapertura del medesimo capitolo, analizza gli `unresolved` in `chapter.editorialRounds` e li confronta con i gruppi correnti **già validati e bounded** da `buildEditorialRecommendationDisagreements`. Stessa scena, categoria literal casefold e quote NFC, con segment/offset per `same_literal_anchor` o `relocated_literal_quote`; più candidati ⇒ `ambiguous_literal_candidates`, nessun match ⇒ `not_observed_in_current_sample`, vecchia fonte incoerente ⇒ `archive_source_unverifiable`. NESSUNO stato implica che un problema sia stato risolto o che una modifica sia dovuta.
- `buildEditorialVerificationPlan` revalida il giudizio corrente prima di mostrarne lo status. Per il vecchio e il nuovo `missingEvidence/nextCheck` segnala se le **parole** sono uguali, differenti, ancora in attesa o non confrontabili; non decide la semantica. Max **24 controlli storici**, contatore delle omissioni e segnalazione dei finding/gruppi nuovi fuori campione; solo prove correnti già esaminate, senza dedurre copertura completa.
- Note private dell'autore `editorialVerificationChoices?` **solo storiche**, mai trasferite al nuovo `needs_evidence`: visualizzazione con snapshot esatto e suffisso chiave archivio/giudizio/finding ID compatibile dopo reopen (che azzera `frozenAt`); più congelazioni compatibili ⇒ ambiguità e nessuna motivazione mostrata come associata, reset import ZIP last-wins rispettato. Il match di snapshot non autentica la congelazione originaria. Nessun nuovo campo, permesso AI, rete, prompt, sync, intervento su prosa, memory, segreti, timeline, canon, repair o freeze.
- UI **Confronto verifiche storiche e nuova revisione** dentro Redazione multi-agente con prove vecchie/nuove, suggerimenti e note storiche etichettate; Vitest exact match, cambio check, moved quote, no-match, stale archive, reset/ambiguità, cap24, prompt privacy; Playwright desktop/mobile su annotazione, reopen, nuovo check, citazione sparita e layout. ADR 0060, guida, README, AGENTS e docs.

**Limite:** identità letterale non significa identità del problema, né l'assenza nel campione indica soluzione; l'autore deve valutare criticamente.

## 0.11.26 — 2026-11-08 (PR #72, issue #20)

**Annotazioni private su controlli irrisolti dei capitoli già congelati**

- `buildFrozenEditorialVerificationPlan(book,chapter)` ricostruisce localmente un piano **solo storico** da `chapter.editorialRounds`, non dal ciclo attivo. Max24 voci con conteggio omesse. Ogni voce resta `archived`, anche se il passo esiste ancora. Chiave archivio esatta vincolata a `frozenAt`, indice tornata/reconciliation, numero round, timestamp giudice e ID; due freeze o round numericamente uguali non ereditano le scelte precedenti.
- Solo le raccomandazioni archiviate **`unresolved + reject_all`**, con tutte le decisioni reject, ancore letterali archiviate coerenti e proposte realmente differenti di ruoli distinti, possono ricevere una nota privata. I record senza fonti, approvati, falsi, fuori campione o non ancora congelati restano read-only; il controllo sulle fonti è strutturale, NON certifica verità, autenticità o validità rispetto alla prosa corrente.
- `createArchivedEditorialVerificationChoice` riusa lo storico strict append-only v0.11.25 (max160, `taken_on|dismissed|reset`, note 20–500, last-wins) e invalida scelte quando cambiano freeze/stamp/quote/suggerimento. `recordArchivedEditorialVerificationChoice` usa Web Locks writer/outbox, CAS, books+activities+outbox, autosync OFF, outbox delete, log generico. Con autopilot running o redazione attiva nessuna nuova scrittura.
- UI **Giudizi archiviati → Piano verifiche editoriali → Annotazione storica dell'autore**: tre azioni motivate, conferma, stato e audit. Nessun nuovo DTO, schema ZIP, permesso AI, chiamata a modelli o rete, modifica a canon, scene, timeline, freeze o remediation. ZIP content/full cifrato e import reset precedenti invariati. Vitest su round duplicati, overflow, refreeze, input ostili, CAS/lock/privacy; backup cifrato/import e Playwright desktop/mobile. [ADR 0059](../ADR/0059-frozen-editorial-verification-annotations.md), [guida](frozen-editorial-verification-annotations.md).

**Limiti:** una nota storica non dimostra che un rilievo sia vero, non completa il controllo e non autorizza a riscrivere. Nessuna nuova condivisione ai lettori ciechi o al giudice.

## 0.11.25 — 2026-11-08 (PR #71, issue #20)

**Presa in carico, rifiuto e azzeramento privati dei controlli proposti dal giudice**

- Nuovo registro `BookProject.editorialVerificationChoices?` **append-only max160** su `chapterId+planKey` esatti e snapshot di `round,quote,missingEvidence,nextCheck,judgeExplanation`: `status=taken_on|dismissed|reset`, motivo privato 20–500, timestamp e last-wins. Consentito solo su voci **`needs_evidence` del piano v0.11.24 corrente** e rivalidato. Nessuna decisione su approved, closed, awaiting, stale, archived, overflow o gruppi omessi; il cambio di una prova/suggerimento **invalida** la scelta precedente.
- UI dentro la singola voce irrisolta: **Prendi in carico / Respingi suggerimento / Azzera scelta**, campo motivo, conferma esplicita, stato attivo e storico. Autopilot non running e ciclo editoriale **blocked** obbligatori. Nessuna scelta approva nuove correzioni o modifica il giudizio: il controllo continua a risultare `needs_evidence`; nessuna ricerca, nuova AI call o decisione canonica.
- Application con Web Locks writer/outbox, CAS `updatedAt`, transazione `books+activities+outbox`, autosync OFF, outbox svuotata. Activity e prompt senza nome, citazione, stato, quote, ragione, segreti o note private. ZIP content/full schema **strict**, legacy compatibile e import fail-closed: append `reset` per ogni scelta attiva importata, oppure **scarta tutto il registro importato** se cap160 pieno. Backup cifrato supportato, push/ZIP manuali rimangono a rischio spoiler.
- Test Vitest su domain/last-wins/stale e assenza leak prompt, application lock/CAS/outbox, ZIP legacy/ostili/cifrati/import reset e Playwright desktop/mobile su tre scelte, reload, modifica del suggerimento, layout. ADR 0058, AGENTS, guida e README.

**Limiti:** è un'annotazione privata di un suggerimento AI, non un piano esecutivo né un voto sul canone o un'autorizzazione di repair. L'autore deve usare separatamente il flusso di riapertura dei capitoli.

## 0.11.24 — 2026-11-08 (PR #70, issue #20)

**Piano consultivo delle verifiche mancanti dopo il giudizio editoriale**

- Nuova funzione di dominio **pura e read-only** `buildEditorialVerificationPlan(book,cycle,chapter)`: ricava dagli stessi report e `recommendationReconciliations` le voci `awaiting_judge`, `needs_evidence`, `approved_edit`, `closed_no_edit`, `requires_recheck` e `archived`. Non introduce nuove inferenze su verità, causalità o incompatibilità delle correzioni.
- Una correzione appare approvata **solo dopo nuova esecuzione completa di `validateJudgment` sul libro corrente**, incluse tutte le prove narrative, i gate epistemici e i consensi. Fonte modificata, giudizio importato non valido o vecchio gruppo ⇒ **da rivalidare**, mai repair autorizzato. Le tornate precedenti sono **sempre storiche** anche se la citazione esiste.
- La vista privata mostra `missingEvidence` e `nextCheck` **letteralmente come già scritti dal giudice**; in attesa di giudizio non inventa motivazioni. Niente chiamate AI, HTTP, autosync, prompt, nuove decisioni persistite o controlli automatici. Massimo **24 voci**, con contatore di omissione; rimangono visibili anche i conteggi di finding fuori campione del gate v0.11.23.
- Pannello in **Redazione multi-agente** con filtro per questioni aperte, correzioni, chiusure, storico e tutti; lo stesso piano è disponibile negli **archivi dei capitoli congelati**, ma marcato sempre storico. Test Vitest: stati, zero mutazioni, invalidazione per edit/manomissione, overflow e archivio; Playwright desktop/mobile: filtri, prove, suggerimenti e fonte stale. [ADR 0057](../ADR/0057-local-editorial-verification-plan.md), [guida](editorial-verification-plan.md).

**Limiti:** il piano non prova la fondatezza dei consigli degli agenti, non deduce che una correzione sia già stata applicata e non autorizza automaticamente nuove ricerche o edit. Non cambia DTO, backup ZIP, consensi, writer, repair o rete.

## 0.11.23 — 2026-11-08 (PR #69, issue #20)

**Riconciliazione critica delle correzioni divergenti sullo stesso passaggio**

- `buildEditorialRecommendationDisagreements` identifica **soltanto** proposte di modifica realmente differenti, di **ruoli distinti**, riferite alla stessa prova letterale corrente: scena, segmento, offset, quote e categoria esatti. Un report `pass` non è un voto contrario; due proposte diverse non dimostrano un conflitto semantico. Max **6 gruppi di 12 rilievi**, con contatori per gruppi omessi o sovradimensionati e `unreviewableFindingIds` bloccati per remediation.
- Il giudice deve produrre `recommendationReconciliations` Zod **strict** per ogni gruppo corrente: ID tutti esatti, `resolution=choose_one|reject_all|compatible_changes`, `evidenceAssessment=adequate_for_selected_edits|unresolved`, `rationale` 30–850, `missingEvidence` e `nextCheck` 24–600. Scelte incrociate con gli `accept/reject` effettivi; nessun `accept` quando la prova è dichiarata irrisolta. `nextCheck` resta una **raccomandazione testuale**, non un lavoro automatico.
- `adjudicationPrompt` usa i report già disponibili e le fonti letterali rivalidate, senza chiamate AI aggiuntive. `validateJudgment` blocca omissioni, falsi gruppi, duplicati, fonti stale e modifiche fuori campione; i gate narrativi, knowledge, storici e di provenienza rimangono invariati.
- `repairPrompt` rivalida le riconciliazioni anche su finding **stile/voce** prima del riutilizzo dopo resume/ZIP. Il pannello redazione mostra proposte affiancate, scelta del giudice, prova mancante e verifica suggerita, con avviso di copertura parziale. ZIP content/full schema strict per lo storico, compatibilità legacy. Nuovi test Vitest del dominio/overflow/repair, backup ZIP cifrato e Playwright desktop/mobile. [ADR 0056](../ADR/0056-editorial-recommendation-disagreements.md), [guida](editorial-recommendation-disagreements.md).

**Limiti:** un confronto fra proposte non prova che gli agenti siano logicamente in disaccordo sul fatto narrato, né che una modifica sia giusta; nessun nuovo canone, segreto, timeline, consenso AI o chiamata di rete.

## 0.11.22 — 2026-11-08 (PR #68, issue #20)

**Contraddittorio strutturato del giudice su ogni pista autorizzata dall'autore**

- Nuovo schema Zod strict `authorTransferCritique` nel **giudizio editoriale**: per ogni estratto `buildSharedTransferPack` realmente visibile e ancora corrente il giudice risponde con **capitolo/scena/offset/citazione/attori/verdetto esatti**, `judgeReading=possible_access|unreliable_or_unrelated|undetermined`, `relationToAuthor=agrees|challenges|uncertain`, ragione autonoma 30–850 e conclusione 30–1000. **Obbligatorio soltanto** se il ruolo `judge` è autorizzato e c'è un finding `knowledge` ancora ancorato.
- `adjudicationPrompt` e `validateJudgment` usano lo **stesso filtro** di finding correnti e ripetono controllo dei consensi e delle scene: niente riferimenti inventati, omessi, riordinati arbitrariamente, falsificati o revocati. Le ripetizioni sono permesse solo se presenti nel campione consentito. Con pack vuoto il nuovo campo è proibito.
- **Gate più prudente:** `accept` su un rilievo knowledge è bloccato se il giudice ritiene almeno una pista `possible_access` o `undetermined`. `unreliable_or_unrelated` NON basta ad accettare una correzione: rimangono invariati i gate narrative/knowledge/information-transfer, le prove letterali e il giudizio indipendente. `repairPrompt` rivalida anche la critica dopo resume/ZIP, impedendo nuovi repair con permessi revocati o fonti stale.
- Riepilogo nel pannello editoriale con ogni citazione, parere autore, confronto del giudice e conclusione. Nessuna nuova chiamata AI, invio ai cinque lettori ciechi o modifica a prosa, canone, segreti o timeline. Backup ZIP content/full valida la nuova struttura (strict), archivi legacy restano importabili. Nuovi test Vitest su gate, dati falsi/revoca e ZIP cifrato, CI e Playwright desktop/mobile. [ADR 0055](../ADR/0055-critical-judge-transfer-challenge.md), [guida](critical-judge-transfer-challenge.md).

**Limite:** la classificazione del giudice è fallibile; il testo letterale rimane un indizio bounded e non prova il passaggio effettivo o la conoscenza. I nuovi campi possono richiedere più token nelle chiamate esistenti.

## 0.11.21 — 2026-11-08 (PR #67, issue #20)

**Consensi AI espliciti per singoli giudizi autore su possibili comunicazioni**

- Nuovo `BookProject.narrativeTransferShareDecisions?`, storico append-only max **180** su ID **esatto** della valutazione corrente: `status=allowed|revoked`, uno o più ruoli opt-in `continuity,timeline,secrets,characterVoice,judge`, motivazione privata 12–500 e timestamp. Nessuna autorizzazione tramite vecchi consensi sulle knowledge. Ultimo permesso per ID prevale e ogni rettifica/source stale elimina la divulgabilità.
- `buildSharedTransferPack` fail-closed: **max 12** concessioni approfondite e **3** citazioni per richiesta, per nomi esatti e capitoli precedenti congelati. Condivide solo **citazione, mittente, destinatario, verdetto fallibile, capitolo/scena e offset**; MAI rationale, segreti, dati topic, tempi, archivio o appunti privati.
- Prompt solo ai quattro specialisti nominati; al giudice esclusivamente dopo finding **knowledge** con prova del segmento corrente ancora ancorata, e solo se autorizzato `judge`. I cinque lettori ciechi, storico/stile/narrativa, writer e repair non ricevono questi nuovi pack. Il giudice deve riesaminare e può RESPINGERE: niente canone, accettazione o remediation automatica.
- UI delle singole piste correnti: **Condivisione AI specifica**, checkbox tutte vuote per default, motivazione obbligatoria, conferma forte sull'invio a provider esterno, grant/revoca e stato corrente. Web Locks writer+outbox, CAS, transazione atomica, autosync OFF e outbox eliminata; activity privo di spoiler e contenuti dei consensi. La revoca vale solo per invii futuri.
- ZIP content/full strict e compatibilità legacy, import fail-closed: ultimo grant importato revocato localmente o intero audit scartato se si supera cap180. Test dominio, application, backup cifrato/import con permessi revocati e Playwright desktop/mobile. [ADR 0054](../ADR/0054-transfer-consent-ai-role-gate.md), [guida](transfer-consent-ai.md).

**Limiti:** ordine del manoscritto ≠ cronologia degli eventi; una pista/citazione con verdetto autore non prova consegna, apprendimento o verità. Le richieste AI esistenti possono consumare più token senza generare nuove chiamate.

## 0.11.20 — 2026-11-08 (PR #66, issue #20)

**Giudizi privati dell'autore per singole citazioni di possibili comunicazioni**

- `BookProject.narrativeTransferAssessments?` append-only max **120**: ID della coppia `same_information` corrente, due decisioni knowledge esatte in direzione mittente/destinatario, candidate ID dal campione della v0.11.19, `verdict=author_attested_report|possible_path|dismissed`, motivazione privata 20–650 e data. Un'attestazione è **lettura dell'autore**, non prova che qualcuno abbia ascoltato, creduto o acquisito una notizia.
- `createNarrativeTransferAssessment` rilegge e verifica l'esatta pista corrente e il collegamento; `buildNarrativeTransferAssessmentRegistry` è last-wins per fonte/direzione/coppia e invalida le scelte quando capitoli, prosa, conoscenze, legami o campioni cambiano. Nessuna riattivazione tacita di decisioni precedenti.
- Nel pannello **Piste comunicative della coppia** compaiono **Valuta questa pista**, tre verdetti non preselezionati, motivazione, conferma esplicita, giudizio corrente e storico. Senza un candidato letterale corrente non è possibile annotare; non esistono inferenze automatiche tra più personaggi.
- Salvataggio con Web Locks writer/outbox, CAS, blocco autopilot/redazione, transazione books+activities+outbox, autosync OFF e outbox eliminata. Activity senza nomi, prosa, verdict o note private. Nessuna mutazione di canone, segreti, timeline o prompt/consensi AI.
- ZIP content/full schema **strict**, max120, compatibilità legacy; archivi e push manuali possono contenere spoiler e le fonti importate non sono autenticate. Test dominio, application, privacy, ZIP cifrato e Playwright desktop/mobile. [ADR 0053](../ADR/0053-author-transfer-assessment-ledger.md), [guida](author-transfer-assessments.md).

**Limite:** il giudizio si riferisce solo a una menzione letterale non probatoria, non decide l'identità semantica, l'effettiva trasmissione, la cronologia della storia o la conoscenza canonica.

## 0.11.19 — 2026-11-08 (PR #65, issue #20)

**Anteprima locale dei possibili passaggi di notizie fra due knowledge confermate**

- Nuovo `previewKnowledgeTransferForPair` consultivo e on-demand: solo coppie `same_information` dirette e correnti già attestate, mai via confronto automatico delle parole o chiusura transitiva. Ricerca due direzioni mittente→destinatario utilizzando la **sola citazione del destinatario**.
- Filtro opzionale con nomi mittente/destinatario **letteralmente esatti** su `buildInformationTransferTrace`, senza cambiare l'esito dello scanner preesistente dei revisori. Campionamento invariato: massimo 240 scene precedenti congelate, 6.000 caratteri/scena, 12 formule/scena, 4 risultati per verso. Citazioni e offset letterali, contatori di esclusioni e limiti visibili.
- Pulsante **Esamina piste possibili** per ogni link `same_information` nel registro privato; anteprima effimera con entrambi i versi, messaggi potenziali, copertura e avviso esplicito che l'assenza di frasi non prova mancanza di comunicazione. Dopo rettifica o invalidazione del link la vista non è disponibile.
- Nessun aggiornamento a prosa/canone, memoria, segreti, timeline, freeze, outbox, registro o consent AI; nessun nuovo HTTP/AI, promozione a verità o passaggio certo. Test Vitest e Playwright desktop/mobile. [ADR 0052](../ADR/0052-knowledge-transfer-preview.md), [guida](knowledge-transfer-preview.md).

**Limite:** formule esplicite e ordine del manoscritto non sono cronologia narrativa, verità della voce, ricezione o conoscenza. La ricerca è bounded e può omettere dialoghi rilevanti.

## 0.11.18 — 2026-11-08 (PR #64, issue #20)

**Verifica consultiva dei collegamenti di conoscenza confermati dall'autore**

- `reviewNarrativeKnowledgeTopicTriangles` usa solo le decisioni **last-wins correnti**: segnala **soltanto** quando sono presenti direttamente tutti i tre verdetti A/B «stessa informazione», B/C «stessa informazione», A/C «informazioni differenti». Nessuna transitività applicata su coppie mancanti e nessun legame/errore narrativo inferito.
- Pannello con tre prove letterali, tre attori e tre verdetti già confermati; massimo **12** avvisi con conteggio totale e degli omessi. Rettifica e invalidazione delle fonti rimuovono immediatamente i pattern obsoleti.
- Analisi puramente locale ed effimera: nessun nuovo dato persistito, nessuna chiamata AI/HTTP, nessun intervento su canone, segreti, memoria, freeze o activity, nessuna autorizzazione automatica per gli agenti. Citazioni private visibili solo nel pannello; le decisioni preesistenti possono essere incluse in backup/push manuali.
- Test Vitest di triangoli completi, assenza di inferenze da due coppie, rettifica e stale; Playwright desktop/mobile per conferme, rendering e reload. [ADR 0051](../ADR/0051-knowledge-topic-triangle-advisories.md), [guida](knowledge-topic-triangle-advisories.md).

**Limite:** una possibile incoerenza fra interpretazioni dell'autore non dimostra una contraddizione narrativa né la verità, la cronologia o il trasferimento della notizia.

## 0.11.17 — 2026-11-08 (PR #63)

**Relazioni a coppie fra informazioni di personaggi distinti — solo su conferma autore**

- Nuovo `BookProject.narrativeKnowledgeTopicDecisions?` (append-only max **120**): due ID **distinti e canonici** di `NarrativeKnowledgeDecision` correnti, riferiti a personaggi con nome letterale differente, `verdict=same_information|different_information`, motivazione privata 20–650 e timestamp. È una interpretazione **esplicita dell'autore**, non una prova automatica di identità, verità o passaggio della notizia.
- `buildNarrativeKnowledgeTopicRegistry`: last-wins su coppia **non ordinata** di ID, audit delle rettifiche, invalidazione completa dopo modifica/riapertura/riattestazione/cambio conoscenza di una fonte, senza resurrezione di vecchie scelte. **No transitive closure**: A/B e B/C non implicano A/C. Nessun collegamento inferito da parole simili.
- UI **Collegare informazioni fra personaggi**: selezione di due fonti `knowledge_mention affirmed` ancora congelate, due citazioni visibili, due scelte, motivazione e conferma. Vista delle coppie correnti con tempi privati eventualmente già annotati a fianco, ma **l'ordine dei capitoli non è cronologia della storia**. Storico consultabile anche con fonti stale.
- Scrittura locale con Web Locks writer/outbox, CAS revisionale, blocco autopilot/redazione attiva, transazione atomica `books+activities+outbox`, autosync OFF e coda GitHub eliminata; log attività **senza attori, citazioni, temi, motivazioni private o segreti**.
- ZIP `content/full` schema strict per ID, coppia canonica, verdict, data, motivazione e max120, legacy compatibile; fonti importate rivalidate, senza autenticazione dell'autore. Backup e push GitHub manuale possono divulgare spoiler.
- Privacy: **nuovi collegamenti NON trasmessi ai 12 revisori, al giudice, writer o repair** nemmeno se esiste consenso v0.11.15 per quote e classificazione della singola conoscenza. Nessuna nuova chiamata AI/HTTP, canone, memoria, segreti o timeline modificati; nessuna deduzione sulla trasmissione. Test Vitest dominio/application/privacy, ZIP chiaro/cifrato/manomesso, Playwright desktop/mobile su due fonti, rettifica e invalidazione. [ADR 0050](../ADR/0050-author-pairwise-knowledge-subject-links.md), [guida](knowledge-topic-links.md), issue #20.

**Limiti:** la somiglianza semantica non viene certificata, i legami sono solo a coppie di nomi letterali distinti; il confronto dei tempi rappresenta una vista delle interpretazioni dell'autore, non una timeline causale verificata.


## 0.11.16 — 2026-11-08 (PR #62)

**Quando un personaggio sa: momento della conoscenza e ordine narrativo separati**

- Nuovo registro opzionale `narrativeKnowledgeTimingDecisions?` append-only (max **200**) per l'**ID esatto di una interpretazione `knowledge` già corrente** su menzione confermata e scena congelata. `accessMoment=acquired_in_scene|known_before_scene|not_yet_known|uncertain`, `narrativeOrder=chronological|flashback_or_reordered|undetermined`, motivo privato 20–650, data. `still_secret` non può dichiarare acquisizione nella/prima della scena; gli altri verdetti non possono dichiarare `not_yet_known`.
- `buildNarrativeKnowledgeTimingRegistry`: ultime decisioni per ID, rettifiche archiviate, fonti cambiate/riaperte/riattestate invalidate. Vista per personaggio **ordinata per capitolo/scena/offset del manoscritto**, NON per tempo della storia e NON per equivalenza semantica fra notizie o personaggi.
- UI **Quando i personaggi sanno?** con fonte verificata, doppia selezione momento/ordine, motivazione, conferma esplicita, registro per personaggio, storico e indicazione dei dati obsoleti. Nessuna conclusione causale o modifica al canone.
- Salvataggio locale protetto: Web Locks writer/outbox, CAS `updatedAt`, niente aggiornamenti durante autopilot/ciclo attivo, transazione atomica books+activities+outbox, autosync OFF e coda eliminata. Log attività senza motivazioni, spoiler, nomi o contenuto riservato.
- Backup ZIP `content/full` con schema **strict** e compatibile con archivi precedenti; i riferimenti temporali importati vengono rivalidati rispetto alle fonti e **non autenticano l'autore**.
- Privacy: **tutti i nuovi campi temporali sono esclusi dai prompt AI**, anche dove esiste un opt-in knowledge v0.11.15. Il consenso a una classificazione non vale automaticamente per la cronologia. Nessuna nuova chiamata AI, nessuna annotazione convertita in fatto, inventario, timeline o segreto canonico. Test Vitest di dominio, application, privacy e ZIP; Playwright desktop/mobile su scelta/reload e fonte invalidata. ADR 0049, [guida](knowledge-timing-registry.md), issue #20.

**Limiti:** il sistema non interpreta automaticamente flashback o informazione trasmessa fra personaggi; `chronological` è una classificazione dell'autore, non un fatto verificato. Il registro visualizza **ordine di esposizione del testo**, non ordine degli avvenimenti. Backup e push GitHub manuali possono contenere note private.


## 0.11.15 — 2026-11-07 (PR #61)

**Consenso esplicito per singola conoscenza e destinatario AI**

- Nuovo `narrativeKnowledgeShareDecisions?` append-only (max240): permesso `allowed|revoked` sull'**ID esatto di una decisione knowledge ancora corrente**, destinatari `continuity|timeline|secrets|characterVoice|judge` esplicitamente selezionati, motivazione privata 12–500 e data. Niente concessioni generali, implicite, a lettori ciechi, agli altri specialisti o ai writer. Nessuna casella preselezionata.
- Nuovo `buildSharedKnowledgePack` locale e fail-closed: max **4 citazioni** da capitoli strettamente precedenti congelati, nomi letterali presenti nel segmento e permessi validi per ruolo. Solo **quote, attore, posizione, offset e classificazione** dell'autore, mai le motivazioni private, le note o `memory.secrets`. Le classificazioni sono interpretazioni fallibili, non fonti di verità o istruzioni.
- Le quattro chiamate di revisori autorizzabili ricevono il pack esclusivamente per il loro ruolo, il **giudice solo per finding di conoscenza letteralmente ancorati**. I 5 lettori ciechi, gli altri 3 specialisti e i modelli di scrittura restano senza il nuovo pacchetto. Nessuna chiamata AI extra, ma possibili token aggiuntivi nei prompt autorizzati.
- Revoca, rettifica della conoscenza, riattestazione o riapertura della fonte invalidano i permessi futuri senza cancellare lo storico. La revoca NON elimina dati già trasmessi ai provider AI. UI con selezione ruolo, motivazione, conferma forte, audit e revoca.
- Persistenza con Web Locks writer/outbox, CAS revisionale, transazione atomica libro+attività+outbox, autosync disabilitato e coda eliminata. Log attività **senza nomi, ruoli, citazioni o rationale**.
- ZIP `content/full`: schema strict su destinatari, duplicati, stati, motivi e max240; importazione **revoca ogni permesso attivo prima di usare la copia**, conservando l'audit quando possibile (altrimenti elimina il registro di autorizzazioni importato in modo fail-closed). I push GitHub manuali possono ancora esportare note private: avviso esplicito.
- Vitest su scoping 12 ruoli+giudice, privacy, default deny, fonte precedente, status/staleness, revoche, CAS e ZIP; Playwright desktop/mobile sul consenso e sua revoca senza chiamate AI/GitHub. [ADR 0048](../ADR/0048-per-knowledge-editorial-recipient-consent.md), [guida](knowledge-sharing-consent.md), issue #20.

**Limiti:** nessuna identità/verità certificata, nessun grafo del sapere completo, nessun nuovo dato promosso a canone o modifica autonoma di memoria e segreti. Il nome e la citazione pubblica possono comunque rivelare spoiler all'AI **se** l'autore autorizza un destinatario. La revoca riguarda solo gli invii futuri.


## 0.11.14 — 2026-11-07 (PR #60)

**Registro privato e motivato delle conoscenze dell'autore**

- Nuovo `narrativeKnowledgeDecisions?` nel `BookProject`, **max 160 decisioni append-only**, con fonte `sourceEventDecisionId`, attore ancorato, verdetto `learned_directly|reported_by_other|still_secret`, motivazione (12–500) e timestamp. Sono interpretazioni dell'autore, NON verità semantiche, fatti certificati o memoria canonica.
- Scelte possibili solo da **attestazioni `knowledge_mention` `affirmed` correnti**: scena canonica congelata, quote/offset, timestamp freeze e checksum attuali. L'ultima decisione per fonte prevale; successiva riapertura, modifica, rigelo o nuova attestazione invalida la vecchia senza cancellare la cronologia. Nessun alias o trasferimento transitivo inferito.
- Scrittura locale protetta con Web Locks writer+outbox, CAS revisionale, blocco durante autopilot/redazione, transazione atomica libro+attività+outbox. **Autosync disabilitato e outbox svuotato**; log senza rationale/spoiler privati. Nessuna chiamata AI o push automatico.
- UI nel pannello eventi: scelta fonte attuale, tre classificazioni e motivazione, conferma esplicita, elenco corrente e storico rettifiche/stale. ZIP `content/full` validato con schema **strict** per ogni nuova decisione, max160, enum, date e limiti; legacy leggibile, import non autentica l'autore. Test dominio, application, ZIP chiaro/cifrato/manomesso e Playwright desktop/mobile.
- **Privacy:** le nuove interpretazioni NON entrano nei prompt dei dodici revisori, del giudice o di altri modelli. Nessuna modifica automatica a canone, `memory.secrets`, inventario, timeline e prosa. La sincronizzazione GitHub *manuale* o l'export ZIP possono comunque divulgare note: l'interfaccia avvisa esplicitamente.
- ADR 0047, [guida](author-knowledge-registry.md), issue #20, package/lockfile 0.11.14.

**Limiti:** solo eventi di conoscenza riconosciuti dall'indice locale e attestati, non un grafo completo di personaggi e segreti. Una voce narrata non garantisce informazione vera; un campo `still_secret` non aggiorna il canone. I consumatori AI richiederanno un consenso e una policy futura.


## 0.11.13 — 2026-11-07 (PR #59)

**Piste locali di trasmissione di informazioni tra personaggi**

- Nuovo `buildInformationTransferTrace` locale e bounded: fino a **4 menzioni letterali** di comunicazioni fra due nomi da capitoli precedenti congelati e scene canoniche; massimo 240 scene scansionate, 6k caratteri per scena e 10k per query. Frase originale/offset, mittente/destinatario, tema condiviso, fonte, freeze e timbro testo, contatori di candidati/scene omessi. Riconoscimento lessicale italiano, non comprensione semantica.
- I quattro specialisti `continuity,timeline,secrets,characterVoice` vedono i nuovi estratti nelle chiamate esistenti; i cinque lettori ciechi e gli altri tre specialisti **non** li ricevono. Il giudice riceve il pack solo per finding `knowledge` con ancora corrente, non per rilievi generici. Una comunicazione citata NON significa notizia appresa o vera.
- Per conflitti di `knowledge` con piste pertinenti, `informationTransferReview` **strict** aggiunge un giudizio motivato per ogni ID testimone effettivamente presente (`possible_path|unrelated|unreliable_report|unknown`). Nessun ID inventato, duplicato o obsoleto. `possible_path` e `unknown` **impediscono di approvare** una remediation fondata su accesso impossibile; il giudice può respingere. Restano tutti i requisiti `narrativeReview` e `knowledgeReview` della v0.11.12.
- Validazione al giudizio, in `repairPrompt` e nella callback sul libro fresco prima del salvataggio di prosa AI. Dashboard con riquadro `Esame dei possibili passaggi informativi`; ZIP strict per il nuovo campo nei giudizi e storici, legacy ancora leggibili.
- Test Vitest per citazioni/offset, privato e futuro esclusi, termini/nomi, limiti, 12 ruoli, rifiuti e gate; ZIP ostili/round-trip; Playwright desktop/mobile con comunicazione precedente, giudice critico e freeze senza riscrittura. ADR 0046, [guida](information-transfer-traces.md), issue #20.

**Limiti:** indizi lessicali, copertura parziale, possibile dialogo inattendibile. Non si certifica un evento né si crea un grafo canonico. Nessuna nuova chiamata AI/HTTP, modifica canon/memoria/segreti/possessi/timeline o nuovo stato top-level; più token nelle richieste esistenti sono possibili.


## 0.11.12 — 2026-11-07 (PR #58)

**Giudizio epistemico sul sapere dei personaggi**

- `knowledgeReview` strict aggiuntivo e obbligatorio per decisioni del giudice relative a `narrativeConflict.dimension=knowledge` (eventi attestati) o `priorSceneConflict.dimension=knowledge` (scene precedenti non attestate). Valuta **modalità narrativa della fonte precedente e corrente**, **percorso di accesso alla notizia**, **fondatezza del conflitto** e ragioni indipendenti.
- Il giudice può respingere falsi conflitti sulla conoscenza con spiegazione: dialoghi, dicerie, sogni, narrazione incerta e apprendimento fuori scena sono compatibili con il testo. In questi casi il software non autorizza remediation. `accept` di conflitti knowledge richiede, oltre al `narrativeReview` preesistente con stesso soggetto, assenza di spiegazione artistica e conflitto ritenuto supportato, **entrambe le fonti classificate narrazione diretta, percorso di accesso esplicitamente escluso e valutazione epistemica supported_knowledge_conflict**.
- Per conflitti di altra dimensione `knowledgeReview` è vietato; legacy ancora leggibili, ma un vecchio conflitto di conoscenza senza valutazione nuova non può ottenere nuove riscritture dopo resume/import.
- Il gate si ripete nel `repairPrompt` e alla callback sul libro fresco prima di salvare testo AI, come da v0.11.11. Dashboard con riquadro autonomo **Valutazione percorso delle conoscenze**. ZIP valida rigorosamente il nuovo campo in `editorialCycle`, `editorialRounds` e `priorRounds`.
- Test Vitest su entrambi i tipi di fonte, ragioni brevi/campi extra, narrazione diretta/dialoghi/sogni/accesso fuori scena, gating e staleness; ZIP round-trip e payload malevoli; Playwright desktop/mobile su ciclo 12 agenti, giudice che respinge e prosa invariata. ADR 0045, [guida](knowledge-provenance-review.md), issue #20.

**Limiti:** la modalità di una frase resta un'interpretazione del modello, non una classificazione semantica certificata. Nessuna nuova chiamata AI, accesso supplementare ai cinque lettori ciechi, modifica automatica del canone o grafo persistente delle conoscenze. Le istruzioni aggiuntive possono usare più token delle chiamate già previste.


## 0.11.11 — 2026-11-07 (PR #57)

**Confronto critico su scene precedenti congelate senza attestazioni autore**

- Nuovo `buildUnattestedSceneContext` locale e deterministico: massimo 3 finestre letterali di prosa **canoniche e congelate, da capitoli precedenti**, derivate dal ranking già bounded (massimo 1.600 candidati esaminati, quattro selezionati internamente). Offset, timestamp di freeze, impronta locale non crittografica, indicatori lessicali e conteggi dei limiti; nessun segreto, canone privato, fonte futura, AI o rete nel pack.
- Solo i quattro specialisti `continuity/timeline/secrets/characterVoice` possono marcare `priorSceneConflict` con scena capitolo, quote/offset/timbro e ipotesi. Citazione verificata nella **finestra realmente fornita al revisore**, oltre alla `finding.evidence` del segmento corrente. Non si può combinare con `narrativeConflict` da evento attestato. Ruoli non autorizzati e fonti obsoleti rifiutati.
- Il giudice indipendente fornisce lo stesso `narrativeReview` su identità, cronologia, causalità e contesto artistico. Può respingere motivatamente un conflitto fallace; `accept` richiede fonte corrente, valutazione supportata, identità comune ritenuta tale, nessuna spiegazione artistica plausibile e incompatibilità cronologica o causale. Il giudizio è **fallibile**, non verità narrativa.
- Validazione ripetuta nel `repairPrompt` **e nella callback di salvataggio della prosa AI su libro fresco**, proteggendo da sorgenti mutate durante la chiamata, pause e ZIP import. `validateReport` e `validateJudgment` usano il libro attuale della transazione. ZIP con schema rigoroso per la nuova marcatura annidata in cicli e storici, legacy compatibile.
- Dashboard con citazione precedente e offset e motivazioni del giudice; test Vitest su fonti false, freeze, modifiche, ruoli, alias, limiti, fallback, privacy, rigetto, repair, ZIP ostili; Playwright desktop/mobile su 12 agenti, nessuna attestazione, giudice che respinge senza correzioni.
- Nessuna chiamata AI extra, nuova migrazione, mutazione autonoma del canone, memoria, segreti, inventari o timeline; nuovi pack possono aumentare i token delle richieste esistenti. ADR 0044, [guida](unattested-scene-review.md), issue #20.

**Limiti:** ranking lessicale NON semantico e a copertura parziale; citazioni dalla prosa NON attestano l'avvenimento, l'identità o la causalità. I finding ordinari fuori da questa marca seguono ancora il controllo editoriale esistente.


## 0.11.10 — 2026-11-07 (PR #56)

**Giudizio narrativo strutturato e gating prudente delle remediation**

- Gli specialisti `continuity`, `timeline`, `secrets`, `characterVoice` possono marcare `narrativeConflict` solo se citano un `priorEventDecisionId` **già presente fra i testimoni precedenti realmente forniti nel loro prompt**. L'ID viene rivalidato al salvataggio; `finding.evidence` resta prova letterale **solo del segmento corrente**.
- Il giudice indipendente deve fornire `narrativeReview` per ogni conflitto marcato, con valutazioni/motivazioni separate su **identità**, **cronologia**, **causalità**, **contesto artistico** e una conclusione. Un giudizio strutturato è rifiutato per finding senza marca; i legacy rimangono compatibili.
- Per `accept`, il gate richiede fonte ancora corrente, stesso soggetto ritenuto tale dal giudice, nessuna spiegazione artistica plausibile, conflitto ritenuto supportato e almeno un'incompatibilità di cronologia o causalità. I falsi positivi possono essere **respinti motivatamente**, senza riscrivere. Prima di ogni `chapterRepair` il gate viene ripetuto, anche dopo resume o import ZIP.
- Dashboard con ipotesi marcate dello specialista, ID testimone e quadro narrativo critico leggibile; backup ZIP contenuto/completo con validazione rigorosa dei due nuovi metadati nei rapporti e nelle decisioni, senza invalidare gli altri campi legacy.
- Test Vitest su fonti, limiti, schema/decisioni, falsi positivi, contesto artistico, resume/import e ZIP ostili; Playwright desktop/mobile su flusso con 12 agenti, giudice che respinge con quattro dimensioni, scena invariata.
- Nessuna nuova chiamata AI, stato canonico, migrazione obbligatoria, accesso ai segreti dei cinque lettori ciechi o promozione automatica di identità. [Guida](structured-narrative-adjudication.md), ADR 0043, issue #20.

**Limite:** il giudice rimane fallibile e le condizioni strutturate non certificano verità semantica. Il nuovo controllo riguarda solo le ipotesi con testimone precedente attestato; i prompt più lunghi possono usare più token nelle chiamate esistenti.


## 0.11.9 — 2026-11-07 (PR #55)

**Prove precedenti dell'autore nella review contestuale con giudice critico**

- Le chiamate esistenti ai quattro specialisti di **continuità**, **timeline**, **segreti** e **voce dei personaggi** ricevono ora, quando pertinenti, fino a **8 testimoni precedenti** validati localmente dalle decisioni evento `affirmed`, anche senza modifiche retroattive. I testimoni includono citazioni letterali, offset, capitolo/scena, ID dell'attestazione, conteggio fonti pertinenti/omesse e provenienza `literal_name|saved_alias`.
- La selezione è basata su nomi **interi**, non sottostringhe, e soltanto su capitoli precedenti congelati; un alias diretto è usato solo se registrato come `linked` con **entrambe le attestazioni fonte precedenti**. Nessun alias temporaneo o transitivo, nessuna fonte futura/non canonica/stale.
- Il giudice riceve i testimoni solo quando i findings hanno **ancora narrativa corrente**; le istruzioni rendono espliciti i controlli critici su identità, flashback, cronologia, dialoghi e POV. Può respingere una remediation non giustificata, sempre motivandola. `finding.evidence` rimane citazione del **solo segmento corrente** e il gate non è allentato.
- I **cinque lettori ciechi** e gli altri specialisti non ricevono questo pack. Nessun segreto, motivazione dell'autore, dossier privato o dati futuri viene copiato nel nuovo pacchetto. Nessuna chiamata AI aggiuntiva, persistenza, migrazione ZIP, auto-remediation o aggiornamento a memoria, oggetti, segreti o timeline.
- Test Vitest su prove valide, invalidazioni, privacy, copertura e alias; test di integrazione prompt giudice indipendente; Playwright desktop/mobile su 12 chiamate isolate e rilievo respinto con freeze. ADR 0042, `docs/attested-contextual-review.md`, issue #20.

**Limite:** recupero lessicale/strutturato non semantico; fino a 8 fonti può aumentare i token della review già prevista. La presenza di una frase o attestazione non dimostra un'incoerenza.


## 0.11.8 — 2026-11-07 (PR #54)

**Registro locale persistente delle ipotesi alias motivate**

- Nuovo storico append-only `BookProject.narrativeAliasDecisions` (max 120): scelta esplicita e motivazione dell'autore (12–500 caratteri) su due nomi, conferma o esclusione del legame, ancorate agli ID di **due attestazioni evento correnti**.
- Revalidazione a ogni consultazione: la decisione più recente sulla coppia prevale senza riattivare quelle vecchie; freeze cambiati, scene mutate, rettifiche/rifiuti delle attestazioni rendono gli alias **storici**, mai fatti canonici.
- Scrittura atomica con Web Locks, CAS, attività e svuotamento outbox, autosync disabilitato. ZIP import/export compatibile con backup precedenti, nuovi campi strict per evitare payload ostili e nessuna modifica delle credenziali remote dopo import.
- Nei segnali di continuità vengono aggiunte le coppie motivate ancora correnti (`identityBasis=saved_alias`) **dopo** i segnali letterali, **prima** delle anteprime temporanee; limite 40 e omissioni contate. Senza inferenze transitive, deduzioni di identità o modifiche a canone, memoria, segreti, possessi e timeline.
- Vitest su rettifiche, staleness, backup manomessi, concorrenza, outbox e confronti; Playwright desktop/mobile su conferma, reload, revoca e isolamento rete. ADR 0041, `docs/persisted-author-aliases.md` e issue #20.

**Limiti:** decisioni attribuite all'autore ma non autentiche dopo import; ancore locali non firmate, legami consultivi non certificati; nessuna espansione dei prompt dei dodici agenti.


## 0.11.7 — 2026-11-07 (PR #53)

**Anteprima temporanea e consensuale degli alias nei segnali di continuità**

- Da «Tracce di continuità da verificare» l'autore può scegliere **due nomi distinti con attestazioni correnti**, confermare una singola ipotesi alias e visualizzare confronti **aggiuntivi** tra nomi diversi. Nessun riconoscimento automatico, transitorio o fuzzy.
- I segnali di nome letterale restano invariati e non vengono cancellati dal confronto. Le nuove piste riportano **entrambi i nomi**, citazioni, offset, capitoli e motivazioni con etichetta `alias_preview`; i nomi non diventano una singola entità canonica.
- La scelta vive **soltanto nello stato React della scheda** ed è associata all'ID del libro: azzeramento esplicito o reload la rimuovono. Nessuna modifica a IndexedDB/ZIP/GitHub snapshot, credenziali, canone, segreti, possessi, timeline o prompt dei dodici revisori.
- Confronto locale, massimo 40 segnali complessivi e omissioni dichiarate. Test Vitest su coppie inesistenti, rettifiche, staleness, additività, risurrezione/date e Playwright desktop/mobile su conferma, azzeramento e mancata persistenza. [Guida](explicit-alias-preview.md), ADR 0040, issue #20.

**Limite:** l'anteprima non è un'associazione identitaria verificata né una decisione persistente dell'autore. Nessuna deduzione semantica o correzione automatica.


## 0.11.6 — 2026-11-07 (PR #52)

**Tracce di continuità da attestazioni autore, senza inferenze automatiche**

- Confronti deterministici e soltanto consultivi fra attestazioni `affirmed` ancora valide in capitoli diversi: possibile azione successiva a morte, seconda menzione di morte senza una «risorge» attestata intermedia e date di scena ISO `YYYY-MM-DD` in ordine inverso rispetto ai capitoli.
- Ogni segnale contiene **entrambe le citazioni letterali**, offset, capitoli, scene e ragioni dell'autore; mostra spiegazioni alternative (flashback, omonimie, soprannaturale) e avverte che l'ordine dei capitoli non equivale alla cronologia degli eventi.
- Max 40 segnali mostrati, conteggio delle omissioni; decisioni stale, respinte e rettificate escluse. Nessuna nuova persistenza, migrazione, rete o AI e nessuna modifica automatica a segreti, oggetti, timeline, prosa, canon o prompt dei lettori.
- Test unitari su date invalide, rettifiche, risurrezione, staleness, isolamento e limiti; Playwright desktop/mobile con doppia attestazione e verifica del canone immutato. ADR 0039, `docs/attested-continuity-signals.md` e issue #20.

**Limite:** segnali testuali euristici, mai contraddizioni certificate; il controllo dell'autore e il giudice critico restano fondamentali.


## 0.11.5 — 2026-11-07 (PR #51)

**Registro locale delle attestazioni narrative e navigazione completa dell'indice**

- L'indice delle menzioni già rilevate è paginato, 30 alla volta: l'autore può raggiungere anche le posizioni 31–80. Nessun ampliamento dello scanner o nuovi eventi impliciti.
- Vista derivata delle sole attestazioni autore **ancora valide**, con citazione, offset, motivazione e posizione capitolo/scena. Rettifiche e decisioni obsolete restano nello storico e sono contate separatamente. La vista non dipende dal cap di 80 menzioni.
- Raggruppamento esplorativo per soggetto letteralmente uguale in più capitoli, per confronto manuale: **non** è una rilevazione semantica di contraddizioni e non riconosce alias/omonimie.
- Nessuna nuova persistenza, rete, chiamata AI, esposizione ai lettori ciechi o modifica di canone/segreti/timeline/possessi. Test unitari e browser desktop/mobile su staleness, rettifiche, limite di indice e navigazione. ADR 0038, guida `docs/narrative-event-ledger.md`, issue #20.

**Limiti:** l'attestazione è una dichiarazione non autenticata; checksum non crittografico, euristiche incomplete e nessuna prova storica o causale.


## 0.11.4 — 2026-11-07 (PR #50)

**Annotazioni motivate dell'autore su singole menzioni di eventi**

- Dal pannello redazione l'autore può registrare `affirmed`/`dismissed` per una menzione letterale congelata con motivazione, conferma esplicita, citazione/offset e storico append-only (massimo 400 record). Una decisione non è una modifica automatica al canone né una prova semantica.
- Riaperture, nuovo `frozenAt`, citazione cambiata o modifica della scena rendono la decisione **non corrente** senza cancellare lo storico; il checksum rapido è solo un indicatore di freschezza non crittografico.
- Web Locks, CAS `updatedAt`, attività e commit IndexedDB atomico; autosync spento e outbox svuotata per richiedere nuova scelta manuale sulla pubblicazione. Nessuna nuova chiamata HTTP/AI e nessuna esposizione ai 5 lettori ciechi.
- Snapshot del libro e ZIP preservano lo storico, con schema stretto e limiti anti-payload ostile; un ZIP importato non autentica la decisione. Guida `docs/narrative-event-decisions.md`, ADR 0037 e issue #20.
- CI PR #50 verde: TypeScript, 287 test Vitest, smoke npm, build e 36 test Playwright Chromium desktop/mobile superati.

**Limite:** nessun aggiornamento automatico a timeline, canone, segreti, oggetti o prompt editoriali; occorrono policy future per la promozione di eventi in memoria causale.

Ogni rilascio su `main` deve avere una voce verificabile. Le PR descrivono il comportamento rilasciato; le issue raccolgono lavoro incompleto e criteri di accettazione.

## 0.11.3 — 2026-11-07 (PR #49)

**Indice locale consultivo delle menzioni di eventi narrativi**

- `narrative-event-candidates.ts` costruisce **sul dispositivo** un indice effimero di menzioni letterali in scene **canoniche e congelate**: conoscenze dichiarate («scopre che»), consegne di oggetti («consegna a») e cambiamenti di stato («scompare», «parte», ecc.), con capitolo/scena, soggetto, eventuale destinatario, data dichiarata, citazione letterale e **offset verificabile**.
- Ogni elemento resta `unverified_literal_pattern`: può riferirsi a dialoghi, sogni o menzogne. **Non** modifica il canone, segreti, timeline, conoscenze o possessi e non certifica fatti/contraddizioni. Dopo una riapertura, il capitolo non congelato **esce** automaticamente dall'indice.
- Nuovo riquadro espandibile «Indice eventi candidati» nel pannello redazione, con quote e provenance consultabili; massimo 30 visualizzati. I campioni cross-chapter possono includere fino a quattro menzioni per scena per **solo** gli specialisti autorizzati e il direttore. I cinque lettori ciechi non ricevono questo contesto aggiuntivo; il gate del finding resta il segmento corrente.
- Limiti dichiarati: primi **20.000 caratteri per scena**, 4 menzioni per scena, 1.600 scene e 80 voci per libro; niente rete, nuovi modelli o richieste AI. Test Vitest e Playwright desktop/mobile su citazioni, privacy, stato congelato, dialoghi, negazioni e limiti. ADR 0036, [guida](narrative-event-candidates.md), issue #20.

**Limite esplicito:** schemi lessicali italiani ristretti, NON comprensione semantica di ciò che personaggi sanno o possiedono. Servirà una futura conferma autore per promuovere una menzione a fatto del canone.

## 0.11.2 — 2026-11-06 (PR #48)

**Recupero locale mirato delle scene per la rivalidazione cross-chapter**

- Recupero **deterministico e locale** `local_structured_lexical_v1`: il ranking confronta entità dichiarate, termini lessicali e date esplicite della scena da rivedere con le scene già congelate a monte. Conserva un ancoraggio al capitolo origine e all'ultimo predecessore, e usa gli slot rimanenti per scene pertinenti **anche in capitoli intermedi**. Massimo quattro scene e due per capitolo; non si effettuano nuove chiamate AI/HTTP.
- Per le scene lunghe le finestre letterali con offset vengono spostate verso i **termini corrispondenti**, inclusi quelli a metà scena; il resto del testo rimane dichiaratamente non visionato. Ogni scena riporta `matchSignals` e `selectionReason`, senza presentarli come prova di contraddizione.
- Contatori di candidati, scansionati, non scansionati e omessi nel prompt; massimo **1.600 scene** scansionate, per scena 16.000 caratteri distribuiti fra inizio, centro e fine per ranking. Gli autori vedono nell'audit del freeze ID e conteggi campionati; vecchi report/ZIP restano leggibili e lo schema importato convalida i nuovi contatori in modalità strict.
- I quattro specialisti autorizzati e il giudice ricevono i campioni; lo storico solo con `historical_evidence` come in v0.11.1, i cinque lettori ciechi restano isolati. `finding.evidence` resta una citazione letterale del **segmento corrente**.
- Vitest su scena pertinente intermedia, finestre nel mezzo e offset, limiti, privacy, precedenza di origine/ultimo predecessore e audit; Playwright desktop/mobile sull'avviso di rivalidazione; ADR 0035, [guida](targeted-continuity-retrieval.md), issue #20.

**Limiti:** matching lessicale/strutturato ≠ comprensione semantica né rilevamento certo delle contraddizioni. Fatti impliciti, sinonimi, scene oltre il cap e passi non campionati possono sfuggire. Gli agenti devono continuare a ragionare in modo critico; l'audit non certifica la completezza.

## 0.11.1 — 2026-11-06 (PR #47)

**I dossier storici entrano nella catena di rivalidazione dei capitoli successivi**

- Tutti i **dodici** use-case storici con rewind di un capitolo congelato (Wikipedia, Crossref, LoC, OCR, collazioni, IIIF, Wikisource, trascrizioni manuali, relazioni di provenienza e quarantene) marcano ora i capitoli già scritti di valle con il trigger strutturato `historical_evidence`. L'origine più antica ancora pendente resta prioritaria e l'audit precedente viene invalidato.
- **Distinzione esplicita fra aggiornamento delle fonti e riscrittura della prosa**: il marker contiene solo ID, capitolo e causa; la sola operazione sul dossier non modifica le scene. Resta il rewind conservativo delle sinossi, outbox e autosync.
- Oltre ai quattro specialisti di continuità, in questa sola circostanza anche lo specialista storico vede **campioni letterali delle scene pubbliche precedenti** e il direttore riceve un avviso che le scene del romanzo **non sono fonti documentali**. I cinque lettori ciechi non ricevono il nuovo contesto.
- La UI distingue `dossier storico modificato` da una correzione narrativa e continua a non presentare il nuovo freeze come certificazione storica o semantica.
- Backup ZIP con nuovo trigger vincolato all'enum, versioni precedenti compatibili; test unitari su catena, OCR/trascrizioni, isolamento ruoli e audit, smoke su tutte e dodici le integrazioni, e Playwright desktop/mobile per la provenienza connessa al rewind.
- ADR 0034, [guida](historical-continuity-rechecks.md), issue #20 e #23; nessuna nuova ricerca automatica o nuova chiamata AI.

**Limiti:** l'aggiornamento di una fonte non dimostra contraddizioni storiche, i campioni non coprono ogni scena e non certificano l'indipendenza delle fonti. I prompt dei revisori possono essere più lunghi. I controlli si applicano ai dodici percorsi esistenti, non a modifiche future non ancora integrate.

## 0.11.0 — 2026-11-06 (PR #46)

**Catena di rivalidazione della continuità dopo modifiche retroattive**

- Riapertura manuale e revisioni retroattive marcano i capitoli successivi già scritti con origine, data, causa e ID delle scene toccate, senza copiare trama o segreti. La modifica più antica ha precedenza; il marker sopravvive ai checkpoint e ai riavvii.
- La redazione procede in ordine cronologico: non si può revisionare e **congelare** un capitolo successivo se un capitolo precedente non è ancora scritto, canonico e congelato. L'autopilot sceglie il primo pronto, prevenendo votazioni su premesse instabili.
- I quattro specialisti di continuità, timeline, segreti e voce ricevono campioni di **scene pubbliche precedenti** dell'origine e dell'ultimo predecessore, con ID, data, riferimenti dichiarati, finestre di testo **letterali con offset** e marcatura `complete|partial`/numero di scene omesse. Il giudice riceve lo stesso contesto e può respingere falsi rilievi. I cinque lettori ciechi non ricevono nuove memorie o segreti.
- Dopo il nuovo freeze, un audit locale registra origine, data e scene campionate; la UI mostra l'obbligo pendente e lo storico, senza chiamare il risultato una verifica semantica certificata.
- Test Vitest su catene multiple, fonti assenti, finestre parziali, ruoli separati, cronologia e audit; test IndexedDB/outbox/Web Locks e Playwright desktop/mobile per riapertura e segnali UI. ADR 0033, [guida](cross-chapter-continuity.md), issue #20.

**Limiti:** il campione è bounded (max 2 scene per origine e ultimo predecessore, max 4 in totale, scene lunghe solo in finestre) e **non esaurisce tutte le possibili contraddizioni**. Una citazione letterale non dimostra un conflitto; il giudice mantiene l'ultima valutazione. I prompt possono essere più lunghi e costosi, pur senza nuove chiamate AI. Le altre vie di riapertura di dossier storici non sono ancora unificate con questo marker.

## 0.10.9 — 2026-11-06 (PR #45)

**Redazione più rigorosa: citazione narrativa letterale e remediation ancorate al segmento**

- Ogni nuovo finding dei dodici agenti richiede almeno 12 caratteri **letteralmente presenti nel segmento letto**; consentite solo differenze maiuscole/a capo/spazi. Il validatore rifiuta parafrasi, citazioni di altre scene, omissioni inventate e risultati basati su segmenti nel frattempo cambiati. Il report non viene archiviato finché non supera il gate.
- `NarrativeEvidenceAnchor` viene costruito **dal codice**: indice del segmento, posizione, citazione originale, numero di occorrenze e breve contesto. Non deriva da campi inventati dal modello. Il giudice riceve `anchorStatus` ricalcolato, distinto dalle opinioni del revisore.
- La **remediation accettata** è rifiutata deterministicamente dall'autopilot se la prova manca, è stata manomessa oppure è diventata obsoleta per modifica della scena. I vecchi rapporti rimangono leggibili e respingibili, non possono autorizzare nuove riscritture senza verifica; le decisioni archiviate non vengono eliminate.
- Interfaccia desktop/mobile: posizione, testo trovato, occorrenze, contesto e avviso esplicito per legacy, tampering o testo cambiato. La presenza di una citazione non è prova che il rilievo sia corretto né che una fonte storica sia vera.
- Test unitari su prove inventate, scene diverse, whitespace, ripetizioni, segmenti stale, accettazione bloccata e rifiuti leciti; Playwright desktop/mobile per etichette e compatibilità legacy. ADR 0032, [guida](editorial-narrative-evidence.md), issue #20.

**Limiti:** il gate è una verifica testuale, NON semantica; critica e proposta di correzione richiedono ancora giudizio indipendente. I rilievi di omissione vanno ancorati a testo esistente e possono richiedere intervento umano. I report precedenti non sono automaticamente promossi a fonti verificate.

## 0.10.8 — 2026-11-06 (PR #44)

**Rilasci npm più riproducibili: lockfile generato realmente e installazioni fail-closed**

- Generato `src/frontend/package-lock.json` **da npm 10 su Node 22, collegato al registro npm reale**, senza ricostruzione manuale. Due installazioni pulite consecutive da lock con `npm ci` verificate sul runner GitHub Actions. Il bootstrap temporaneo è stato rimosso prima del merge.
- CI e GitHub Pages usano `npm ci --no-audit --no-fund` invece di `npm install`. Se manifest e lockfile divergono l'installazione fallisce anziché risolvere automaticamente versioni diverse. Entrambi i workflow controllano anche che npm non abbia modificato il lock.
- Nuovi smoke test verificano root e versione, dipendenze dirette, versioni esatte di Tailwind/Vite, presenza di un vero albero npm, protocolli HTTPS e integrità sha degli archivi pubblici; controllano anche entrambi i workflow.
- ADR 0031, guida alla manutenzione del lockfile e aggiornamenti README/AGENTS/feature, issue #43. Nessuna modifica alla prosa, ai libri salvati, alle API di ricerca o al routing modelli.

**Limiti:** il lockfile riduce il drift delle versioni ma non rende immutabili ambiente runner, registry, piattaforme native o provider. Non sostituisce i test, non verifica automaticamente la sicurezza di tutti i pacchetti e non garantisce un sito raggiungibile prima di Pages verde.

## 0.10.7 — 2026-11-06 (PR #42)

**Ripristino CI e deploy Pages dopo risoluzione incoerente delle dipendenze Tailwind**

- Dopo il merge della v0.10.6, sia CI che build GitHub Pages si sono fermate su `npm install` con `ETARGET: No matching version found for @tailwindcss/oxide@4.3.5`. La CI della PR #41 era verde: il guasto è nella risoluzione senza lockfile di `@tailwindcss/vite` e `tailwindcss`, dichiarati con `^`.
- I due pacchetti sono fissati **esattamente alla versione pubblicata 4.3.4**, con smoke test che impedisce aggiornamenti divergenti del plugin Vite e del framework. Nessuna modifica ai dati o al comportamento del generatore di proposte.
- Il workflow `Cleanup merged branches` riconosce anche `fix/*`, senza allargare le altre condizioni: PR realmente unita, branch nella stessa repository, nessun'altra PR aperta e HEAD del branch identica a quella della PR integrata.
- ADR 0030, runbook e documentazione aggiornati. Verifica integrale TypeScript/Vitest/smoke/build/Playwright mobile+desktop su HEAD PR e verifica dopo il merge di CI main, deploy Pages e pulizia branch.

**Limiti:** senza un `package-lock.json` versionato il restante albero delle dipendenze può ancora cambiare. Non si presume che un `npm install` riuscito una volta garantisca la stessa risoluzione futura: la migrazione a lockfile con `npm ci` resta un intervento distinto.

## 0.10.6 — 2026-11-06 (PR #41)

**Proposte locali di ricerche storiche dai capitoli, con controllo umano prima della rete**

- Il dossier storico del capitolo propone fino a cinque **argomenti di ricerca** tramite una funzione TypeScript locale e deterministica. Riconosce solo un vocabolario pubblico e limitato (per esempio telegrafo, ferrovie, fotografia) e anni di quattro cifre presenti vicino al tema nelle scene; altrimenti propone `storia`. Non invia né copia passaggi, nomi propri, segreti, prompt o credenziali.
- Pulsante `Genera proposte locali` e schede responsive; ogni proposta deve essere **aggiunta manualmente alla bozza modificabile** e poi sottoposta al flusso già esistente `Cerca fonti pubbliche`, con ulteriore dialogo che mostra le query esatte. Generazione/anteprima/aggiunta non effettuano chiamate ai provider e non persistono il dossier.
- Massimo cinque suggerimenti deduplicati per tema, bounded a 16 scene e 24.000 caratteri/scene; nessuna inferenza LLM, nuova tariffa AI o traffico esterno. Limiti delle query pubbliche del dossier, fonti attive, rewind e consenso rete restano invariati.
- Test Vitest su estrazione, date fuori contesto, segreti, ripetizioni e limiti; Playwright desktop/mobile su anteprima senza rete, bozza, consenso annullato, invio delle sole query approvate e layout. ADR 0029, [guida](historical-query-proposals.md), issue #23.

**Limiti:** il vocabolario non copre tutta la storia e le proposte potrebbero non essere pertinenti. Il filtro riduce l'esposizione del manoscritto, ma **non può dimostrare** che un anno o un tema siano pubblici: l'autore deve verificare e approvare ogni query prima di inviarla. Non è un fact-check né una ricerca effettuata in background.

## 0.10.5 — 2026-11-06 (PR #40)

**Dipendenze documentali dichiarate dall'autore: impedire falsa indipendenza fra fonti**

- Nuovo pannello nel capitolo per associare due **snapshot esatti e attivi** di Wikipedia, Wikisource, trascrizioni LoC o OCR LoC, con attestazione `same_original`, `derived` oppure `unknown`, nota motivata (24–400 caratteri) e secondo dialogo di consenso. Nessuna richiesta a servizi esterni; non si asserisce verifica tecnica, autenticità o indipendenza storica.
- Registro append-only `sourceRelations` per capitolo, fino a 60 dichiarazioni, ordinamento deterministico della coppia, ID e timestamp, conserva le rettifiche. L'ultima dichiarazione valida per coppia prevale; `unknown` rettifica un sospetto ma non costituisce prova di indipendenza. Le relazioni restano nell'audit dopo aggiornamento delle revisioni, ma si applicano soltanto quando **entrambi gli ID esatti sono attivi**.
- Il validatore di citazioni rifiuta l'uso congiunto di fonti con originale comune o derivazione dichiarata, **anche se il legame è transitivo**; restano attivi i controlli per revisioni duplicate e citazioni letterali. Lo storico e il direttore ricevono le sole relazioni attive come dati non attendibili; gli altri 11 agenti non le vedono.
- Salvataggio local-first con doppio Web Lock (writer/outbox), CAS su `updatedAt`, attività di audit, autosync disabilitato, outbox pulita e rewind dei capitoli congelati e successivi. Conservazione dei legami attraverso i refresh dei vari dossier, archivi ZIP/IndexedDB e sincronizzazione GitHub opt-in.
- Test Vitest di dipendenze dirette/transitive, rettifiche, revisione obsoleta, dati importati malformati e isolamento, più Playwright mobile/desktop sul consenso e invalidazione freeze. ADR 0028 e [guida autore](historical-source-dependencies.md), issue #23.

**Limiti:** una dichiarazione dell'autore non verifica l'identità reale degli originali. L'assenza di un legame registrato non garantisce che due fonti siano indipendenti. Le fonti potrebbero riprodurre una medesima testimonianza senza indicarlo; il controllo è **conservativo e manuale**, non una verifica archivistica automatica.

## 0.10.4 — 2026-11-06 (PR #39)

**Contesto per ogni divergenza storica e seconda valutazione obbligatoria del direttore**

- I nuovi report `conflicting_excerpts` devono includere `conflictContext`: un record per ciascuna fonte con evento/oggetto, periodo, luogo, edizione e limitazioni. Ogni campo ignoto è `null`, non una supposizione inventata. `comparison.eventIdentity` e una motivazione registrano se l'agente pensa che i documenti descrivano lo stesso evento.
- Il validatore controlla cardinalità e identità esatta delle fonti, la presenza esplicita di campi mancanti, dimensioni e validità delle motivazioni. Se l'agente dichiara eventi `different`, non può segnalarli come contraddizione sullo stesso fatto. **Non certifica corrispondenza semantica, autenticità, diritti o indipendenza reale.**
- Per decidere ogni finding di tipo `conflicting_excerpts`, il direttore deve fornire `conflictReview` con valutazione indipendente dell'evento, cronologia, geografia, edizione e indipendenza, più conclusione. Non può accettare una remediation dichiarando contemporaneamente che gli eventi sono differenti; può respingere con motivazione.
- Il pannello editoriale espone la matrice di contesto e la valutazione del direttore anche da telefono; i report storici v0.10.3 senza nuovi campi restano leggibili con avviso di controllo incompleto. Nessuna nuova ricerca o invio del romanzo a servizi esterni; gli altri undici revisori restano ciechi. Test Vitest, smoke e Playwright desktop/mobile.
- ADR 0027, documentazione autore, issue #23.

**Limiti:** contesto e identità dell'evento sono ipotesi di modelli AI, non controllo documentale o verifica automatica dei fatti. I nuovi campi non inventano una fonte mancante e non autorizzano modifiche automatiche al canone.

## 0.10.3 — 2026-11-06 (PR #38)

**Redazione storica: proposte di divergenza fra fonti indipendenti, con verifica testuale e giudizio critico**

- Il revisore storico può usare `historical.assessment=conflicting_excerpts` per una **possibile** divergenza: deve indicare da due a tre fonti attive indipendenti, una citazione letterale distinta per ciascuna e `sourcePositions` con giudizio motivato `supports|disputes|unclear` per ogni fonte.
- Il validatore rifiuta ID di fonti non attive, revisioni dello stesso documento spacciate per indipendenti, citazioni assenti, posizioni incomplete/duplicate oppure senza almeno una `supports` e una `disputes`. I report precedenti rimangono leggibili senza migrazioni.
- Il direttore editoriale riceve citazioni, contesto delle fonti e posizioni come **interpretazioni non affidabili**, può respingere i falsi conflitti motivando e non modifica direttamente prosa o canone; il pannello mostra la posizione per fonte e l'avviso sulla mancata verifica semantica.
- Nessuna nuova chiamata a servizi esterni o ricerca automatica, nessun invio del romanzo a Wikipedia/LoC/Crossref. I dati storici restano visibili solo allo specialista e al giudice, non agli altri undici revisori. Test unitari per casi validi e attacchi, più CI Playwright desktop/mobile.
- ADR 0026 e [guida alle divergenze](historical-source-disagreements.md); lavoro incrementale dell'issue #23.

**Limiti:** la corrispondenza letterale di due estratti non prova che i documenti siano davvero in disaccordo, che descrivano lo stesso evento, siano storicamente attendibili o abbiano licenze valide. Le posizioni sono proposte del modello e non certificazioni. Il direttore conserva la responsabilità del giudizio e l'autore può intervenire.

## 0.10.2 — 2026-11-06 (PR #37)

**Library of Congress: collegamento puntuale ai metadati di risorse immagine IIIF, senza scaricare scansioni**

- Dopo una collazione `locscan:` attiva, nuova sezione **Riferimenti IIIF scansioni**: dialogo per cercare candidati dalla singola scheda LoC. Il browser legge solo `https://www.loc.gov/item/<itemId>/?fo=json`, selezionando fino a 30 `resources[].info` / `resources[].files[*].info` sotto `https://tile.loc.gov/image-services/iiif/{service|master}:.../info.json`. Niente miniature, anteprime, PDF, immagini o URL non consentiti.
- Scelta esplicita dell'autore della risorsa e due attestazioni separate (stessa pagina/folio già dichiarata e diritti sui metadati), più conferma con ID, pagina, URL e destinatari. Prima del salvataggio l'item JSON viene **riletto** e l'URL selezionato deve essere ancora presente/ammesso. Una sola GET verso il relativo `info.json` verifica identificativo del servizio e dimensioni dichiarate, senza scaricare né analizzare pixel.
- Restrizioni item/risorsa `access_restricted`, `download_restricted`, `rights_restricted` e flag non validi bloccano la richiesta. JSON item max 240 KB, IIIF max 96 KB, timeout 12s/GET, streaming limitato, no redirect, credenziali, cookie, referrer, proxy o ricerche private. Errori CORS/429/JSON/mismatch non producono modifiche parziali.
- Snapshot `lociiif:<itemId>:<timestamp>:<hash16>` con item, ID OCR `lococr:`, collazione `locscan:`, pagina, risorsa, indici, dimensioni e impronta **solo dei metadati tecnici**. Max 40 storici, disattivazione automatica su fonti obsolete, salvataggio Web Locks/CAS, rewind freeze/downstream, autosync off e outbox/activity atomica. Solo specialista storico e giudice ricevono i metadati; gli altri 11 revisori sono ciechi. `lociiif:` non può essere una fonte `historical.sourceIds`.
- Test Vitest provenienza, URL/diritti, identità/fail-closed, domain, concorrenza e Playwright desktop/mobile; ADR 0025 e `docs/loc-iiif-page-provenance.md`.

**Limiti:** `info.json` identifica tecnicamente un servizio e le dimensioni ma **non dimostra che l'immagine sia la stessa pagina dell'OCR**, né autentica scansione, fatto storico, titolo, licenza o copyright. L'associazione della pagina è dichiarata dall'autore; nessuna immagine è recuperata dal programma. I test mock non provano CORS o disponibilità reale in tutte le collezioni.

## 0.10.1 — 2026-11-06 (PR #36)

**Library of Congress: collazione assistita dall'autore della scansione rispetto all'OCR, senza falsa verifica visiva**

- Nuova azione **Confronta OCR con scansione** accanto a ogni `lococr:` attivo. La UI apre la **scheda canonica LoC** già registrata (non un'immagine inventata). L'autore deve leggere **personalmente** la scansione se presente, specificare pagina/folio (4–140 caratteri) e trascrivere dalla pagina una breve frase (36–900 caratteri). Due checkbox distinte per attestazione della consultazione visiva e base dei diritti/condivisione AI/GitHub/ZIP; il dialogo finale mostra **l'intera trascrizione** e le conseguenze del salvataggio.
- Nessun download o OCR di immagini e nessuna richiesta API: confronto **locale deterministico di due stringhe**, usando solo normalizzazione NFKC, minuscole e collasso spazi. `text_overlap` significa contenimento testuale, `text_discrepancy` significa che il testo dichiarato non compare nell'OCR: **non sono autenticazioni dell'originale storico o del copyright**.
- Snapshot append-only `locscan:<itemId>:<timestamp>:<sha16 OCR>` sotto `locOcr.collations`, massimo 40 record. Si conserva OCR esatto, hash, scheda/ispezione di origine, collocazione/pagina, testo osservato, data e attestazioni; i precedenti rimangono in audit. Se OCR/scheda/ispezione diventano obsoleti, le vecchie collazioni non sono fornite alle nuove review.
- Solo **revisore storico e giudice critico** ricevono collazioni come dati esterni non attendibili. Una discrepanza deve fare sorgere dubbi su una remediation basata sul solo OCR. Gli altri undici revisori restano ciechi; `locscan:` non può diventare un ID di fonte indipendente in `historical.sourceIds`. Nessun testo esterno viene aggiunto alla prosa.
- Persistenza IndexedDB atomica sotto Web Locks writer/outbox e CAS `updatedAt`, disattivazione autosync/outbox, activity, recupero sinossi e riapertura congelati/downstream. Nessuna modifica del romanzo. Test Vitest di stringhe, attestazioni, refresh, isolamento agenti e transazioni + Playwright desktop/mobile sul consenso e assenza rete. ADR 0024 e `docs/loc-scan-collation.md`.

**Limiti:** il software NON ha analizzato la scansione visuale; l'autore potrebbe sbagliare pagina, copiare dall'OCR o non avere i diritti. La corrispondenza di due testi digitati non dimostra provenienza visiva, verità, autenticità o licenza. In una prossima tranche valutare collegamento puntuale a pagina IIIF e relativi permessi, senza inventare un'identità delle immagini.

## 0.10.0 — 2026-11-06 (PR #35)

**Library of Congress OCR: riverifica live opzionale del file esatto e quarantena volontaria**

- Per ogni breve fonte `lococr:` attiva, pulsante **Riverifica OCR online** con consenso separato: prima GET al dettaglio canonico `www.loc.gov/item/<id>/?fo=json`, seconda GET **solo** al file `.txt` specifico archiviato, se è ancora fra le risorse istituzionali ammesse. Due host HTTPS fissi e allowlist: nessun romanzo, citazione, hash, nota diritti, query o credenziale inviata alla Library.
- Controllo rigido di identità documento, presenza del file nel catalogo, divieti di download/accesso, **SHA-256 del contenuto**, lunghezza e frase letterale allo stesso offset. Esiti distinti (`identity|resource|digest|excerpt`). Gli errori CORS/429/rete/JSON/risorsa negata **non diventano un esito positivo o negativo**. La verifica è temporanea nella schermata: non modifica libro, IndexedDB, ZIP, GitHub né stato dei diritti.
- Con discordanza, pulsante **Escludi OCR discordante** disponibile solo dopo un secondo consenso esplicito. Elimina soltanto l'ID dalle fonti attive, preservando tutti gli snapshot, audit, report precedenti e prosa. Se il capitolo era congelato, riapre la review e invalida i freeze successivi con recupero sinossi. Web Locks writer/outbox, CAS `updatedAt`, autosync off, outbox e activity in transazione atomica; nessuna rete nella quarantena.
- Lo stesso parser di risorse applica il blocco per `access_restricted`, `download_restricted` e `rights_restricted` ai metadati e singole risorse, rifiutando flag incoerenti e URL non consentite. Streaming limitato 240 KB JSON / 160 KB file OCR, 12 secondi per GET, niente redirect/cookie/referrer o proxy.
- Test Vitest di ritorno live, backup con hash/frase/offset alterati, host/risorsa non più consentita, copyright/restrizioni sopraggiunte, CORS/429/HTML, CAS/freeze, Playwright desktop/mobile per doppio consenso, privacy e confronto; ADR 0023, `docs/loc-ocr-reverification.md`.

**Limiti:** SHA-256 e testo remote **non autenticano la scansione storica, la verità dei fatti, il copyright o l'accuratezza OCR**. Il controllo non è automatico durante le review; i test con risposte simulate non attestano CORS reale né disponibilità di OCR per tutte le collezioni LoC.

## 0.9.9 — 2026-11-06 (PR #34)

**Library of Congress: brevi OCR istituzionali recuperati realmente con diritti attestati dall'autore**

- Nuova sezione **Estratti OCR istituzionali** per capitolo: richiede una scheda LoC e relativa ispezione attiva con riferimento a risorsa testuale e nessun accesso ristretto esplicito. L'autore sceglie base di utilizzo `public_domain|permission`, nota 16–280 caratteri, spunta attestazione e conferma un secondo dialogo che avverte su invio AI/ZIP/GitHub, OCR e copyright.
- Due GET strettamente limitate: dettaglio `https://www.loc.gov/item/<id>/?fo=json`, verifica dell'identità e dell'assenza di restrizione esplicita; poi **un solo file .txt** tra `resources[].fulltext_file|fulltext_derivative|djvu_text_file` solo se sotto `https://tile.loc.gov/storage-services/{service|master}/`. Niente OCR/PDF/HTML/immagini, URL esterne, redirect, cookie, referrer o credenziali.
- Timeout 12 s/GET, lettura streaming limitata a 240 KB di JSON e 160 KB di testo UTF-8; stop su errori CORS/429/JSON/host/identità/formato/limite **senza salvare nulla**. Nessuna ricerca privata o testo del libro inviati a LoC.
- Il browser memorizza soltanto una **porzione letterale di una riga OCR** fino a 900 caratteri, URL istituzionale, SHA-256 del testo ricevuto, lunghezza, offset e timestamp, con ID `lococr:<itemId>:<timestamp>:<sha16>`. `evidenceStatus=institutional_ocr_unverified`; `rightsStatus=author_attested_unverified`: NON equivalgono a originali autenticati, verità storica o licenze certificate.
- Nuove `HistoricalClaim.sourceEvidence` possono citare `lococr:` attivi soltanto con frase letterale propria, senza promuovere `loc:` / `locdetail:`; OCR e trascrizioni manuali dello stesso item non diventano supporti indipendenti. Solo storico e giudice vedono i brani, gli altri 11 ruoli sono ciechi; nessuna scena viene modificata automaticamente.
- Snapshot immutabili max 40 storici / 4 attivi, disattivazione su scheda o ispezione superata, conservazione durante refresh Wikipedia/Crossref/Wikisource/LoC/manuale. Web Locks, CAS, rewind freeze, invalidazione downstream, autosync off, outbox atomica, activity. Test Vitest di fonte/rete/diritti/dominio/concorrenza e Playwright desktop/mobile, ADR 0022, guida `docs/loc-ocr-excerpts.md`.

**Limiti:** i contenuti possono essere OCR errati o trascrizioni derivate, non fonti primarie certificate; i diritti sono attestati dall'autore e non verificati automaticamente. La disponibilità reale di `.txt`/CORS varia per oggetto: i mock non attestano la raggiungibilità browser. Nessuna scansione/PDF e nessuna verifica contro l'immagine originale.

## 0.9.8 — 2026-11-06 (PR #33)

**Library of Congress: ispezione per singola scheda di disponibilità e diritti, senza scaricare originali**

- Nuovo comando per ogni scheda LoC attiva: **Verifica accesso e diritti della scheda**. Dialogo con ID esatto e consenso dell'autore; GET read-only verso `https://www.loc.gov/item/<itemId>/?fo=json` con endpoint fisso. Solo l'ID pubblico è inviato, non query, romanzo, segreti, PAT o chiavi AI.
- Lettura esclusiva di indicatori/catalogo `digitized`, `access_restricted`, `rights_advisory`/`rights`, `access_advisory` e presenza di link a risorse digitali/testuali. **Nessun PDF, OCR, immagine, URL di risorsa o testo originale viene scaricato o salvato**; l'indicatore di una risorsa non certifica che sia realmente disponibile o riutilizzabile.
- Stato dei diritti sempre `undetermined`, evidenza `catalog_metadata_only`. Campi assenti restano `null` (sconosciuto), non «permesso». Risposte identificate dall'ID istituzionale esatto, streaming massimo 240 KB, timeout 12s, zero credenziali/redirect/referrer, errori CORS/429/JSON fail-closed.
- Snapshot separati in `ChapterArchiveCatalog.inspections` fino a 60, revisione append-only con ID `locdetail:<itemId>:<timestamp>`, consultabili via ZIP/backup/GitHub se l'autore sincronizza. Refresh del catalogo preserva lo storico ma disattiva le ispezioni su schede ritirate. I metadati `loc:` e `locdetail:` **non sono citazioni documentali**.
- Solo specialista storico e giudice ricevono gli avvisi, segnalati come metadati non attendibili; gli altri 11 revisori restano ciechi. Concorrenza Web Locks/CAS, riapertura freeze e downstream, outbox atomica e autosync disabilitato. Test Vitest dominio/API/transazioni e Playwright desktop/mobile; ADR 0021, `docs/institutional-item-inspection.md`.

**Limite:** non è ancora acquisizione del testo di un originale istituzionale né una verifica giuridica delle licenze. I test browser con mock non certificano che LoC accetti CORS nel browser reale. L'autore deve esaminare personalmente l'originale e le condizioni di riutilizzo.

## 0.9.7 — 2026-11-06 (PR #32)

**Wikisource: riverifica remota dell'impronta delle revisioni e quarantena volontaria**

- Ogni estratto `itwsr:` attivo può essere **riverificato online** con consenso separato. Il browser invia SOLO il numero della revisione al dominio fisso `it.wikisource.org`, senza trasmettere query, manoscritto, citazioni, segreti, PAT, API key o SHA-256. Un solo GET, nessun retry automatico.
- Il controllo confronta ID pagina, titolo, namespace, ID/timestamp revisione, digest SHA-256, lunghezza e frase letterale all'offset salvato. Stato mostrato in pagina **soltanto temporaneamente**: non è un certificato della fonte e non viene persistito su libro, backup o GitHub.
- Un mismatch genera un **avviso**, mai una correzione silenziosa. Il pulsante **Escludi fonte discordante** richiede una seconda conferma dell'autore, rimuove soltanto il riferimento attivo e preserva testo e report già archiviati.
- Esclusione atomica protetta da Web Locks e CAS `updatedAt`: ripristino sinossi, invalidazione downstream dei freeze, autosync disattivato, outbox cancellata, activity di audit. Nessun fetch nel salvataggio locale. Errore API/CORS/429/timeout non vale né successo né discrepanza e non muta il libro.
- Nuovi test Vitest di verifica remota (manomissione backup, mismatch, errori), application (concorrenza e rewind) e Playwright desktop/mobile. ADR 0020 e `docs/wikisource-reverification.md`.

**Limiti:** confronto con una risposta online MediaWiki, NON autenticazione di manoscritto originale, fatto storico o diritti. Il controllo è su richiesta e temporaneo, non precede automaticamente ogni review; le fonti locali non riverificate restano trattate come trascrizioni non autenticate.

## 0.9.6 — 2026-11-06 (PR #31)

**Wikisource: citazioni legate al wikitesto della revisione esatta, non alla pagina corrente**

- Il lookup storico usa due fasi: ricerca consensuale senza estratti `TextExtracts`, seguita da `query+revisions&revids=...` e `rvprop=ids|timestamp|content&rvslots=main`. Confronto obbligatorio di pagina, namespace, titolo, `revid` e timestamp tra le risposte; l'assenza/mismatch del contenuto causa fallimento del batch senza salvataggi parziali.
- I nuovi estratti sono **porzioni letterali di wikitesto** di massimo 1000 caratteri scelte da righe di prosa semplice. Nessuna esecuzione di template/trasclusione o text parsing fittizio: pagine prive di righe citabili non producono evidenza.
- Il browser calcola `SHA-256` dell'intero wikitesto della revisione e salva metodo, offset e lunghezza, con nuovo ID `itwsr:<pageId>:<revid>:<sha256-16>`. Le `sourceEvidence` possono fare riferimento solo a nuovi snapshot attivi con prova strutturale, mai ad associazioni legacy non accertate.
- **Migrazione conservativa:** gli estratti v0.9.5 `itws:...` restano nello storico e nei report precedenti, ma non sono disponibili alle nuove review perché provenivano dall'estratto della pagina corrente. Riacquisizione solo dopo consenso dell'autore.
- UI con SHA-256/offset e avvisi visibili; storico con banner legacy, giudice con revisionProof e istruzioni per non confondere coerenza testuale, autenticità dell'opera e stato dei diritti.
- Lettura API limitata **in streaming a 150 KB**, protezioni su JSON, CORS, HTTP 429, contenuti nascosti o incoerenti, doppia query e assenza di testo. Test su provenienza, migrazione/audit, privacy, fail-closed e Playwright desktop/mobile; ADR 0019 e guida aggiornata.

**Limiti:** hash locale e ID remoto **non autenticano** l'opera/edizione originale né certificano licenza o attendibilità storica. I backup possono essere alterati prima dell'importazione; per verificarli nuovamente serve rifare una consultazione remota. L'API/CORS reale non è certificata dai test con mock.

## 0.9.5 — 2026-11-06 (PR #30)

**Wikisource: ricerca pubblica consensuale di brevi trascrizioni con ID revisione**

- Nuova sezione per capitolo **Trascrizioni Wikisource**, con 1–3 query pubbliche scritte dall'autore, anteprima e conferma dell'invio a `it.wikisource.org`. Nessuna query automatica da prose, memoria, segreti, canone, credenziali o API key.
- Adapter read-only MediaWiki su host fisso, `origin=*`, `explaintext=1`, `rvprop=ids|timestamp`, fino a 2 estratti/query, timeout 12s, 150 KB max, senza cookie/redirect/credenziali. Risposta API malformata, timeout, 429 o CORS falliscono senza salvataggio parziale.
- Dossier `wikisource` distinto da Wikipedia, DOI, LoC e trascrizioni manuali: snapshot immutabili `itws:<pageId>:<revisionId>`, title/URL canonico ricostruito, testo breve acquisito, data revisione, query, data consultazione e storicizzazione fino a 70 voci.
- Il revisore storico può citare solo la specifica versione attiva con una `sourceEvidence` letterale per fonte; due revisioni della stessa pagina non valgono come fonti indipendenti. Il direttore riceve quote verificabili, revisioni e stato `community_transcription_unverified`; gli altri 11 ruoli sono ciechi agli estratti.
- Rewind sicuro dei freeze e delle sinossi, Web Locks, `updatedAt`, outbox cancellata e autosync off; backup/ZIP e altre ricerche preservano gli snapshot Wikisource. Test Vitest ed E2E desktop/mobile, ADR 0018 e guida `docs/wikisource-transcriptions.md`.

**Limiti importanti:** Wikisource ospita **trascrizioni collaborative**, non originali autenticati. La sola disponibilità di un estratto non prova né l'autenticità, né un fatto storico, né il pubblico dominio: diritti e attribuzione della singola opera devono essere verificati manualmente. I mock browser non attestano l'effettiva disponibilità di `TextExtracts`/CORS né l'esatta atomicità fra estratto e ID revisione restituito dall'API.

## 0.9.4 — 2026-11-06 (PR #29)

**Estratti storici trascritti dall'autore: provenienza e diritti dichiarati**

- **Versione online corretta**: il footer desktop e l'header mobile leggono `package.json.version`, eliminando il precedente testo fisso «v0.3.0» che non corrispondeva alla versione distribuita.
- **Pulizia dei branch**: workflow dedicato su push a `main`, con cancellazione solo di branch di PR già unite, mai di PR aperte, `main` o riferimenti il cui SHA sia stato modificato; vedere `docs/branch-maintenance.md`.
- Nuovo pannello **Estratti da originali consultati dall'autore**: un documento del catalogo Library of Congress già approvato, pagina/folio e trascrizione breve (24–1200 caratteri), data/edizione opzionale, conferma della base dei diritti e motivazione.
- Nessuna nuova richiesta verso archivi durante il salvataggio; l'app non scarica originali, immagini, PDF, OCR o testi completi. Checkbox + conferma che mostra la trascrizione e spiega l'invio futuro a modelli AI e la possibile sincronizzazione GitHub.
- Dossier `manualEvidence` conservativo: ID `locex:<itemId>:<timestamp>`, snapshot immutabili, fino a 40 versioni/5 documenti attivi, associazione alla scheda LoC valida. Le trascrizioni riferite a schede inattive sono conservate ma escluse dalle nuove review.
- La redazione storica può citare `locex:...` solo mediante `sourceEvidence[{sourceId,quote}]` effettivamente presente nella trascrizione. Gli ID di catalogo `loc:...` e i DOI `crossref:...` restano **non probatori**. Due trascrizioni dello stesso originale non sono due fonti indipendenti.
- Il direttore visualizza `evidenceStatus=author_transcribed_unverified` e la collocazione, con istruzioni a non certificare l'autenticità; gli altri undici agenti non vedono gli estratti. Interfaccia con provenienza e diritti dichiarati.
- Web Locks, CAS `updatedAt`, salvataggio e activity atomici, rewind dei capitoli congelati, autosync off e outbox cancellata. Test Vitest e Playwright desktop/mobile, ADR 0017, `docs/archival-excerpts.md`.

**Limiti:** originali e licenze sono attestati dall'autore, **non verificati autonomamente** dall'app. Una citazione letterale prova corrispondenza al testo digitato, non provenienza, autenticità, diritto di pubblicazione o veridicità del documento. È ancora aperta la consultazione indipendente dei documenti originali e delle loro versioni.

## 0.9.3 — 2026-11-06 (PR #28)

**Cataloghi storici istituzionali: piste di ricerca LoC, non evidenza documentale**

- Pannello per capitolo **Archivi istituzionali** con 1–3 query pubbliche inserite dall'autore e conferma esplicita dell'invio delle stringhe esatte alla Library of Congress.
- Adapter browser read-only API JSON LoC, senza chiavi, cookie o redirect, origini/URL canonici controllati, fino a 3 schede/query, timeout e limiti dimensione. La rete CORS e i rate limit possono impedire il funzionamento senza proxy o backend.
- Record storicizzati con titolo, ID LoC, URL ricostruita, data/descrizione se presenti, query e timestamp in IndexedDB e snapshot ZIP/GitHub; dati Wikipedia e Crossref preservati fra ricerche.
- **Nessuna prova simulata:** le schede sono metadati, non documenti letti; `loc:...` vietato nei sourceIds documentali. Soltanto il revisore storico e il direttore editoriale possono consultarle come piste.
- Aggiornamenti con Web Locks, fencing `updatedAt`, stop in caso di errore, rewind e invalidazione dei freeze successivi, autosync off e outbox eliminata.
- Test privacy, URL ostili, rete, persistenza, concorrenza e Playwright mobile/desktop. ADR 0016, guida `docs/institutional-archives.md`, issue #23.

**Limiti:** API LoC non garantisce CORS nel browser; è necessaria consultazione umana degli originali e delle condizioni di utilizzo. Nessun OCR, testo completo o verifica primaria automatica.

## 0.9.2 — 2026-11-06 (PR #27)

**Verifica delle citazioni storiche per singola fonte (anti-falsa corroborazione)**

- Ogni fonte citata in un nuovo rilievo storico deve avere una propria citazione letterale, collegata mediante `sourceEvidence[{sourceId,quote}]`. Il validatore verifica il testo **nell'estratto specifico**, non in una qualsiasi delle fonti elencate.
- Una sola citazione storica legacy resta valida soltanto per un rilievo con un unico `sourceId`; due revisioni della stessa pagina Wikipedia non costituiscono fonti indipendenti.
- Il direttore riceve `citedQuote` e `quoteMatches` per ciascuna fonte per valutare criticamente pertinenza e possibili contraddizioni. La Dashboard mostra ciascuna citazione accanto alla relativa fonte e segnala i report vecchi privi di prove individuali.
- Nuove regressioni Vitest su falsa corroborazione, citazioni scambiate, revisione duplicata e separazione dei contesti. ADR 0015, issue #23.

**Limiti:** Wikipedia è terziaria; corrispondenza letterale non prova verità, indipendenza delle voci o accuratezza del giudizio storico. Nessuna consultazione di fonti primarie o studi DOI integrali.

## 0.9.1 — 2026-11-05 (PR #25)

**Bibliografia DOI verificabile per capitolo: metadati Crossref separati dalle prove storiche**

- Nuovo pannello **Bibliografia DOI** per ciascun capitolo nella Dashboard/Redazione: da 1 a 5 DOI immessi dall'autore e consultati solo dopo conferma delle stringhe esatte da inviare a `api.crossref.org`.
- Adapter browser `GET https://api.crossref.org/works/{doi}`, senza credenziali/cookie/redirect, con filtro DOI rigido, timeout, controllo dei payload, richieste seriali e salvataggio atomico; 404 significa soltanto che il DOI non è censito in Crossref.
- Dossier bibliografico distinto dagli estratti Wikipedia con titolo, autori, anno di pubblicazione, rivista/collana, editore, tipo dell'opera e URL generata da DOI, timestamp e storico degli snapshot. I metadati **non** comprendono abstract o testo completo né garantiscono l'accuratezza di un'affermazione.
- La bibliografia viene mostrata solo al revisore `historical` e al direttore editoriale come **pista da consultare**, senza contaminare gli altri 11 agenti o i lettori ciechi.
- **Divieto di usare metadati come prove:** `HistoricalClaim.sourceIds` continua a richiedere estratti effettivamente acquisiti e citazioni letterali valide. Un DOI Crossref non è accettato come ID di fonte documentale e non può certificare una proposizione.
- I riferimenti bibliografici sono conservati in IndexedDB e nei backup/snapshot del libro; aggiornare le schede DOI riapre un capitolo congelato, invalida i successivi, ripristina la sinossi precedente e disabilita autosync con Web Locks e controllo `updatedAt`.
- Copertura test Vitest su DOI non validi, privacy, rete non autorizzata, blocco della serializzazione concorrente, rewind sicuro, separazione dei prompt e contrasto delle false citazioni DOI; test Playwright desktop/mobile sul consenso e sull'intero ciclo storico.
- ADR 0014, `docs/crossref-bibliography.md`, README, AGENTS, sicurezza e issue #23.

**Limiti:** il DOI non garantisce peer review, testo disponibile, veridicità o affidabilità della pubblicazione; i metadati Crossref non sono una fonte primaria. L'integrazione con archivi istituzionali e fonti primarie effettivamente lette resta una fase successiva.

## 0.9.0 — 2026-11-05 (PR #24)

**Dossier storico tracciabile per capitolo, ricerca pubblica con consenso e verifica delle citazioni dell'AI**

- Dashboard **Redazione multi-agente → Dossier storico**: fino a 5 query per capitolo, scritte dall'autore e inviate a Wikipedia italiana **solo dopo una conferma che mostra le stringhe esatte**. Non parte alcuna ricerca automatica dal testo inedito, dai personaggi o dalla timeline privata.
- Adapter MediaWiki Action API anonimo e browser-only: `https://it.wikipedia.org/w/api.php`, CORS `origin=*`, niente cookie/credenziali, redirect disabilitati, timeout, risposta max 170 KB, massimo 3 pagine per query e host/URL allowlist.
- Dossier in IndexedDB con query, fonti, link articolo, ID pagina e revisione, estratti, data consultazione, ricerche senza risultati e storico delle revisioni citate. Backup ZIP e snapshot del libro mantengono i metadati senza nuove credenziali.
- Il revisore **storico** (una delle 12 chiamate indipendenti) riceve soltanto il dossier documentale del capitolo, mentre gli altri 11 ruoli, inclusi i cinque lettori ciechi, non ricevono le nuove fonti.
- Ogni finding storico dichiara una delle tre valutazioni: `consistent_with_excerpt`, `contradicts_excerpt`, `unverified`; i primi due stati richiedono source IDs validi e una **frase realmente presente** in un estratto consultato. Il software respinge fonti inventate, citazioni inesistenti e valutazioni non verificabili mascherate da documentate.
- Il direttore editoriale riceve le fonti e gli estratti associati ai rilievi storici insieme agli estratti delle scene, per poter **accettare o respingere** una remediation motivando. I risultati esterni non riscrivono il manoscritto automaticamente.
- Aggiornare le fonti dopo il congelamento riapre il capitolo, invalida i successivi e ripristina la sinossi globale precedente; operazione serializzata con Web Locks e controllo revisioni, autosync sospeso e outbox scartata.
- Link alla pagina Wikipedia e alla specifica revisione, con attribuzione agli autori; gli estratti sono **fonti terziarie**, non certificazione di verità storica né ricerca d'archivio.
- Test Vitest su privacy, origine HTTPS, finti link, query, report e citazioni, rete e concorrenza IndexedDB; test Playwright desktop/mobile su consenso, passaggio al revisore storico, giudice scettico e congelamento.
- ADR 0013, guida `docs/historical-sources.md`, issue #23, documentazione di sicurezza e roadmap.

**Limiti:** ricerche manuali per argomenti pubblici, solo Wikipedia IT e non fonti primarie o secondarie. Una frase riportata correttamente può essere falsa o fuori contesto. Per fact-checking storico approfondito occorreranno archivi istituzionali, bibliografia attendibile, più fonti indipendenti ed estrazione di query da approvare prima dell'invio esterno.

## 0.8.1 — 2026-11-05 (PR #21)

**Budget stimato per libro, prezzi AI per endpoint/modello e stop preventivo delle richieste**

- Nuovo pannello **Budget AI del libro** sulla Dashboard: opt-in, soglia in euro per periodo, massimo token output richiesto e tariffario manuale per input/output (€/milione di token) su ciascun modello e provider configurato.
- Prima di ogni chiamata del runner — compresi sette specialisti, cinque lettori, direttore, remediation, consolidamento e sinossi — calcolo preventivo dei token input con riserva UTF-8, dell'output configurato e dei costi stimati da usage del periodo. Se non c'è margine, l'autopilot va in pausa **prima di contattare il provider**.
- Anche le proposte AI di fusione delle scene usano lo stesso controllo; le bozze manuali restano gratuite.
- Ogni richiesta potenzialmente fatturabile viene marcata `aiRequested` in IndexedDB **prima del fetch**. Se la risposta manca di token, la rete cade o l'attività viene interrotta, il budget si blocca conservativamente alle richieste successive senza trattare il consumo ignoto come gratuito.
- I listini sono inseriti dall'autore e non includono crediti residui inventati. L'interfaccia mostra stime monetarie da token dichiarati e prezzi configurati, non fatture o saldo del provider.
- Nessuna tariffa/prezzo predefinito. La protezione è **facoltativa**, retrocompatibile con i libri esistenti e permette di alzare la soglia mantenendo lo storico; disattivare e riattivare apre un nuovo periodo su scelta esplicita.
- Backup ZIP content-only conserva budget per libro e activity; backup completo conserva anche le tariffe globali, con validazione degli importi.
- Test Vitest su prezzi mancanti, provider/modelli distinti, risposte senza usage, attività fallite, riserva e limiti, più integrazione runner e scena AI. Test Playwright desktop/mobile su configurazione, stop prima della chiamata e uso sconosciuto.
- ADR 0012, nuova guida `docs/ai-budget.md`, issue #17 e documentazione della sicurezza.

**Limiti:** non è un hard cap delle fatture: il provider potrebbe addebitare chiamate interrotte, ignorare `max_tokens` o applicare tariffe/cache diverse da quelle inserite. Il calcolo input usa un'approssimazione prudente in byte UTF-8, non il tokenizer ufficiale. Il portale del provider rimane la fonte della fatturazione effettiva.

## 0.8.0 — 2026-11-05 (PR #19)

**Redazione multi-agente per capitolo — verifica critica, remediation e congelamento**

- Dopo il completamento delle scene, ogni capitolo entra in una redazione composta da **sette specialisti** (causalità, segreti, timeline, accuratezza storica da verificare, voce personaggi, stile, struttura) e **cinque lettori** (genere, generalista, scettico, personaggi, mistero).
- **Richieste AI separate** per revisore e segmento. I lettori sono ciechi ai segreti privati; gli specialisti ricevono le porzioni pertinenti del canone; il revisore dei segreti legge il registro privato. Memoria breve per ruolo e sinossi progressive del libro.
- Rapporti JSON verificati: esito, prova testuale, gravità, motivazione e remediation proposta. Il direttore editoriale dispone anche di **estratti della scena originale** e canone pertinente per verificare la fondatezza della prova; giudica ogni rilievo, può accettarlo o **respingerlo con spiegazione**, e non può ignorare rilievi in silenzio.
- La riscrittura riguarda solo scene con correzioni approvate; seguono la riconciliazione di memoria, timeline e segreti e un'altra tornata completa di dodici letture.
- Fino a **tre tornate di correzione automatica**. Se persistono problemi accettati, il processo si ferma e chiede istruzioni all'autore, senza inventare consenso.
- Quando i rilievi sono risolti o respinti criticamente, la sintesi progressiva aggiorna il capitolo e il libro, **congela il capitolo** e consente solo allora di scrivere il successivo.
- I capitoli congelati mantengono lo storico di rapporti, decisioni e motivazioni e una fotografia della **sinossi globale in quel punto**. **Rivaluta** ripristina quella fotografia, disabilita autosync e invalida gli assensi di tutti i capitoli successivi; nessuna sinossi è troncata silenziosamente e i legacy non ricostruibili bloccano il rewind.
- Nuove route modelli `chapterAudit`, `chapterReaders`, `chapterJudge`, `chapterRepair`, configurabili globalmente e per libro; riutilizzo di `consolidate` e `summarize`.
- Il push GitHub e l'autosync di prosa non avvengono mentre capitoli scritti attendono congelamento. I checkpoint si salvano in IndexedDB dopo ogni attività.
- Pannello responsive **Redazione multi-agente** con analisi per revisore, prove testuali, remediation e motivazioni di rifiuto, stato dei capitoli e riapertura manuale.
- Vitest per ruoli e contesti indipendenti, valutazione critica, freeze e cicli correttivi, rewind di snapshot/legacy e scarto di risposte AI obsolete. Test Playwright desktop/mobile e ADR 0011, guida utente e issue #20.
- Dipendenza Playwright fissata alla release stabile 1.64.1 per evitare risoluzioni di prerelease incomplete nel registry CI.

**Limiti:** la review storica segnala ipotesi ma **non verifica fonti esterne**. Un capitolo lungo può richiedere oltre dodici chiamate per segmento e consumare molti crediti; il ledger v0.7.1 non impone ancora tetti. La memoria privata troppo grande si blocca con un errore anziché troncarsi. Le sessioni browser non lavorano con pagina chiusa; il lease multi-dispositivo rimane conservativo.

## 0.7.1 — 2026-11-05 (PR #18)

**Dashboard per libro dei token AI dichiarati dai provider**

- Nuovo pannello **Consumi AI registrati** sulla Dashboard, con token input, output e totale noto per il libro attivo.
- Aggregazione per endpoint e modello: i token Sol/Astra/Luna e di provider diversi non vengono confusi.
- Contatori distinti per report completi, parziali e senza usage, con avviso sulle attività fallite/interrotte che possono aver consumato token senza un report dal provider.
- UI responsive desktop/mobile, con tabella a scorrimento locale e test per evitare overflow della pagina.
- Nessun credito residuo, costo in euro o limite di spesa inventato. Il saldo reale è nel portale del provider e il prezzo per token dipende dai suoi listini.
- Calcolo puro da attività IndexedDB già presenti: nessuna nuova API, tracking esterno, chiave o costo AI per generare le statistiche.
- Unit test per token validi/invalidi, report mancanti, multi-provider e attività manuali; Playwright desktop/mobile con isolamento dei consumi fra due libri.
- ADR 0010, issue #17, documentazione utente e backlog per listini configurabili, soglie e stop preventivo.

**Limiti:** il totale noto può essere inferiore ai consumi fatturati, perché provider e richieste fallite non garantiscono usage. La versione 0.7.1 è osservabilità, **non** controllo automatico dei crediti o tetto di spesa.

## 0.7.0 — 2026-11-05 (PR #16)

**Diff parola per parola e proposte di fusione delle scene, con approvazione esplicita**

- Evidenziazione locale/GitHub delle differenze testuali; algoritmo LCS con limiti di complessità per mobile e fallback per paragrafi o scene intere su testi lunghi.
- Laboratorio di fusione direttamente nella schermata di confronto delle scene, con editor manuale gratuito e opzione per proposta AI previa conferma del trasferimento di entrambe le versioni e dei segreti all'endpoint selezionato.
- Nuova attività `merge` configurabile con endpoint/modello globale o per libro; nessun nome modello o tariffario hardcodato.
- Il runner delle proposte AI usa lease GitHub, Web Locks, controllo dello SHA remoto e della revisione locale prima/dopo la generazione. Le bozze non modificano il canone.
- IndexedDB v2: store `mergeDrafts` con storico proposte, originali locale/remoto, modello, token se noti, stato proposto/rifiutato/accettato. Persistenza dopo reload.
- Approvazione umana in più passaggi: selezione della bozza, recupero a doppio backup e conferma canonica nel Lettore. Le scene fuse restano `draft` finché l'autore non le conferma. Prima della conferma runner AI, revisioni e ogni push GitHub sono bloccati lato servizio; autosync resta disattivato.
- ZIP di contenuti ampliato in modo compatibile per includere lo storico bozze. Un ZIP importato non può riutilizzare bozze proposte come autorizzazioni canoniche.
- Test unitari di diff, limiti e recovery, finti provider e GitHub, ZIP roundtrip, più test Playwright desktop/mobile per editor manuale, persistenza e doppio backup.
- ADR 0009 e documentazione per l'autore; issue #15.

**Limiti:** la fusione AI è una proposta editoriale, non un controllo di continuità affidabile o un merge semantico perfetto. Il provider AI può addebitare la chiamata anche se la bozza viene rifiutata; i token sono mostrati solo quando il provider li comunica. Il browser deve restare aperto e i backup ZIP content-only contengono la prosa in chiaro.

## 0.6.0 — 2026-11-05 (PR #14)

**Confronto visuale GitHub e recupero narrativo protetto**

- Confronto read-only tra libro locale e snapshot HEAD GitHub; baseline comune opzionale dal commit dell'ultima sincronizzazione.
- Differenze per brief, vincoli, idee, review, singoli capitoli/scene, personaggi, luoghi, fazioni, oggetti, segreti, cronologia e stato narrativo. Scelta esplicita locale/GitHub per ciascuna unità, default locale.
- Recupero della versione GitHub come nuovo libro indipendente; oppure applicazione sul libro originale dopo creazione **atomica di due copie di sicurezza** (locale e GitHub) e activity audit.
- Controllo Web Locks e validazione di SHA remoto, timestamp e baseline locale prima della transazione. Nessun push, delete o force GitHub durante il ripristino.
- Disabilitazione dell'autosync dopo la risoluzione e richiesta di review manuale prima della successiva sincronizzazione.
- Test Vitest di merge conservativo, eliminazioni, baseline, conflitti e backup; test Playwright Chromium desktop/mobile.
- Documentazione: ADR 0008, guida `docs/conflict-recovery.md`, runbook e issue #3/#10.

**Limiti:** non è un merge semantico automatico né un diff parola-per-parola. Le copie sono salvate nel browser e vanno esportate anche in ZIP per una protezione esterna. Modifiche GitHub avvenute dopo la verifica sono bloccate dal successivo controllo SHA.

## 0.5.0 — 2026-11-05 (PR #12)

**GitHub writer lease — controllo della scrittura AI tra browser**

- Lease remoto per ogni libro collegato: branch `bookwriter-lock/<bookId>`, file `.bookwriter/lease.json`, commit solo fast-forward.
- Sessione di scrittura con UUID effimero: acquisizione obbligatoria prima dell'AI, verifica pre/post chiamata e prima del checkpoint, heartbeat ogni 25 secondi, TTL due minuti.
- Un altro dispositivo con lease attivo impedisce l'avvio dell'autopilot prima di spendere crediti. In caso di perdita del lock o indisponibilità GitHub il risultato in corso non viene canonizzato.
- Lock Web Locks fra tab del browser, rilascio best effort a fine sessione. Recupero manuale solo dopo scadenza più 60 secondi, con conferma.
- Stato del lease e recupero nell'Archivio mobile/desktop.
- Test di concorrenza con GitHub simulato, rinnovo, rilascio, takeover e perdita di possesso; ADR 0007 e runbook aggiornato.

**Limitazioni:** lease e recovery sono conservativi e basati sull'orologio del browser: non sono un database distribuito con fencing atomico. Il lease protegge il runner AI; modifiche manuali esterne e conflitti della prosa richiedono ancora risoluzione separata. Nessuna esecuzione con scheda chiusa.

## 0.4.0 — 2026-11-05 (PR #9)

**GitHub Autosync — fase 2a, opt-in**

- Outbox persistente in IndexedDB scritta nella stessa transazione dei checkpoint narrativi significativi (outline, review, consolidamento e revisione).
- Worker browser che invia automaticamente quando la scheda è aperta, riprende al reload/ritorno online e usa Web Locks contro invii concorrenti tra tab.
- Coalescing dei checkpoint, retry esponenziale limitato, stato bloccato e comando di riprova, visibili nella sezione Archivio.
- Marcatori di operazione nel commit e nel canon remoto per riconoscere commit riusciti quando la risposta è stata persa; ACK atomico che non elimina modifiche effettuate durante l'invio.
- Autosync disattivato per default, disponibile solo dopo il primo commit manuale e previa autorizzazione aggiuntiva per repo pubbliche.
- Suite Vitest per outbox, worker e recovery, più CI desktop/mobile.

**Non incluso:** lease distribuito tra dispositivi, risoluzione conflitti, ZIP snapshot remoti, Google/Microsoft OAuth. L'autopilot opera soltanto con la pagina attiva.

## 0.3.0 — 2026-11-05 (PR #8)

**GitHub Sync — fase 1, manuale**

- Connessione per libro con PAT fine-grained GitHub cifrato in IndexedDB.
- Verifica permessi e visibilità delle repository, consenso se pubbliche.
- Proiezione della memoria narrativa in Markdown/frontmatter Narrarium.
- Commit multi-file tramite Git Data REST con SHA e rifiuto degli aggiornamenti non fast-forward, mai force push.
- Import di libri e attività da `.bookwriter/project.json` senza sovrascrivere i dati locali.
- Test unitari per proiezione, privacy e conflitti; test UI Chromium desktop/mobile confermati tramite CI.
- Documentazione: `ADR/0005-github-manual-sync.md`, `docs/github-sync.md`, aggiornamenti AGENTS, README, feature e issue #3.

**Non incluso:** autosync, lease multi-device, snapshot ZIP remoti, login Google/Microsoft, E2EE tra dispositivi.

## 0.2.1 — 2026-11-05 (PR #7)

- Suite Playwright Chromium desktop e mobile.
- Correzione della navigazione mobile sticky e della larghezza dei tab.
- Test persistenza IndexedDB e round-trip ZIP.

## 0.2.0 — 2026-11-05 (PR #1)

- Prima SPA React/TypeScript responsive con tema chiaro/scuro.
- Orchestrazione autonoma da brief a scene, audience review e registrazione delle attività.
- Configurazione endpoint e routing dei modelli.
- Persistenza IndexedDB e AES-GCM locale delle API key.
- Backup ZIP e importazione non distruttiva, export EPUB/DOCX/PDF.
- GitHub Pages su `https://ghostwriting.ws`.
