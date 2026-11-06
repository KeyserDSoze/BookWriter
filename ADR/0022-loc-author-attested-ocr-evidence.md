# ADR 0022 — LoC OCR: breve estratto da file testuale istituzionale con diritti attestati dall'autore

- **Stato:** Accettato per v0.9.9 (PR #34)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0016–0017, 0019–0021

## Contesto

Le versioni precedenti distinguono schede LoC, ispezioni di accesso/diritti, trascrizioni manuali `locex:` e wikitesti Wikisource versionati. Ma non leggono **nessun testo** direttamente da risorse LoC. La [LoC Item API](https://www.loc.gov/apis/json-and-yaml/responses/item-and-resource/) documenta in alcuni oggetti `resources[].fulltext_file`, `fulltext_derivative` e `djvu_text_file`, che non sono uniformi: alcuni puntano a OCR, altri a formati non accessibili dal browser. I dati sono eterogenei e la disponibilità sul sito **non concede diritto di riutilizzo** ([LoC Understanding Copyright](https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/)).

## Decisione

1. **Triplo gate volontario:** l'autore deve avere un record di ricerca `loc:` attivo e la sua ispezione `locdetail:` attiva, `hasTextResourceLink=true`, senza `accessRestricted=true`. Sceglie `public_domain` o `permission` come **base che dichiara personalmente di aver verificato**, scrive motivazione di 16–280 caratteri e spunta l'attestazione esplicita. Un dialogo finale mostra record, ID pubblico, base diritti, motivazione, le destinazioni di conservazione/AI/GitHub, l'inaffidabilità di OCR e l'invalidazione dei capitoli frozen. Senza consenso non parte alcuna richiesta.
2. **Due sole GET e URL allowlist.** Prima `GET https://www.loc.gov/item/<itemId>/?fo=json`, identità obbligatoriamente coincidente con l'ID canonico del catalogo; blocco immediato se `access_restricted=true`. Poi al massimo **una** `GET` verso un URL `https://tile.loc.gov/storage-services/{service|master}/... .txt` presente **in `resources[].fulltext_file|fulltext_derivative|djvu_text_file`** del dettaglio LoC. Vietati redirect, credenziali, referer, cookie, immagini, HTML, PDF, link arbitrari, host alternativi e URL con parametri. Non vengono trasmessi manoscritto, canone, ricerca, segreti, diritti dichiarati o token.
3. **Limiti fail-closed:** timeout 12s per richiesta, streaming con 240 KB max per il JSON e 160 KB max per il file testuale UTF-8, lettura limitata, nessun retry nascosto. Risposta senza URL `.txt` ammissibile, 429/CORS/errore di rete, redirect, JSON malformato, origine sbagliata, file troppo grande o non testuale bloccano l'intera operazione senza mutare il libro. La risorsa potrebbe essere una trascrizione derivata/OCR incompleta.
4. **Citazione letterale e fingerprint:** l'app seleziona una **singola riga di prosa letteralmente presente** nel testo restituito, max 900 caratteri, senza ricostruzioni, parafrasi o correzioni OCR. Calcola SHA-256 del contenuto UTF-8 ricevuto, salva la lunghezza e l'offset UTF-16 e il riferimento `textUrl` LoC. L'ID immutabile `lococr:<itemId>:<timestamp>:<sha256-16>` collega quel frammento a una lettura specifica, senza dimostrare il contenuto storico dell'originale. `evidenceStatus=institutional_ocr_unverified`, `rightsStatus=author_attested_unverified` **mai** «autenticato» o «licenza verificata».
5. **Dossier e audit separati:** `ChapterHistoricalDossier.locOcr` archivia massimo 40 record e fino a quattro fonti attive. Una nuova acquisizione dello stesso item sostituisce solo l'ID attivo, mantiene quelli storici. Nuove review possono citare `lococr:` con `sourceEvidence[{sourceId,quote}]` **per la specifica frase**, non con `sourceQuote` legacy. Non contare `lococr:`, `locex:` o due OCR dello stesso item LoC come fonti indipendenti. Se la scheda/ ispezione di origine non è più attiva, anche l'OCR esistente smette di essere citabile nelle nuove review ma rimane nell'audit. Wikipedia, Wikisource, DOI, LoC catalogo/manuale preservano il nuovo dossier in ogni refresh.
6. **Privacy fra agenti:** solo lo specialista storico e il direttore editoriale ricevono gli estratti, hash, provenienza e diritti dichiarati, delimitati come **dati esterni non attendibili**. Gli altri undici agenti non vedono gli estratti. Il giudice può respingere una remediation anche quando la frase coincide col file: errori OCR, attribuzione, data dell'opera, indipendenza, contesto e diritti vanno valutati. Nessun frammento entra automaticamente nella prosa.
7. **Transazione dopo la rete:** Web Locks writer/outbox, CAS su `updatedAt` in IndexedDB, rewind conservativo del freeze, sinossi precedente, invalidazione downstream, activity, autosync off e outbox delete nello stesso commit. Nessun testo va in PAT/credenziali; ZIP e GitHub contengono un **breve** estratto solo quando l'autore decide di esportarlo/sincronizzarlo.

## Limiti e rischi espliciti

- Una fonte LoC ospita anche trascrizioni moderne e OCR con errori. La frase **proviene dal file restituito** dalla Library, non certifica fedeltà all'originale, la data storica, l'identità dell'autore o la verità di una proposizione. Il digest dei backup importati potrebbe essere falsificato e non è una firma istituzionale; il confronto non viene riverificato automaticamente.
- La disponibilità LoC è disomogenea: la maggior parte delle schede non ha `fulltext_file` sotto l'host/prefisso/limite scelti. Il sistema **non aggira CORS** né scarica da domini/percorsi alternativi. I mock di Vitest e Playwright non provano connettività reale da GitHub Pages.
- La base giuridica `public_domain` / `permission` è solo **attestata dall'autore**, senza validazione della licenza; i diritti e la riserva di utilizzo commerciale dipendono dalla singola opera e giurisdizione. Una pagina LoC visualizzabile non è un permesso. Gli estratti brevi riducono quantità ma non risolvono automaticamente il diritto d'autore.
- Non c'è elaborazione PDF/OCR in browser, verifica crittografica dell'archivio, confronto immagine-originale, selezione manuale di pagina o parsing ricco. L'issue #23 resta aperta.

## Accettazione

- Consenso forte e revocabile prima della rete; due soli host fissi con percorso `.txt` allowlist, streaming bound e no credenziali/redirect.
- Evidenza letterale con SHA-256/offset del testo effettivamente recuperato, versioni immutabili, diritti non certificati, disattivazione su schede/ ispezioni obsolete.
- Fonte citabile solo come OCR non autenticato, giudice critico e 11 ruoli ciechi, nessuna correzione automatica.
- Test di host spoof, URL/OCR/PDF, CORS, HTTP 429, CAS, freeze, preservazione dossier, quote per fonte e Playwright desktop/mobile. CI verde sulla HEAD prima del merge, deploy Pages e cleanup verificati.
