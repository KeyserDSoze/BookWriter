# BookWriter

**BookWriter** è un progetto per la scrittura autonoma e supervisionabile di libri con modelli di intelligenza artificiale configurabili.

> Stato: **prima applicazione local-first e in evoluzione**. Le funzionalità descritte sono obiettivi di prodotto, non ancora un'applicazione pronta per la produzione.

## Funzionalità disponibili

- SPA mobile e desktop, tema chiaro/scuro.
- Creazione di libri, orchestra AI multi-modello con osservabilità dei passaggi e possibilità di pause/revisioni.
- Persistenza IndexedDB e chiavi API cifrate con Web Crypto.
- Import/export ZIP content-only o completo (password AES-GCM opzionale, chiaro solo dopo avviso).
- Generazione EPUB, DOCX e PDF dalla prosa canonica.
- **EPUBCheck ufficiale in CI v0.11.63:** job indipendente che genera con `buildEpub` un libro sintetico canonico e lo valida tramite il checker W3C/DAISY 5.4.0, scaricato a versione fissa e verificato via SHA-256 ufficiale. Eventuali errori EPUBCheck bloccano la CI, senza importare dati dell'autore. **Il controllo copre il campione CI, non certifica ogni EPUB esportato.** [Guida CI](docs/epubcheck-ci.md), [ADR 0095](ADR/0095-official-epubcheck-ci.md), [issue #100](https://github.com/KeyserDSoze/BookWriter/issues/100).
- **Numerazione PDF v0.11.62:** numeri `Pagina X di Y` centrati in fondo alle pagine dei capitoli canonici, con frontespizio non numerato e continuità automatica anche attraverso i salti pagina; test di documenti reali desktop/mobile. [Guida export](docs/book-export.md), [ADR 0094](ADR/0094-pdf-canonical-folios.md), [issue #99](https://github.com/KeyserDSoze/BookWriter/issues/99).
- **EPUB 3 con frontespizio e landmarks v0.11.61:** frontespizio XHTML nella sequenza di lettura, landmarks per frontespizio e primo capitolo canonico, senza inventare autore o copertina; test di riferimenti manifest/spine, XML e download desktop/mobile. [Guida](docs/book-export.md), [ADR 0093](ADR/0093-epub3-titlepage-landmarks.md), [issue #97](https://github.com/KeyserDSoze/BookWriter/issues/97).
- **PDF con controllo preventivo dei caratteri v0.11.60:** il generatore locale ispezionabile non scarica documenti con glifi non rappresentabili dai font standard: errore esplicito con alternativa EPUB/DOCX, anziché esportazione silenziosamente danneggiata. Test unitari e download desktop/mobile. [Guida](docs/book-export.md), [ADR 0092](ADR/0092-pdf-preflight-and-portable-export.md), [issue #96](https://github.com/KeyserDSoze/BookWriter/issues/96).
- **DOCX verificabile v0.11.59:** builder Word indipendente dal download, controlli XML/ZIP sul documento reale e sanitizzazione della prosa AI prima della creazione delle parti WordprocessingML. Solo scene canoniche, test browser desktop/mobile e nessun invio del testo in rete. [Guida](docs/book-export.md), [ADR 0091](ADR/0091-docx-canonical-xml-package.md), [issue #95](https://github.com/KeyserDSoze/BookWriter/issues/95).
- **Indice EPUB a due livelli v0.11.58:** capitoli e singole scene canoniche raggiungibili con collegamenti interni deterministici; sezioni XHTML con intestazioni etichettate, escape XML e test desktop/mobile che controllano i target. [Guida export](docs/book-export.md), [ADR 0090](ADR/0090-epub3-scene-navigation.md), [issue #94](https://github.com/KeyserDSoze/BookWriter/issues/94).
- **EPUB 3 validato strutturalmente v0.11.57:** package ZIP con `mimetype` STORED, OPF/nav/spine coerenti, escaping XML anche per caratteri AI malformati, esclusione di bozze e memoria non canonica; test unitari e download Playwright desktop/mobile. [Guida export](docs/book-export.md), [ADR 0089](ADR/0089-epub3-canonical-export-validation.md), [issue #93](https://github.com/KeyserDSoze/BookWriter/issues/93).
- Setup GitHub Pages su **https://ghostwriting.ws** (asset base root).

**Sincronizzazione GitHub**: la PR #8 introduce collegamento a repository per libro, PAT fine-grained cifrato localmente, proiezione Markdown/frontmatter, commit multi-file con controllo SHA, import non distruttivo e blocco dei conflitti. Vedi `docs/github-sync.md` e ADR 0005.

**Autosync v0.4.0:** la PR #9 aggiunge l'outbox persistente e i commit automatici per i checkpoint narrativi, con retry, recovery e controlli Web Locks tra tab. È disattivato per default e va abilitato in Archivio dopo il primo commit manuale. Vedi ADR 0006.

**Lease writer v0.5.0:** la PR #12 aggiunge un lock GitHub a branch separata per impedire l'avvio di un secondo autopilot AI sullo stesso libro, con rinnovo periodico e recupero manuale dei lock scaduti. Vedi ADR 0007 e issue #10. È una mitigazione best effort, non un database distribuito con fencing atomico.

**Confronto e recupero v0.6.0:** la PR #14 introduce differenze visuali locale/GitHub per capitoli, scene, personaggi e segreti, selezione esplicita per elemento e doppio backup atomico prima di applicare. Nessun force push; autosync disattivato dopo il recupero. Vedi ADR 0008 e `docs/conflict-recovery.md`.

**Fusione di scene v0.7.0:** la PR #16 aggiunge diff parole/paragrafi con fallback mobile, proposte AI facoltative, editor manuale, storico bozze in IndexedDB e ZIP, e approvazione esplicita a doppio backup. Le proposte accettate restano draft, mai canoniche automaticamente: il Lettore richiede una successiva conferma umana e, fino a quel momento, blocca autopilot e push GitHub. Guida: `docs/scene-merge.md`, ADR 0009.

**Consumi AI v0.7.1:** la PR #18 mostra sulla Dashboard input/output token effettivamente comunicati dai provider, separati per libro, modello ed endpoint, e segnala report mancanti e chiamate fallite. Non inventa saldi o prezzi. Vedi ADR 0010 e `docs/ai-usage.md`.

**Redazione indipendente v0.8.0:** la PR #19 introduce una redazione per capitolo con 7 specialisti e 5 lettori in chiamate separate, rilievi documentati con remediation, direttore editoriale critico che può respingere rilievi infondati motivando, riscritture mirate e congelamento solo dopo un esito risolto. Dopo tre tornate senza soluzione si ferma e chiede all'autore. Riaprire un capitolo invalida i successivi. Guida: `docs/editorial-board.md`; ADR 0011.

**Budget AI v0.8.1 (PR #21):** limite stimato facoltativo per libro prima di ogni chiamata dell'autopilot, redazione e fusione AI, con tariffe per modello/provider inserite dall'autore, output massimo e blocco conservativo su usage mancante. Non è un saldo credito o un tetto garantito alla fatturazione. Guida `docs/ai-budget.md`, ADR 0012.

**Dossier storico v0.9.0 (PR #24):** per ogni capitolo puoi cercare fino a cinque argomenti storici pubblici previa conferma; l'app consulta Wikipedia italiana senza inviare il romanzo, archivia link e revisioni, verifica gli ID e le citazioni letterali dei rilievi del revisore storico e mostra fonti e motivazioni del direttore. Wikipedia è **terziaria**, non una certificazione storica. Guida `docs/historical-sources.md`, ADR 0013 e issue #23.

**Bibliografia DOI v0.9.1 (PR #25):** ogni capitolo può conservare pubblicazioni identificabili tramite Crossref, ricercate solo dopo conferma dell'autore, con autori, anno, editore e link DOI. I metadati aiutano lo specialista storico a individuare studi da leggere, **ma non sono prove del loro contenuto**: il giudice distingue scheda bibliografica e citazione documentale. Guida `docs/crossref-bibliography.md`, ADR 0014, issue #23.

**Integrità delle citazioni v0.9.2 (PR #27):** le evidenze storiche di un rilievo devono riportare una citazione letterale distinta per ogni fonte attiva; il giudice vede il legame fra estratto e citazione. ADR 0015.

**Cataloghi d'archivio v0.9.3 (PR #28):** una ricerca consensuale per capitolo di 1–3 argomenti pubblici nel catalogo digitale Library of Congress, con schede e link verificati, data e snapshot conservati, presentati solo a storico e giudice. I metadati NON dimostrano fatti né sono citazioni dei documenti. Guida `docs/institutional-archives.md`, ADR 0016, issue #23.

**Estratti originali v0.9.4 (PR #29):** dopo aver consultato personalmente una scheda della Library of Congress, l'autore può archiviare una breve trascrizione con pagina/folio e base dichiarata dei diritti. La review storica può verificare una citazione nel testo digitato, ma non ha letto o autenticato autonomamente l'originale. Leggi `docs/archival-excerpts.md`, ADR 0017 e issue #23.

**Release e branch:** l'interfaccia mostra la versione letta direttamente da `src/frontend/package.json` (la vecchia dicitura fissa «v0.3.0» era obsoleta). Le release sono pubblicate su GitHub Pages dopo CI verde, e il workflow di pulizia rimuove soltanto branch di PR già integrate senza nuovi commit; [guida ai branch](docs/branch-maintenance.md) e [deploy](docs/deployment.md).

**Wikisource v0.9.5 (PR #30):** per capitolo, ricerca soltanto dopo consenso su 1–3 query pubbliche, con brevi estratti di trascrizioni Wikisource e ID/data revisione. Le citazioni dei rilievi storici sono confrontate contro il testo ricevuto e valutate dal direttore. Gli altri undici agenti non ricevono gli estratti. Le trascrizioni sono **collaborative e non autenticate**; i diritti sull'opera originale sono da verificare. Guida `docs/wikisource-transcriptions.md`, ADR 0018 e issue #23.

**Revisione esatta Wikisource v0.9.6 (PR #31):** la ricerca recupera **il wikitesto della revisione numerica effettiva**, verifica pagina/titolo/timestamp, ne conserva una sottostringa letterale con offset e SHA-256 e rifiuta discrepanze. Le vecchie associazioni `itws:...` della v0.9.5 rimangono nello storico ma non sono più citabili in nuove review finché non vengono riacquisite con consenso. Nuovi ID `itwsr:...`. Nessuna certificazione dell'originale o del pubblico dominio. [Guida](docs/wikisource-transcriptions.md), ADR 0019, issue #23.

**Riverifica remota v0.9.7 (PR #32):** nel pannello Wikisource, l'autore può confrontare nuovamente su richiesta una fonte `itwsr:` con la revisione pubblicata, tramite SHA-256, timestamp e offset. Il risultato è temporaneo e **non certifica l'originale**. In caso di discordanza può scegliere di escluderla, preservando audit e invalidando i capitoli congelati dipendenti. [Guida](docs/wikisource-reverification.md), ADR 0020, issue #23.

**Avvisi istituzionali v0.9.8 (PR #33):** dalle schede Library of Congress si può, con consenso, consultare il dettaglio dell'oggetto per leggere indicazioni di accesso e diritti. BookWriter salva solo metadati, senza scaricare il documento, e **non** deduce licenze o prove storiche dalla scheda; [guida](docs/institutional-item-inspection.md), ADR 0021 e issue #23.

**Acquisizione OCR istituzionale v0.9.9 (PR #34):** l'autore può, dopo scheda e ispezione LoC attive e attestazione esplicita dei diritti, leggere un solo file .txt da host istituzionale selezionato, memorizzando **un breve estratto letterale** con SHA-256/offset. Lo storico e il giudice possono citarlo, distinguendo OCR da originale autenticato e diritti da attestazione dell'autore. [Guida](docs/loc-ocr-excerpts.md), ADR 0022, issue #23.

**Riverifica OCR LoC v0.10.0 (PR #35):** l'autore può confrontare volontariamente un estratto OCR `lococr:` con il **medesimo file .txt ancora elencato nella scheda LoC attuale** e verificare SHA-256, lunghezza e offset, senza inviare il libro o modificare il dossier. Una discordanza può comportare l'esclusione della fonte dalle nuove review solo con seconda conferma, mantenendo report/audit e riaprendo i freeze dipendenti. Non autentica originali o diritti. [Guida](docs/loc-ocr-reverification.md), ADR 0023, issue #23.

**Indice eventi candidati v0.11.3 (PR #49):** nella redazione appare un indice locale di **menzioni** letterali di scoperte, passaggi di oggetti e cambiamenti di stato, soltanto dai capitoli congelati, con quote e offset. Le menzioni sono **ipotesi testuali**, non fatti del canone: non generano correzioni né aggiornano la memoria. Gli specialisti autorizzati e il direttore le vedono nei campioni cross-chapter; i lettori ciechi restano isolati. [Guida](docs/narrative-event-candidates.md), ADR 0036, issue #20.

**Riconciliazione merge Git verificati v0.11.56 (main):** gli intenti manuali sospesi possono essere archiviati, su consenso autore, anche se il commit originario è raggiungibile da una HEAD con **merge Git binari**. Tutti i rami devono essere controllati entro 32 commit; un solo marker/commit esatto e HEAD stabile autorizzano la cancellazione del **solo intento locale**. Niente nuovi push o modifiche ai libri. [Guida](docs/github-sync.md), ADR 0088, issue #92/#10.

**Riconciliazione storico GitHub v0.11.55 (main):** un push manuale sospeso può essere verificato anche come **antenato lineare** della HEAD avanzata da un altro dispositivo. La prova è limitata a 32 commit, richiede parent unico, baseline, marker allo SHA originale e HEAD stabile. L'archiviazione rimane esplicita e cancella solo l'intento, non il romanzo o l'outbox. Test unitari e browser desktop/mobile. [Guida](docs/github-sync.md), ADR 0087, issue #91/#10.

**Intenti GitHub sospesi riconciliabili v0.11.54 (main):** se la destinazione o la baseline locale cambia dopo un push manuale incerto, l'autore può verificare e archiviare il tentativo precedente **solo** se HEAD, commit, parent e marker sulla vecchia repository lo attestano. Nessun nuovo push o reset arbitrario, libro e outbox preservati. Test unitari e browser desktop/mobile a due schede. [Guida](docs/github-sync.md), ADR 0086, issue #90/#10.

**Push GitHub manuale recuperabile dopo reload v0.11.53 (main):** l'operationId viene salvato prima della rete nello store IndexedDB meta e riutilizzato dopo un'interruzione. Lock writer+outbox impediscono push concorrenti; ACK libro/outbox e rimozione dell'intento sono atomici. Il recovery via HEAD e marker non duplica commit. Test desktop/mobile a due schede. [Guida](docs/github-sync.md), ADR 0085, issue #89/#10.

**Push GitHub con recovery di ACK perso v0.11.52 (main):** una risposta PATCH persa dopo il commit può ora essere verificata **in sola lettura** tramite HEAD, messaggio Git e marker di operazione, anche nel push manuale. Senza prove esatte, nessun ACK o doppio PATCH. Test Vitest e browser desktop/mobile. [Guida](docs/github-sync.md), ADR 0084, issue #88/#10.

**HEAD GitHub verificata dopo il push v0.11.51 (main):** una risposta HTTP positiva non basta: BookWriter confronta lo SHA del PATCH e rilegge la HEAD esatta **prima** di aggiornare il commit locale e l'outbox. Una risposta incoerente non viene segnata come sincronizzata, e un ACK perso resta recuperabile tramite marker. Test Vitest + due tab desktop/mobile. [Guida](docs/github-sync.md), ADR 0083, issue #87/#10.

**ACK GitHub e outbox atomici v0.11.50 (main):** dopo il commit remoto, l'ACK rilegge il libro e salva i metadati del commit e lo stato della coda nella **stessa transazione IndexedDB**, senza perdere un checkpoint creato nel frattempo. La conferma obsoleta non retrocede la baseline; test a due tab desktop/mobile. Il gap GitHub–IndexedDB è recuperabile ma non è una transazione distribuita. [Guida](docs/github-sync.md), ADR 0082, issue #86/#10.

**Collegamento GitHub e autosync protetti v0.11.49 (main):** le modifiche manuali della repository e della policy autosync acquisiscono i Web Locks del writer e della coda GitHub, verificano la revisione IndexedDB al commit e non riscrivono dati canonici obsoleti. Guardie editoriali ricontrollate al momento dell'attivazione; test due schede desktop/mobile. [Guida](docs/github-sync.md), ADR 0081, issue #85/#10.

**Conferma scene fuse e audit atomici v0.11.48 (main):** la promozione manuale a `canon` ora richiede la revisione valida **anche nella transazione** che salva libro e attività. Un cambio concorrente impedisce sia la canonizzazione obsoleta sia un falso audit. Test a due schede desktop/mobile. [Guida](docs/scene-merge.md), ADR 0080, issue #84/#10.

**Feedback dell'autore protetto v0.11.47 (main):** richiedere una revisione richiede Web Locks sul libro e conferma atomica della revisione IndexedDB; una tab obsoleta o un writer AI attivo non vengono sovrascritti, e il testo del feedback rifiutato rimane disponibile per una nuova valutazione. Test su due schede desktop/mobile. [Guida](docs/autopilot.md), ADR 0079, issue #83/#10.

**Override del modello protetti v0.11.46 (main):** modificare endpoint/modello per un libro non sovrascrive più snapshot obsoleti. Web Locks impedisce il cambio durante la scrittura AI e un confronto atomico di `updatedAt` preserva libro/outbox su conflitto. Input modello salvato all'uscita dal campo, test su due tab desktop/mobile. [Guida](docs/autopilot.md), ADR 0078, issue #82/#10.

**Recovery multi-tab v0.11.45 (main):** aprire una seconda scheda non mette più in pausa l'autopilot attivo nella prima. Prima di riconoscere una sessione come interrotta BookWriter acquisisce il Web Lock del libro; senza lock disponibile mantiene checkpoint e audit. Test Vitest e Playwright desktop/mobile con due schede. [Guida](docs/autopilot.md), ADR 0077, issue #81/#6/#10.

**Rinnovo lease verificato v0.11.44 (main):** dopo un tentativo di rinnovo, BookWriter richiede che GitHub punti esattamente al nuovo commit; un 409 o una richiesta non applicata non è più considerata successo solo perché la sessione precedente è ancora attiva. Un ACK smarrito dopo l'applicazione è invece riconosciuto senza ripetere il commit. [Guida](docs/github-sync.md), ADR 0076, issue #80/#10.

**Lease 404 verificato v0.11.43 (main):** anche quando la branch di lock non esiste, GitHub deve fornire un `X-RateLimit-Reset` valido e compatibile con l'orologio locale prima che BookWriter possa dire «nessun lock». L'Archivio distingue verifica in corso, assenza verificata e errore, senza riutilizzare uno stato obsoleto. [Guida](docs/github-sync.md), ADR 0075, issue #79/#10.

**Controllo clock lease v0.11.42 (main):** i libri GitHub collegati bloccano l'autopilot e il takeover quando l'orologio del browser è palesemente incoerente con la finestra `X-RateLimit-Reset` esposta da GitHub o manca l'header. È una verifica **approssimativa**, non sincronizzazione orari o fencing completo. [Guida](docs/github-sync.md), ADR 0075, issue #78/#10.

**Autopilot protetto v0.11.41 (main):** la generazione AI su libri **anche locali** richiede Web Locks per escludere sessioni concorrenti fra tab dello stesso browser. Se l'API non è disponibile, l'avvio fallisce senza generare né alterare il manoscritto. I libri GitHub collegati continuano a richiedere anche il lease remoto. [Guida](docs/autopilot.md), ADR 0074, issue #77/#6/#10.

**Scansione lessicale parziale v0.11.40 (main):** il direttore e l'autore vedono ora anche quante scene correnti **incluse** nella ricerca sono troppo lunghe per la scansione lessicale completa dei primi/centro/fine 16.000 caratteri. Il freeze le marca come copertura parziale; ZIP strict compatibile con vecchi audit. Nessun aumento delle chiamate AI. [Guida](docs/targeted-continuity-retrieval.md), ADR 0073, issue #76/#20.

**Copertura della query corrente v0.11.39 (main):** il giudice vede ora quante scene correnti hanno alimentato la ricerca aggregata e quali sono state omesse; lo storico dopo il freeze mostra i conteggi e marca la copertura parziale anche se tutti i testimoni precedenti erano leggibili. Campi opzionali per i vecchi libri, nessun aumento dei limiti o chiamate AI. [Guida](docs/targeted-continuity-retrieval.md), ADR 0072, issue #20.

**Scene rappresentative v0.11.38 (main):** nei capitoli con più di sei scene, la ricerca aggregata del direttore non si ferma più alle prime sei: include inizio, fine e quattro scene intermedie distribuite sull'intero capitolo. Max sei scene correnti e limiti di AI/privacy invariati; i segmenti non selezionati restano da verificare nelle review individuali. [Guida](docs/targeted-continuity-retrieval.md), ADR 0071, issue #20.

**Nomi bilanciati v0.11.37 (main):** durante la rivalidazione dell'intero capitolo, anche i 16 nomi espliciti usati per cercare menzioni nella prosa precedente sono distribuiti tra le prime sei scene correnti: una lunga lista nella prima scena non oscura più il personaggio della sesta. La ricerca a singola scena e i limiti e permessi restano invariati. [Guida](docs/targeted-continuity-retrieval.md), ADR 0070, issue #20.

**Query multi-scena v0.11.36 (main):** nella rivalidazione dell'intero capitolo i 48 termini del confronto con le scene precedenti vengono distribuiti a turni fra le prime sei scene correnti, evitando che la prima scena escluda le successive. Le review di una singola scena e tutti i limiti, le citazioni originali e la privacy restano invariati. [Guida](docs/targeted-continuity-retrieval.md), ADR 0069, issue #20.

**Confini dei frammenti v0.11.35 (main):** la rivalidazione dei testi lunghi non scambia più i resti di una parola spezzata dal campionamento per un nome completo: `Ivo` non può nascere dal taglio di `Vivo`, né `orologio` da `orologiox`. Validazione dei confini originali anche per Unicode, senza nuovi dati, AI o ampliamento del campione. [Guida](docs/targeted-continuity-retrieval.md), ADR 0068, issue #20.

**Menzioni ripetute v0.11.34 (main):** nei capitoli lunghi il secondo estratto può mostrare anche una **successiva occorrenza** dello stesso nome/oggetto quando non esiste un diverso segnale fuori dalla prima finestra; se il primo match di un altro segnale era già visibile, cerca ulteriori occorrenze oltre la finestra. Due citazioni non sono due prove indipendenti. Massimo due estratti, privacy e limiti invariati. [Guida](docs/targeted-continuity-retrieval.md), ADR 0067, issue #20.

**Estratti mirati v0.11.33 (main):** nelle scene precedenti lunghe la rivalidazione può mostrare due riferimenti letterali distanti (per esempio un personaggio e un oggetto) nelle due finestre già previste; quando un secondo riferimento non esiste, conserva il contesto distante. Offset originali, max due estratti e giudizio critico invariati. [Guida](docs/targeted-continuity-retrieval.md), ADR 0066, issue #20.

**Campionamento cross-chapter v0.11.32 (main):** nei romanzi con oltre 1.600 scene precedenti, il ranking distribuisce i candidati a turni fra i capitoli, con priorità a origine e ultimo predecessore e alle scene d'origine esplicitamente cambiate. Evita che un capitolo enorme escluda tutti gli altri; campione parziale e conteggi di omissione restano visibili. [Guida](docs/targeted-continuity-retrieval.md), ADR 0065, issue #20.

**Finestre di continuità v0.11.31 (main):** gli estratti di scene precedenti preferiscono nomi e parole intere realmente presenti, con offset conservati nel testo originale. «Ivo» non coincide più con la sottostringa di «vivo»; il campionamento e i controlli privacy restano invariati. Nessuna identità, contraddizione o correzione viene dedotta dal match. [Guida](docs/targeted-continuity-retrieval.md), ADR 0064, issue #20.

**Recupero di nomi letterali v0.11.30 (main):** la rivalidazione cross-chapter può trovare scene precedenti che citano nella prosa un personaggio, oggetto, luogo o fazione dichiarati nella scena corrente, anche senza tag sulla scena storica. Ricerca a parola intera, bounded e locale; distingue il segnale dai tag, non deduce alias né identità canoniche, non espone nuove note private e non attesta contraddizioni. [Guida](docs/targeted-continuity-retrieval.md), ADR 0063, issue #20.

**Filtri del registro editoriale v0.11.29 (main):** il registro per capitolo consente di isolare ambiguità, frasi spostate, suggerimenti riformulati, citazioni non osservate in un ciclo corrente e fonti/giudizi non convalidati. Il filtro si applica alle 240 osservazioni campionate prima del limite di 12 serie, con conteggi separati e senza inferire problemi risolti. È consultivo e non trasferisce note private ai modelli. [Guida](docs/editorial-diff-ledger.md), ADR 0062, issue #20.

**Registro differenze editoriali v0.11.28 (PR #74):** per ogni capitolo, una cronologia locale dei controlli irrisolti attraverso più revisioni, con confronto delle citazioni e delle parole suggerite dal giudice, differenze di posizione, ambiguità e limiti di campione espliciti. Nessuna frase assente è considerata risolta; le note private dell'autore non vengono trasferite o copiate nel registro. [Guida](docs/editorial-diff-ledger.md), ADR 0061, issue #20.

**Confronto archivi e nuova revisione v0.11.27 (PR #73):** dopo aver riaperto un capitolo, confronta localmente le verifiche irrisolte precedenti con le nuove prove **letterali**, distinguendo citazione invariata, spostata, ambigua o non osservata nel campione. Le note private storiche non vengono mai trasferite al nuovo giudizio, né l'assenza della citazione significa problema risolto. [Guida](docs/editorial-archive-revision-comparison.md), ADR 0060, issue #20.

**Annotazioni dei capitoli congelati v0.11.26 (PR #72):** dentro **Giudizi archiviati** l'autore può annotare una verifica con prove dichiarate insufficienti, prendendola in carico, respingendola o azzerando una scelta. Resta **sempre storica**, senza riaprire capitoli né eseguire AI/repair; round duplicati e refreeze non riattivano annotazioni obsolete. [Guida](docs/frozen-editorial-verification-annotations.md), ADR 0059, issue #20.

**Scelte autore sulle verifiche v0.11.25 (PR #71):** l'autore può prendere in carico, respingere o azzerare una verifica **irrisolta e corrente** proposta dal giudice, con motivazione privata, storico e conferma. Le scelte non sono permessi AI né approvazioni di remediation; ZIP importati le azzerano. [Guida](docs/author-editorial-verification-choices.md), ADR 0058, issue #20.

**Piano verifiche editoriali v0.11.24 (PR #70):** dashboard locale e **senza nuove chiamate AI** per vedere quali divergenze attendono il giudice, quali richiedono prove aggiuntive, quali correzioni sono state approvate e quali giudizi sono stale o storici. Gli archivi non riabilitano correzioni; prove mancanti e prossimi controlli restano suggerimenti. [Guida](docs/editorial-verification-plan.md), ADR 0057, issue #20.

**Divergenze tra raccomandazioni v0.11.23 (PR #69):** quando specialisti diversi suggeriscono correzioni differenti per la stessa citazione, il giudice deve riconciliarle, dichiarare le prove mancanti e suggerire un prossimo controllo (non automatico). Una proposta con evidenze non risolte non può autorizzare riscritture; gruppi fuori campione bloccati. Nessun dato nuovo ai lettori ciechi. [Guida](docs/editorial-recommendation-disagreements.md), ADR 0056, issue #20.

**Confronto critico delle piste v0.11.22 (PR #68):** se il giudice riceve valutazioni di comunicazioni autorizzate, deve discutere **ciascuna** citazione e motivare accordo, contestazione o incertezza. Il software controlla ancora le ancore e i consensi e impedisce remediation se l'accesso resta possibile/ignoto. Nessun nuovo fatto canonico, nessuna chiamata AI extra. [Guida](docs/critical-judge-transfer-challenge.md), ADR 0055, issue #20.

**Consensi mirati sulle piste v0.11.21 (PR #67):** l'autore può condividere una singola interpretazione comunicativa solo con i quattro specialisti selezionati e/o il giudice critico, con grant e revoca espliciti; nessun invio ai lettori ciechi, zero canone implicito, ZIP importati con autorizzazioni revocate. [Guida](docs/transfer-consent-ai.md), ADR 0054, issue #20.

**Registro delle piste comunicative v0.11.20 (PR #66):** dopo un'anteprima volontaria, l'autore può valutare una singola citazione come comunicazione descritta, indizio possibile o pista respinta, con motivo e storico delle rettifiche. Solo fonti correnti, nessuna promozione a canone né nuovo invio ai modelli AI. [Guida](docs/author-transfer-assessments.md), ADR 0053, issue #20.

**Anteprima comunicazioni v0.11.19 (PR #65):** per una coppia di conoscenze già confermata come «stessa informazione», l'autore può cercare esplicitamente menzioni letterali di possibili dialoghi fra i due nomi, in entrambe le direzioni e solo nei capitoli congelati precedenti. Nessuna trasmissione dedotta, nessuna chiamata AI o salvataggio della ricerca. [Guida](docs/knowledge-transfer-preview.md), ADR 0052, issue #20.

**Avvisi sulle conoscenze v0.11.18 (PR #64):** se l'autore ha confermato direttamente tre coppie con due relazioni «stessa informazione» e una «informazioni differenti», la UI mostra un possibile disallineamento con le tre citazioni. Nessun terzo link dedotto, nessun intervento automatico o invio AI. [Guida](docs/knowledge-topic-triangle-advisories.md), ADR 0051, issue #20.

**Collegamenti privati delle conoscenze v0.11.17:** su due menzioni di personaggi distinti già attestate, l'autore può indicare motivatamente che riguardano la **stessa informazione** oppure informazioni **diverse**, con rettifiche last-wins e fonte sempre rivalidata. La dashboard confronta le citazioni e i tempi già annotati, **senza** dedurre comunicazione fra personaggi, transitività o canone. Nessun nuovo campo ai modelli AI, neppure con opt-in knowledge preesistente. [Guida](docs/knowledge-topic-links.md), ADR 0050, issue #20.

**Timeline privata delle conoscenze v0.11.16:** l'autore annota il momento in cui un personaggio sa una notizia (durante la scena, già prima, non ancora o incerto) separatamente dall'ordine di racconto (lineare, flashback, ignoto). Storico con fonti correnti, confronto per personaggio in ordine di **manoscritto** e backup strict; nessuna inferenza di causalità, nessun nuovo dato temporale nei prompt AI anche con opt-in precedente. [Guida](docs/knowledge-timing-registry.md), ADR 0049, issue #20.

**Consenso mirato ai revisori v0.11.15:** l'autore può autorizzare o revocare l'uso di **una singola interpretazione corrente** del sapere di un personaggio solo per i ruoli scelti fra Continuità, Timeline, Segreti, Voce e Giudice. Default privato; zero divulgazioni ai 5 lettori ciechi. Prompt con sole quote/etichetta, mai le motivazioni private; import ZIP disabilita gli opt-in. [Guida](docs/knowledge-sharing-consent.md), ADR 0048, issue #20.

**Registro conoscenze dell'autore v0.11.14:** su menzioni `knowledge_mention` già attestate e correnti è possibile annotare con motivazione `appresa direttamente`, `riferita da altri` o `ancora segreta`. Audit append-only, freeze/stamp rivalidati, autosync disabilitato, backup ZIP strict. Le note private non passano automaticamente agli agenti AI e non modificano il canone. [Guida](docs/author-knowledge-registry.md), ADR 0047, issue #20.

**Piste di comunicazione v0.11.13:** la redazione confronta fino a quattro menzioni testuali di notizie raccontate fra personaggi in capitoli precedenti. Il giudice deve valutare se siano possibili vie d'accesso, non fatti certi; un accesso plausibile o indeterminato blocca l'approvazione di un falso conflitto di conoscenza. [Guida](docs/information-transfer-traces.md), ADR 0046, issue #20.

**Conoscenze dei personaggi v0.11.12:** il giudice deve motivare le differenze fra narrazione diretta, voci, sogni e accesso plausibile fuori scena quando un rilievo segnala ciò che un personaggio sa. Il gate blocca una riscrittura fondata su conoscenze non dimostrate. [Guida](docs/knowledge-provenance-review.md), ADR 0045, issue #20.

**Confronti su scene non attestate v0.11.11:** i quattro specialisti di continuità possono citare fino a tre estratti letterali di capitoli precedenti congelati, anche senza annotazioni evento dell'autore. Il giudice valuta identità, cronologia, causalità e spiegazioni artistiche prima di autorizzare qualsiasi intervento; le fonti vengono rivalidate al salvataggio del repair. Il testo non diventa un fatto canonico. [Guida](docs/unattested-scene-review.md), ADR 0044, issue #20.

**Giudice narrativo strutturato v0.11.10:** i conflitti esplicitamente collegati a un testimone precedente richiedono una decisione critica per identità, cronologia, causalità e spiegazioni artistiche prima di autorizzare una remediation. Il gate è rivalidato anche dopo resume/import, senza rendere le attestazioni fatti canonici. [Guida](docs/structured-narrative-adjudication.md), ADR 0043, issue #20.

**Testimoni nella redazione v0.11.9:** i quattro specialisti di continuità e il giudice critico possono confrontare brevi attestazioni narrative pubbliche precedenti pertinenti alla scena, anche nelle review ordinarie. Il giudice può respingere false contraddizioni; i cinque lettori ciechi non vedono il nuovo contesto. [Guida](docs/attested-contextual-review.md), ADR 0042, issue #20.

**Registro alias v0.11.8:** l'autore può registrare, rettificare ed escludere con motivazione una coppia di nomi ancorata a due attestazioni correnti. Lo storico attraversa reload e backup ZIP, ma si invalida se la prosa o le decisioni sorgente cambiano, senza convertire nomi in identità canoniche. [Guida](docs/persisted-author-aliases.md), ADR 0041, issue #20.

**Anteprima alias v0.11.7:** l'autore può selezionare e confermare temporaneamente due nomi attestati come possibile pseudonimo e confrontare le rispettive tracce, senza fondere entità canoniche, cancellare i segnali originari o inviare dati ai modelli. La scelta si azzera al reload. [Guida](docs/explicit-alias-preview.md), ADR 0040, issue #20.

**Tracce di continuità v0.11.6:** dal registro delle attestazioni valide, BookWriter segnala sequenze letterali da riesaminare in più capitoli (azioni dopo una menzione di morte, morti ripetute, date dichiarate non monotone). Mostra le prove affiancate, non deduce automaticamente contraddizioni e non modifica il canone né chi conosce segreti. [Guida](docs/attested-continuity-signals.md), ADR 0039, issue #20.

**Registro attestazioni v0.11.5:** navigazione a pagine delle menzioni consultive e registro locale delle conferme ancora correnti, raggruppate per nome in più capitoli per confronto manuale. Nessuna contraddizione dedotta automaticamente né modifica al canone. [Guida](docs/narrative-event-ledger.md), ADR 0038, issue #20.

**Decisioni autore v0.11.4 (PR #50):** l'indice consultivo permette di annotare con motivazione se una menzione descrive davvero un evento o va respinta, mantenendo lo storico senza promuoverlo automaticamente a canone. Riaperture e modifiche della scena invalidano la decisione corrente; autosync disabilitato dopo il salvataggio. [Guida](docs/narrative-event-decisions.md), ADR 0037 e issue #20.

**Recupero mirato cross-chapter v0.11.2 (PR #48):** il confronto dopo retcon e cambi alle fonti cerca passaggi rilevanti anche nei **capitoli intermedi** tramite entità, lessico e date dichiarate, non solo nell'origine e nel predecessore immediato. Le finestre letterali con offset puntano anche al centro di scene lunghe; motivi della selezione, candidati non scansionati e limiti restano espliciti. Non è retrieval semantico né certifica errori. [Guida](docs/targeted-continuity-retrieval.md), ADR 0035, issue #20.

**Dossier storici e continuità v0.11.1 (PR #47):** quando si aggiornano o quarantinano fonti in un capitolo già congelato, anche i capitoli successivi ricevono un obbligo esplicito di rivalidazione, con causa `historical_evidence`. Lo storico e il direttore ricevono campioni di prosa precedente, non prove esterne certificate; i lettori ciechi non vedono nuovi dati riservati. [Guida](docs/historical-continuity-rechecks.md), ADR 0034, issue #20/#23.

**Rivalidazione dei capitoli v0.11.0 (PR #46):** le modifiche retroattive marcano tutti i capitoli successivi già scritti e ne impongono la review **in ordine**. Gli specialisti di continuità, timeline, segreti e voce e il direttore confrontano campioni identificati della prosa precedente, con finestre letterali e limiti di copertura visibili. I lettori ciechi non ricevono segreti. La nuova review è tracciata nel capitolo, senza spacciarla per certezza semantica. [Guida](docs/cross-chapter-continuity.md), ADR 0033, issue #20.

**Prove narrative ancorate v0.10.9 (PR #45):** ogni nuovo rilievo dei dodici agenti deve citare un passaggio reale del **segmento letto** (12+ caratteri, senza parafrasi). BookWriter archivia posizione e contesto calcolati dal codice; il direttore continua a giudicare criticamente e non può approvare una correzione su prove legacy, stale o manomesse. I vecchi rapporti restano consultabili ma non certificati. [Guida](docs/editorial-narrative-evidence.md), ADR 0032, issue #20.

**Installazioni riproducibili v0.10.8 (PR #44):** il frontend include un `package-lock.json` realmente generato da npm; CI e GitHub Pages usano `npm ci` e rifiutano un manifest incoerente con il lock. Due installazioni pulite e test di integrità sono parte della release. Le dipendenze native, il registro e l'ambiente restano fattori esterni. [Guida](docs/npm-lockfile-releases.md), ADR 0031, issue #43.

**Ripristino build v0.10.7 (PR #42):** dopo un errore di installazione in GitHub Actions causato da una dipendenza nativa Tailwind non disponibile (`@tailwindcss/oxide@4.3.5`), i pacchetti Tailwind/Vite sono bloccati alla release disponibile `4.3.4`. Smoke test di allineamento e cleanup sicuro dei branch `fix/*` (ADR 0030). La correzione consente di pubblicare anche le nuove proposte locali introdotte dalla v0.10.6. Guida: `docs/release-dependency-recovery.md`.

**Proposte locali di ricerche storiche v0.10.6 (PR #41):** nella sezione Dossier storico BookWriter può generare una **bozza di temi pubblici** riconosciuti nelle scene (vocabolario limitato, eventuali anni vicini), senza interrogare modelli o servizi esterni. Ogni proposta va aggiunta alla bozza manualmente e ogni ricerca richiede comunque consenso sulla query esatta. Il filtro non prova che un tema/anno sia privo di segreti: controllalo sempre. [Guida](docs/historical-query-proposals.md), ADR 0029, issue #23.

**Dipendenze fra fonti v0.10.5 (PR #40):** l'autore può dichiarare nel dossier storico che due snapshot attivi riprendono lo stesso originale o che uno deriva dall'altro, con nota e storico delle rettifiche. Le future review impediscono di presentarli come due riscontri indipendenti, anche per dipendenza transitiva. L'origine resta una dichiarazione non autenticata; un legame assente non prova indipendenza. [Guida](docs/historical-source-dependencies.md), ADR 0028, issue #23.

**Contesto critico v0.10.4 (PR #39):** per ogni possibile divergenza documentale il revisore deve indicare evento, periodo, luogo, edizione e incertezze di ciascuna fonte, dichiarando esplicitamente i dettagli sconosciuti. Il direttore deve rivalutare indipendentemente queste dimensioni prima della decisione. L'app non certifica fatti, autenticità o licenze. [Guida](docs/historical-source-disagreements.md), ADR 0027, issue #23.

**Possibili divergenze storiche v0.10.3 (PR #38):** il revisore storico può evidenziare citazioni contrastanti tratte da due o tre fonti distinte, con posizione motivata per ciascuna. Il software verifica soltanto che gli estratti e gli ID siano reali e attivi; il direttore controlla criticamente il significato e può respingere falsi conflitti. Non avviene alcun nuovo fetch automatico o certificazione storica. [Guida](docs/historical-source-disagreements.md), ADR 0026, issue #23.

**Collazione visiva v0.10.1 (PR #36):** per ogni OCR LoC attivo, l'autore può aprire la scheda originale, dichiarare **pagina e breve trascrizione letta sulla scansione** e registrare un confronto locale con il testo OCR. Le differenze diventano un avviso per il revisore storico e il giudice. BookWriter non scarica né verifica immagini e non certifica diritti; [guida](docs/loc-scan-collation.md), ADR 0024, issue #23.

**Provenienza IIIF v0.10.2 (PR #37):** l'autore può associare a una collazione OCR/scansione una **risorsa immagine IIIF elencata esattamente dalla scheda LoC**, scegliendola e dichiarando pagina/diritti. BookWriter controlla solo ID e dimensioni `info.json`, senza scaricare le immagini né dimostrare corrispondenza dei pixel all'OCR. [Guida](docs/loc-iiif-page-provenance.md), ADR 0025, issue #23.

**Ancora da implementare:** OAuth Google/Microsoft, hardening transazionale del lease tra dispositivi, retrieval semantico completo del canone, verifica storica approfondita con fonti primarie/istituzionali, ZIP snapshot remoti, import Narrarium generico, parità Narrarium e ledger dei costi avanzato per sessione/dispositivi. Non affidare documenti importanti solo al browser senza backup.

## Obiettivi

- Interfaccia responsive React + TypeScript + shadcn/ui, con tema chiaro/scuro, pubblicata tramite GitHub Pages.
- Descrizione libera iniziale del libro, pianificazione long/mid/short term, generazione capitoli e scene/paragrafi.
- Autopilot osservabile, interrompibile e riprendibile, con log, riepiloghi e interventi dell'autore; revisioni propagabili ai contenuti dipendenti.
- Fasi di brainstorming, review di cinque tipologie di lettori, adversarial review, verifica della continuità e controllo delle rivelazioni.
- Memoria narrativa persistente per personaggi, luoghi, fazioni, oggetti, segreti, timeline, idee e stato della storia.
- Più endpoint OpenAI-compatible e selezione del modello per singola attività e per libro.
- IndexedDB come archivio di lavoro locale, sincronizzazione GitHub del canon e cloud bootstrap mediante Google o Microsoft; import/export ZIP; export EPUB/PDF/DOCX.
- Documentazione di architettura, ADR, test e regole per agenti AI.

## Repository di riferimento

- [Book.Jesus](https://github.com/KeyserDSoze/Book.Jesus): pattern di capitoli, scene/paragrafi, continuità, timeline e segreti.
- [GhostWriterFramework](https://github.com/KeyserDSoze/GhostWriterFramework): convenzioni e modelli Narrarium.
- [DeliveryManager](https://github.com/KeyserDSoze/DeliveryManager): organizzazione del repository, ADR, documentazione e qualità.

## Stato release

La distribuzione tramite GitHub Pages raggiunge [ghostwriting.ws](https://ghostwriting.ws). Ogni modifica entra su `main` dopo CI desktop/mobile verde sulla HEAD della PR; il deploy e la pulizia dei branch vengono verificati separatamente. Stato delle funzionalità e limiti correnti: `docs/CHANGELOG.md`, `AGENTS.md` e issue aperte.

## Qualità

La CI esegue controllo TypeScript, test Vitest sui backup, smoke test Node, build e test Playwright Chromium desktop/mobile per navigazione e import/export ZIP.

## Sicurezza e limiti

L'hosting su GitHub Pages è statico: il codice applicativo è pubblico e le chiavi API introdotte nel browser sono accessibili al codice che vi viene eseguito. Non utilizzare GitHub Actions secrets per distribuire chiavi private nel bundle. Non inserire chiavi, PAT o token nei commit, nel repository di un libro o nei log. L'accesso Google/Microsoft non è un'autorizzazione server-side a GitHub Pages. L'autopilot in un browser mobile può essere sospeso dal sistema operativo: ogni attività dovrà essere checkpointata e riprendibile.

Consulta `AGENTS.md`, `docs/`, `ADR/` e `features/` quando saranno presenti sul branch di sviluppo.
