# BookWriter

**BookWriter** è un progetto per la scrittura autonoma e supervisionabile di libri con modelli di intelligenza artificiale configurabili.

> Stato: **prima applicazione local-first e in evoluzione**. Le funzionalità descritte sono obiettivi di prodotto, non ancora un'applicazione pronta per la produzione.

## Funzionalità disponibili

- SPA mobile e desktop, tema chiaro/scuro.
- Creazione di libri, orchestra AI multi-modello con osservabilità dei passaggi e possibilità di pause/revisioni.
- Persistenza IndexedDB e chiavi API cifrate con Web Crypto.
- Import/export ZIP content-only o completo (password AES-GCM opzionale, chiaro solo dopo avviso).
- Generazione EPUB, DOCX e PDF dalla prosa canonica.
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
