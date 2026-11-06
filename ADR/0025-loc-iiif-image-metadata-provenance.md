# ADR 0025 — Provenienza tecnica della pagina IIIF LoC senza scaricare scansioni

- **Stato:** Proposto per v0.10.2, CI in verifica
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0022–0024
- **Fonti:** [LoC Item and Resource Responses](https://www.loc.gov/apis/json-and-yaml/responses/item-and-resource/), [LoC Image Services IIIF](https://www.loc.gov/apis/micro-services/image-services/)

## Problema

La collazione v0.10.1 confronta due testi ma collega solo la scheda generale LoC, potenzialmente composta da molte pagine. L'API LoC espone talvolta un `resources[].info` o `files[][][].info` relativo a un servizio immagini IIIF; altre collezioni hanno strutture differenti, soli thumbnail, restrizioni di download o nessun servizio. L'ID di un servizio immagini e le sue dimensioni non dimostrano che i pixel siano quelli della pagina OCR.

## Decisione

1. **Solo dopo una collazione `locscan:` attiva**, l'autore può cercare riferimenti IIIF della stessa scheda, su suo consenso. La ricerca invia unicamente l'item ID pubblico in `GET https://www.loc.gov/item/<id>/?fo=json` e visualizza fino a 30 candidate `resources[].info` e `resources[].files[*].info`, con indici di risorsa/file. Non raccoglie link da `item.image_url`, thumbnail, poster, immagini di anteprima o file arbitrari, che potrebbero non corrispondere alla scansione.
2. **Allowlist stretta**: solo `https://tile.loc.gov/image-services/iiif/{service|master}:<identifier>/info.json` senza userinfo, porta, query, fragment, percent encoding o traversals. L'item restituito deve avere esattamente il `id` del catalogo canonico e non riportare restrizioni `access_restricted`, `download_restricted`, `rights_restricted` true o malformate. Le risorse singole con restrizioni non sono candidate. Assenza di `info` non implica assenza dell'immagine.
3. L'autore **seleziona una risorsa candidata**, confronta personalmente l'identità pagina presso LoC e conferma **separatamente** (a) pagina corretta e (b) base diritti per conservarne/inviarne i soli metadati. Un **secondo dialogo** elenca pagina, item, URL `info.json`, destinatari AI/ZIP/GitHub e limiti. Non viene scaricata alcuna immagine. Per evitare risorse stale, la fase di salvataggio rilegge il JSON item e controlla che proprio la risorsa e i suoi indici siano tuttora ammissibili. Solo allora legge un singolo `info.json` dal dominio fisso.
4. Metadati IIIF letti: identità del servizio `@id|id` rigorosamente uguale all'URL base e dimensioni intere `width,height` nel range 1–200.000. Il fingerprint SHA-256 descrive solo una **rappresentazione canonica dei metadati tecnici selezionati** (servizio, dimensioni, indici), NON l'immagine o il contenuto storico. Fino a 240 KB nel primo JSON e 96 KB in `info.json`, streaming limitato, timeout 12s per GET, `credentials:omit`, `redirect:error`, `referrerPolicy:no-referrer`, niente cookie/proxy/retry/chiavi. CORS/429/JSON/identity/restrizioni falliscono chiuso, senza salvataggio parziale.
5. Snapshot immutabile `lociiif:<itemId>:<timestamp>:<hash16>` sotto `locOcr.iiif`, massimo 40 storici e un riferimento attivo per collazione. Si lega a `lococr:` esatto, `locscan:` esatto, `catalogItemId`, `inspectionId` e `pageLocator`, oltre a `itemUrl,infoUrl,width,height`. Una sostituzione dell'OCR, della collazione o della scheda/ispezione disattiva il vecchio collegamento preservando l'audit e tutti gli altri dossier/backup.
6. **Nessuna autenticazione visiva**: `evidenceStatus=institutional_iiif_metadata_unverified` e `rightsStatus=author_attested_unverified` rimangono invarianti. `lociiif:` NON entra in `historical.sourceIds`, non dimostra che il file OCR sia generato da quella pagina, che l'autore abbia visto una scansione, la data storica o una licenza. Solo specialista storico e direttore/giudice ricevono questi metadati come dati esterni non attendibili; gli altri undici agenti non li vedono.
7. Persistenza solo dopo rete sotto Web Locks writer/outbox e CAS `updatedAt` nella stessa transazione IndexedDB. Se il capitolo era frozen: recupero sinossi, invalidazione freeze del capitolo e successivi e review nuova. Prosa e report storici conservati; autosync off/outbox delete e activity atomici. Snapshot incluso in backup e potenzialmente GitHub solo con consenso.

## Limiti deliberati

- IIIF metadata availability e forma dei record sono variabili per collezione. Il codice non percorre pagine `/resource/` arbitrarie, non genera immagini o URL pixels, non usa thumbnail e non deduce corrispondenza pagina-OCR da ordine delle risorse. L'autore deve verificare l'identità personalmente.
- Nessun controllo pixel, OCR immagine, firma archivistica, licenza automatica o diritto di ripubblicazione. Gli hash dei metadati JSON sono ricalcolabili da chiunque e non sono firme LoC.
- I test Playwright usano mock: CORS e disponibilità reale `info.json` restano da validare in browser su un item concreto.
- Non esiste prova che un `info.json` sia della stessa pagina dell'OCR; tale relazione è **attestata dall'autore** ed esplicitamente non verificata dal software.

## Accettazione

- Consenso prima di ogni ricerca e associazione; GET solo `www.loc.gov/item/<id>/?fo=json` e un `tile.loc.gov/.../info.json` scelto, URL rigorosi, restrizioni e identità controllate.
- Nessuna richiesta di immagini/pixel e nessun manoscritto/credenziale inviato.
- Snapshot append-only, disattivazione su fonte obsoleta, CAS/freezes e storico preservati.
- Test Vitest sicurezza/dominio/transazioni e Playwright desktop/mobile, CI verde sulla HEAD definitiva, merge e Pages verificati.
