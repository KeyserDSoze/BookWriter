# Changelog — BookWriter

Ogni rilascio su `main` deve avere una voce verificabile. Le PR descrivono il comportamento rilasciato; le issue raccolgono lavoro incompleto e criteri di accettazione.

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
