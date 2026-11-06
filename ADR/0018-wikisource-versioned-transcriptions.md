# ADR 0018 — Wikisource: estratti di trascrizioni pubbliche con revisione, non originali autenticati

- **Stato:** Accettato per v0.9.5, PR #30
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0013–0017

## Problema

I dossier Wikipedia contengono estratti terziari; le schede LoC non contengono testi; gli estratti LoC v0.9.4 sono trascritti dall'autore e non acquisiti dall'app. Manca un primo percorso **di acquisizione reale del testo** pubblico con identificativo di versione e controllo puntuale di citazioni, senza backend, scraping arbitrario, token o esposizione del manoscritto.

Wikisource è una biblioteca di **trascrizioni collaborative**, non un ente archivistico che autentica la fonte originale. I diritti su testo originale, edizione e materiale editoriale variano: un risultato Wikisource non garantisce pubblico dominio o riutilizzo commerciale. Le condizioni di citazione e attribuzione devono essere controllate dall'autore; il testo recuperato **non viene automaticamente inserito nel romanzo**.

## Decisione

1. **Ricerca esclusivamente volontaria:** l'autore digita 1–3 query pubbliche di 5–110 caratteri; conferma il set esatto e l'host `it.wikisource.org` in un dialogo che avverte su segreti, diritti e approvazione del capitolo. Non generiamo automaticamente query da scene, canone o memoria e non inviamo descrizioni del libro, API key o PAT.
2. **Adapter statico senza autenticazione:** solo MediaWiki Action API, `GET https://it.wikisource.org/w/api.php` con `generator=search`, namespace 0, massimo **due pagine per query**, `prop=extracts|revisions`, `explaintext=1`, `exchars=1000`, `rvprop=ids|timestamp`, `origin=*`. Timeout 12s, body <=150 KB, `credentials:omit`, `redirect:error`, `referrerPolicy:no-referrer`, `cache:no-store`, nessun header con credenziali. Fallimento CORS/429/API/JSON invalida **l'intero** batch, non si salva un risultato parziale.
3. **Origine e snapshot non falsificabili dall'API:** non utilizziamo link restituiti dal server per comporre l'URL; creiamo il percorso canonico a partire dal titolo e dal dominio esatto. Richiediamo `pageid`, `ns=0`, `revid`, `revision.timestamp`, titolo ed estratto testuale. Il nuovo `ChapterHistoricalDossier.wikisource` conserva ID `itws:<pageId>:<revid>`, pagina, titolo, URL, data revisione, query, data della consultazione, frammento di <=1200 caratteri e due stati costanti: `community_transcription_unverified` e `work_rights_not_verified`. Conserva 70 snapshot fino ad aggiornamento esplicito, fino a 6 attivi.
4. **Integrità delle citazioni:** `HistoricalClaim.sourceIds` può usare una revisione `itws:...` **solo se attiva** e ciascuna `sourceEvidence[{sourceId,quote}]` contiene una frase letterale presente **nell'estratto restituito per quella revisione**; una citazione legacy `sourceQuote` non è ammessa per Wikisource. Due revisioni della medesima pagina non contano come due fonti indipendenti, e una vecchia revisione non resta attiva dopo un refresh. Un `loc:...` di catalogo o `crossref:...` restano non documentali. Gli snapshot precedenti rimangono visibili per audit.
5. **Gate editoriale inalterato:** solo il revisore storico e il giudice ricevono i testi Wikisource; gli altri 11 ruoli restano ciechi. Il giudice riceve `quoteMatches`, `revisionId`, `revisionAt`, `evidenceStatus` e `rightsStatus`; una corrispondenza letterale non prova verità storica, attribuzione, data reale dell'opera, indipendenza, autenticità dell'originale o licenza. Il giudice può rigettare ogni remediation.
6. **Persistenza local-first e transazione conservativa:** lookup fuori dai Web Locks, poi lock `bookwriter:writer:<bookId>` e `bookwriter:github-outbox`, controllo `updatedAt` dentro IndexedDB, rewind sicuro della sinossi precedente e invalidazione downstream di capitoli frozen; autosync off, outbox cancellata, activity e libro salvati atomicamente. Nessun retry invisibile, nessuna sovrascrittura silenziosa. Crossref, Wikipedia, LoC e le trascrizioni manuali preservano i dati Wikisource e viceversa.
7. **Nessuna attestazione della licenza:** i metadati API non bastano per determinare il pubblico dominio, e l'attribuzione dei contributi Wikisource deve essere valutata insieme alla licenza dell'opera originale. UI mostra link **alla revisione esatta**, stato dei diritti non verificato e avviso di verifica prima di pubblicare. Nessun OCR o full text, nessun testo copiato automaticamente nel libro.

## Limiti e rischi accettati

- Il servizio MediaWiki `TextExtracts` è un'estensione opzionale; se non è disponibile sulla specifica installazione, l'app non inventa estratti. CORS reale, rate limit e compatibilità browser non sono dimostrati dai mock Playwright.
- MediaWiki può produrre un estratto della pagina corrente e un ID revisione nella stessa richiesta senza una prova crittografica di coincidenza atomica. Conserviamo uno snapshot dei dati ricevuti e non affermiamo verifica indipendente della revisione remota. L'autore deve aprire la cronologia e confrontare la trascrizione con la revisione e l'edizione originale.
- Il sito contiene anche opere con storia editoriale moderna; non garantiamo stato copyright, autenticazione o affidabilità storica. Per verifiche istituzionali indipendenti restano necessari altri archivi e una catena di provenienza robusta.
- Non generiamo parole chiave automaticamente dal romanzo; un suggeritore con consenso prima di qualunque trasmissione è un lavoro separato nell'issue #23.

## Criteri di accettazione

- Nessun invio di romanzo/segreti/credenziali alle API, conferma visibile e limiti seriali/fail-closed.
- Validazione revisionata, URL ricostruita da host fisso, versioni immutabili, audit e backup senza perdite.
- `sourceEvidence` confrontata per ogni fonte, diniego di vecchie revisioni e metadati trattati come prove.
- Prompt unicamente al revisore storico e al giudice, avvertenze esplicite di non autenticità e diritti.
- Conservazione reciproca di tutti i dossier, rewind frozen con CAS/Web Locks e no autosync.
- Typecheck, Vitest, smoke, build, E2E desktop/mobile **sulla HEAD**, merge e deploy Pages verificati.
