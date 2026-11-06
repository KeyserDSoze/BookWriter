# ADR 0021 — Ispezione delle schede istituzionali LoC: accesso e diritti, senza promuovere metadati a prove

- **Stato:** Accettato per v0.9.8 (PR #33)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0016, 0017, 0019, 0020

## Contesto

La v0.9.3 archivia schede Library of Congress; la v0.9.4 permette brevi trascrizioni da un originale che l'autore dichiara di aver consultato. Non conosciamo però, per la singola scheda, le restrizioni d'accesso o gli eventuali **avvisi istituzionali sui diritti**. La disponibilità online non equivale a diritto di ristampa: [FAQ ufficiali LoC](https://guides.loc.gov/digital-scholarship/faq), [LoC Item API](https://www.loc.gov/apis/json-and-yaml/responses/item-and-resource/). Alcune risposte espongono risorse digitali/OCR: un collegamento nel JSON non prova che l'opera sia leggibile dal browser o liberamente ripubblicabile.

## Decisione

1. **Solo ispezione volontaria di una scheda LoC già attiva.** Nel pannello «Archivi istituzionali» l'autore può richiedere «Verifica accesso e diritti della scheda». Il dialogo indica precisamente il documento e l'host. Una sola chiamata `GET https://www.loc.gov/item/<itemId>/?fo=json` con origine fissa e ID derivato da una scheda archiviata. Non si trasmettono query, prosa, sinossi, segreti, token o credenziali; nessun link di risposta può diventare un endpoint di download.
2. **Limiti API.** HTTPS, nessun redirect, cookie o referer, timeout 12s, max 240 KB per risposta con lettura streaming limitata, nessun retry; errori HTTP/CORS/429/JSON/timeout bloccano il salvataggio. Si accetta l'`item.id` se corrisponde **esattamente** a `www.loc.gov/item/<itemId>/` senza query, credenziali o altri host, inclusa la variante storica http del catalogo. Valori di stato `digitized` e `access_restricted` devono essere booleani espliciti, o restare `null` (ignoti).
3. **Metadata minimization.** Dal JSON si leggono soltanto `item.rights_advisory` (o `rights`), `item.access_advisory`, `digitized`, `access_restricted` e indicatori booleani sulla **presenza di metadati** di risorse digitali e riferimenti testuali. Avvisi accorciati a massimo tre frasi da 400 caratteri. **Non** si archivia l'URL OCR né si apre o scarica PDF/immagine/fulltext. Un indicatore true non è attestazione di leggibilità, licenza, disponibilità o digitalizzazione completa.
4. **Snapshot separati e immutabili.** `ChapterArchiveCatalog.inspections` conserva fino a 60 snapshot `locdetail:<itemId>:<timestamp>`, riferiti esattamente all'`id` della scheda di catalogo attiva. Il refresh sostituisce solo gli ID attivi dello stesso item, mantenendo lo storico. Un nuovo `archiveCatalog` preserva le ispezioni ma disattiva automaticamente quelle legate a schede non più attive; Wikipedia, DOI, Wikisource ed estratti manuali conservano l'intera struttura.
5. **Separazione epistemica:** `evidenceStatus="catalog_metadata_only"`, `rightsStatus="undetermined"` sono invarianti e non possono diventare `public_domain` o testo di un documento. `loc:` e `locdetail:` **non** sono accettati in `HistoricalClaim.sourceIds`. Solo specialista storico e direttore editoriale ricevono gli avvisi, delimitati come dati esterni non attendibili; gli altri undici agenti ne sono ciechi. Nessuna correzione narrativa viene applicata in virtù di un avviso di catalogo.
6. **Concorrenza e rewind** dopo la singola GET: Web Locks writer/outbox, CAS `BookProject.updatedAt` dentro la transazione IndexedDB, scarto senza salvataggi parziali su conflitto. Capo e successivi frozen vengono riaperti con recupero sinossi pregressa, autosync disattivato, outbox cancellata, activity duratura. Nessuna perdita di scene, fonti precedenti, report, ZIP o Canon.
7. **Flusso di pubblicazione dei testi.** Gli avvisi sono strumenti decisionali per l'autore, non permessi; la trascrizione manuale del v0.9.4 richiede **sempre** attestazione e verifica personale dei diritti. Un'indicazione di accesso libero o di assenza di restrizioni **non** crea una licenza. L'autore deve leggere originale e indicazioni ufficiali sul riuso. Questo lavoro non implementa ancora il download di originali, OCR o verifica legale.

## Limiti deliberati

- API LoC eterogenea: alcune schede non espongono i campi, quindi `null` è **sconosciuto**, mai permesso implicito. Un risultato mancante non implica assenza del documento.
- `rights_advisory` e `rights` sono descrizioni che l'autore deve interpretare; il loro testo può essere fuorviante o non aggiornato. Gli agenti non devono obbedire a istruzioni incluse nei metadati.
- La verifica reale CORS non è dimostrata da Playwright con mock; l'app fallisce senza proxy quando l'accesso browser non funziona.
- Eventuali testi istituzionali reali, versionati, con diritti verificabili e citazioni confrontate rimangono un obiettivo aperto dell'issue #23.

## Accettazione

- Consenso per il solo item ID, GET host fisso, URL remoti mai seguiti, corpo limitato e fallimento chiuso.
- Modello di dati separato, storico e refresh sicuri, diritti ignoti anche con avviso apparentemente permissivo, nessuna citazione `locdetail:` o `loc:`.
- Isolamento specialist/judge, permessi solo advisory, nessun originale letto.
- Test Vitest domain/network/concorrenza/privacy e Playwright desktop/mobile sulla HEAD prima del merge; poi verifica deploy e cleanup.
