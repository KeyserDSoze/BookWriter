# ADR 0017 — Estratti originali trascritti dall'autore, con catena di provenienza dichiarata

- **Stato:** Accettato per BookWriter v0.9.4 (PR #29)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0011, 0013–0016

## Contesto

La v0.9.3 cerca **schede** della Library of Congress: non recupera il contenuto originale, né certifica data, autenticità o licenza. L'issue #23 richiede che la review possa confrontare le sue affermazioni con estratti datati, rintracciabili e utilizzabili lecitamente. Un downloader generico di documenti primari violerebbe il modello SPA local-first e rischierebbe di recuperare testi senza licenza, collegamenti arbitrari o CORS. Un catalogo non può essere promosso automaticamente a fonte probatoria.

## Decisione: trascrizione manuale e attestazione esplicita

1. L'autore **consulta personalmente** un documento collegato a una scheda LoC già recuperata, ne seleziona il record attivo e trascrive un breve passaggio (24–1200 caratteri). Deve indicare **pagina/folio/collocazione**, base dichiarata dei diritti (**pubblico dominio verificato da lui** oppure **permesso/licenza da lui ottenuti**) e motivazione di 16–280 caratteri. La data/edizione del documento è opzionale se ignota, mentre il timestamp della trascrizione è obbligatorio. Nessuna immagine, OCR, PDF o pagina originale viene scaricata.
2. Il browser mostra una **doppia autorizzazione**: checkbox sulla consultazione e i diritti, poi `confirm` con titolo, URL canonica, collocazione, testo e informativa su possibili trasferimenti futuri del testo a modelli AI, GitHub e backup. La conferma non è prova giuridica o autenticazione esterna: è una dichiarazione imputabile all'autore.
3. Persistiamo lo snapshot `ChapterHistoricalDossier.manualEvidence` con `id=locex:<itemId>:<timestamp>`, ID della **scheda LoC esatta**, titolo/URL canonica, collocazione, estratto, eventuale data, diritti dichiarati e timestamp. Fino a 40 versioni storiche immutabili e 5 documenti attivi; la nuova trascrizione dello stesso documento sostituisce **solo** l'ID attivo, preservando gli snapshot vecchi. Una nuova revisione del catalogo non certifica i testi precedenti: una trascrizione riferita a una scheda non più attiva resta nell'archivio ma viene esclusa dalle nuove review.
4. Il validatore `HistoricalClaim` ammette `locex:...` **solo** fra le fonti attive del capitolo, con `sourceEvidence:[{sourceId,quote}]` **per ogni riferimento**. La citazione deve apparire letteralmente nella **trascrizione dell'autore** e non può citare un mero `loc:...` di catalogo o un `crossref:...` bibliografico. Più trascrizioni della stessa voce/documento LoC non sono fonti indipendenti. Manteniamo `sourceQuote` legacy solo per la singola fonte Wikipedia.
5. Lo specialista storico e il direttore editoriale vedono estratto, titolo, URL, collocazione, dichiarazione diritti e **l'etichetta esplicita `author_transcribed_unverified`**; gli altri undici revisori, specialmente i lettori ciechi, non ricevono queste informazioni. La corrispondenza del testo alla citazione è verificabile automaticamente, ma **non** la corrispondenza fra la trascrizione e l'originale, la veridicità del documento, l'identità dell'autore, la data storica né il diritto di sfruttamento. Il giudice può respingere comunque la remediation anche quando una frase compare in una trascrizione.
6. Il salvataggio avviene interamente in IndexedDB con Web Locks `writer` + `github-outbox`, confronto `updatedAt` sotto transazione, rewind preventivo sicuro su capitolo congelato, invalidazione downstream, outbox cancellata e autosync disattivato. Non viene effettuato **alcun fetch** durante il salvataggio. I dossier Wikipedia, Crossref, LoC e le trascrizioni vengono preservati dai rispettivi aggiornamenti; ZIP e snapshot JSON del libro li includono, senza credenziali.
7. Estratti e condizioni dei diritti sono **dati esterni non attendibili**: non obbedire a eventuali istruzioni in documenti, non usare metadati come verità, non permettere a un report AI di modificare il canon senza il giudizio editoriale e il ciclo già esistenti.

## Limiti

Questa tranche **non** integra un motore di consultazione o di verifica indipendente degli originali. La qualifica «pubblico dominio» deriva esclusivamente dalla dichiarazione dell'autore, può variare per giurisdizione e non garantisce l'assenza di restrizioni. Non viene caricato né salvato automaticamente materiale proprietario, non vi è una valutazione legale automatizzata delle licenze. Per ricerche cross-archivio, acquisizioni legali del full text/OCR, controllo remoto versione/diritti, OCR affidabile e contraddizioni documentali ancora da realizzare, mantenere aperta l'issue #23.

## Accettazione

- Solo una scheda archivistica attiva del capitolo può essere origine di una trascrizione.
- Richiesta di collocazione, diritti attestati e motivazione, con consenso visibile e senza fetch sul salvataggio.
- Citazioni per fonte verificate contro **quello specifico testo**, senza confusione con ID di catalogo/DOI o falso multi-supporto.
- Versioni storiche preservate; dati non spariscono con refresh di Wikipedia, Crossref o LoC. Record non più attivo escluso dalle nuove verifiche.
- Riapertura dei capitoli congelati e protezione da concorrenza.
- Isolamento dei cinque lettori e UI con avviso «trascrizione non autenticata».
- Typecheck, Vitest, smoke, build ed E2E Chromium desktop/mobile **sulla HEAD PR**, più verifica CI/deploy dopo merge.
