# BookWriter v0.10.2 — riferimento IIIF alla risorsa immagine LoC

Dopo aver acquisito un breve OCR e dichiarato la collazione visiva della scansione, puoi associare **un'identità tecnica di risorsa immagine IIIF** della Library of Congress. BookWriter non scarica l'immagine e non legge i pixel: il collegamento serve a rendere più precisa la documentazione della pagina che **tu** dichiari di aver osservato.

## Uso

1. Completa il percorso **Archivi istituzionali → Estratti OCR istituzionali → Confronta OCR con scansione** (v0.10.1), specificando pagina/folio e frase trascritta personalmente. Senza collazione attiva non puoi associare una risorsa.
2. Apri **Riferimenti IIIF scansioni**, scegli la collazione e conferma **Cerca risorse IIIF della scheda**. Il browser invia **solo** l'ID pubblico a `https://www.loc.gov/item/<id>/?fo=json`; ricerca i riferimenti `info.json` delle risorse immagine pubblicate nello stesso record.
3. Seleziona una candidata, apri la scheda LoC e i metadati IIIF per controllare personalmente che la risorsa rappresenti proprio la pagina/folio osservata. Una singola scheda può contenere molte immagini; gli indici di risorsa **non dimostrano** una corrispondenza con l'OCR.
4. Conferma separatamente che hai individuato la pagina corretta e che puoi conservarne i metadati/condividerli con i modelli AI, ZIP e GitHub. Il dialogo finale riporta il riferimento esatto e avverte che il software non ha visto alcuna scansione.
5. Dopo conferma BookWriter rilegge il JSON dell'item, rifiuta una risorsa ritirata/ristretta e legge **un solo** `https://tile.loc.gov/image-services/iiif/.../info.json`. Verifica l'ID del servizio e le dimensioni `width,height`; crea un impronta SHA-256 dei **soli metadati canonici**.
6. Vedi nella schermata l'ID `lociiif:`, le dimensioni e il collegamento istituzionale. Il record è versionato, associato al singolo `lococr:`, `locscan:`, item e ispezione. Se cambiano le fonti, il record resta consultabile nello storico ma non entra nelle nuove review.

## Cosa è realmente verificato

Il software verifica che un URL `info.json` fosse elencato **sotto quella scheda istituzionale al momento della lettura**, che l'endpoint appartenga al dominio LoC consentito, che il JSON restituisca l'**identità esatta** e dimensioni sensate. **Non** scarica le immagini, interpreta i pixel, dimostra che il testo OCR sia della stessa pagina o certifica originalità, autore, data, verità storica, diritti/licenza.

Sono consentiti solamente `www.loc.gov/item/<id>/?fo=json` e `tile.loc.gov/image-services/iiif/{service|master}:.../info.json`; nessun link thumbnail, risorsa arbitraria o download immagine. Limite 240 KB JSON della scheda / 96 KB IIIF, timeout 12s per GET, streaming limitato, nessun redirect, cookie, referer o credenziale. Errori CORS, 429, JSON malformato, accesso ristretto o risorsa rimossa bloccano senza salvare nulla. Gli errori non dimostrano che l'immagine originale sia falsa.

La dichiarazione «stessa pagina» e la base dei diritti appartengono **all'autore**. Solo lo specialista storico e il giudice critico vedono il metadato come dato **non autenticato**; gli altri undici agenti non lo ricevono. Gli ID `lociiif:` non sono fonti citabili in `historical.sourceIds` e non giustificano automaticamente alcuna riscrittura.

Il salvataggio avviene in IndexedDB con Web Locks/CAS. Un nuovo riferimento su un capitolo frozen riapre il capitolo e i successivi, conserva prosa e vecchi report, disabilita autosync e invalida l'outbox. Backup e repository possono contenere i metadati se autorizzi l'esportazione.

Riferimenti: [ADR 0025](../ADR/0025-loc-iiif-image-metadata-provenance.md), [guida collazione](loc-scan-collation.md), [API IIIF LoC](https://www.loc.gov/apis/micro-services/image-services/), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
