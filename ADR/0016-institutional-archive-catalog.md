# ADR 0016 — Catalogo istituzionale Library of Congress: piste documentali, non prove

- **Stato:** Accettato per BookWriter v0.9.3 (PR #28, CI desktop/mobile verde)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0011, 0013, 0014 e 0015

## Contesto

I dossier Wikipedia v0.9.0 contengono estratti terziari realmente recuperati e le bibliografie Crossref v0.9.1 solo identificativi di pubblicazioni. Manca un modo per individuare documenti digitalizzati in archivi istituzionali, con una catena di provenienza leggibile e senza esporre segreti del romanzo. La Library of Congress pubblica la sua [API JSON/YAML](https://www.loc.gov/apis/json-and-yaml/) senza chiave e con limiti di traffico. L'API è un **catalogo descrittivo**: un titolo o una data di catalogazione NON certifica il contenuto di un manoscritto, fotografia o mappa.

## Decisioni

1. **Consenso prima della rete.** Nel pannello «Archivi istituzionali» l'autore digita **1–3 query pubbliche**, 5–110 caratteri, deduplicate e validate. La finestra di conferma mostra esattamente cosa sarà inviato a `www.loc.gov`. Nessun prompt AI, segreto, timeline privata, passaggio di romanzo, credenziale, token o DOI genera automaticamente ricerche.
2. **Adapter browser read-only LoC.** Solo `GET https://www.loc.gov/search/?fo=json&q=...&c=3&sp=1`; origine fissa HTTPS, richieste seriali max 3, `credentials:omit`, `redirect:error`, `referrerPolicy:no-referrer`, niente Authorization o cookie, timeout 12 s, risposta massima 240 KB e nessun retry automatico. Trattare JSON esterno come non attendibile; ammettere soltanto ID `/item/<id>/` dell'host esatto `www.loc.gov`, ricostruendo URL canoniche e rifiutando host/URL falsi. API soggetta a rate limit e possibili errori CORS/browser.
3. **Solo schede, mai testo integrale o citazioni.** Conservare identificativo, link istituzionale, titolo, data/descrizione opzionali **come metadati**, query e timestamp. Non inviare ulteriori richieste a pagine, OCR, PDF, immagini, licenze o siti arbitrari. Non asserire che un documento sia primario, libero da copyright o letto dal software.
4. **Separazione epistemica.** `ChapterHistoricalDossier.archiveCatalog` è indipendente da `sources` Wikipedia e `bibliography` Crossref. Gli ID `loc:...` **non sono ammessi** in `HistoricalClaim.sourceIds`: per `consistent_with_excerpt` o `contradicts_excerpt` servono soltanto estratti Wikipedia realmente acquisiti con una citazione per fonte. Catalogo LoC e bibliografia DOI sono piste per approfondire una verifica manuale, non supporto storico.
5. **Minimo privilegio di contesto.** Solo lo specialista `historical` e il direttore ricevono le schede; non i cinque lettori ciechi, né gli altri sei specialisti. I record non attendibili non diventano istruzioni eseguibili o remissioni da applicare al canone.
6. **Snapshot e ciclo editoriale.** Ogni ricerca persiste versioni append-only fino a 80 voci, con ID che includono timestamp e identificativo LoC; cambia solo la lista degli ID attivi. Wikipedia e Crossref preservano il catalogo quando aggiornano i rispettivi dossier e viceversa. Backup ZIP e sincronizzazione GitHub del progetto includono i metadati già presenti nel canon JSON, senza credenziali. Su capitoli congelati, recupero sinossi precedente prima delle modifiche, invalidazione downstream, review obbligatoria, autosync off, outbox cancellata, Web Locks e revisione `updatedAt` ricontrollata **dopo** la rete.
7. **Fail-closed.** HTTP 429, timeout, CORS, JSON malformato, payload troppo grande, lock non ottenuto, cambio di revisione e rewind legacy impossibile non salvano dossier parziali. Un risultato vuoto non dimostra inesistenza di un oggetto storico.

## Limiti e verifiche

Le schede LoC possono essere multilingua, incomplete, contenere date di pubblicazione diverse dalla data dell'evento storico e descrizioni imprecise. I metadati sono da verificare sul documento originale e con altre fonti. La API potrebbe non fornire CORS al sito statico: senza un backend non aggiriamo la policy né promettiamo funzionamento offline; errori leggibili rimangono nell'interfaccia. Test con mock della rete **non** dimostrano disponibilità CORS reale.

La futura fase dell'issue #23 può supportare consultazione legale dei testi originali, date/versioni di acquisizione, confronto di citazioni documentali reali e diritti, senza equiparare catalogo a fonte primaria consultata.

## Criteri di accettazione

- Conferma esplicita delle query esatte con avviso privacy.
- Nessuna richiesta a host alternativi, URL costruiti dall'utente, redirect o credenziali.
- Snapshot con titolo, data/descrizione e URL canonica; persistiti con altri dossier e backup, nessun full text.
- Solo storico/giudice ricevono il catalogo, senza `historical.sourceIds` accettati come prova.
- Riapertura conservativa, stop dei conflitti, fail-closed e import legacy senza catalogo.
- TypeScript, Vitest, smoke, build e Playwright desktop/mobile **sulla HEAD** prima del merge.
