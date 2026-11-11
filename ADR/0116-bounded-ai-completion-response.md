# ADR 0116 — Lettura limitata e interrompibile delle risposte AI

- Stato: accettato
- Data: 2026-11-11
- Issue: #123; epic #6/#17/#20
- Ambito: una risposta JSON HTTP 2xx a POST /chat/completions

## Problema

Il client AI leggeva la risposta con `response.json()` senza limite di byte o durata della lettura. Una risposta OpenAI-compatible enorme, con Content-Length falsificato o stream infinito, poteva trattenere memoria o bloccare l'autopilot. Il validatore #115 dei contenuti agiva solo dopo il caricamento completo; #118 limita GET /models, non le generazioni.

## Decisione

1. Conservare POST OpenAI-compatible, routing corrente, privacy e la validazione dei messaggi. Solo la lettura passa a `readChatCompletionJson`: accetta esclusivamente JSON UTF-8 completo, massimo **2.000.000 byte** per corpo (envelope, usage e contenuto insieme). È un limite ampiamente maggiore del report/segmento abituale, non un obiettivo di produzione della prosa. Non troncare né deduplicare testo per rientrare nel cap.
2. Rifiutare MIME non JSON se dichiarato, Content-Length sintatticamente invalido o sopra limite, e anche stream realmente eccessivi con Content-Length assente o falso. Leggere un chunk per volta dal ReadableStream, accumulare al massimo il cap, cancellare lo stream su errore con best effort. Il cleanup in `finally` deve tollerare sia Promise rifiutate sia eccezioni sincrone di `reader.cancel()` e `releaseLock()`, preservando l'errore originale di lettura, il timeout e l'`AbortError` (#138). Nessuna fiducia nell'header come prova di dimensione.
3. Avviare un timer di **60 secondi solo dopo gli header 2xx**: serve a limitare il corpo che non termina, non la generazione prima degli header, per cui valgono i controlli/abort del runner. Usare una Promise di interruzione che compete con `reader.read()`; non aspettare `reader.cancel()` quando un'implementazione malfunzionante non la conclude. L'`AbortSignal` dell'autore ha precedenza sul timeout e rimane un vero AbortError.
4. Eseguire il parsing solo su UTF-8 valido e corpo interamente terminato. Un rifiuto pre-parsing non espone body/provider raw error, key, endpoint sensibile, prompt o output. Senza envelope JSON validato il consumo è ignoto; non falsificare usage. Se l'envelope valido contiene invece un messaggio malformato, preservare la precedente acquisizione dei token osservati delle issue #111/#115.
5. L'autopilot è browser-local e stoppa senza freeze, canone o progressi fittizi. L'eventuale costo effettivo di un provider dopo un timeout non è conoscibile dal solo client; budget e ledger devono segnalarlo come incertezza, mai come zero.

## Prove e limiti

Vitest: stream frazionato, limite esatto/superamento, Content-Length falso, MIME, UTF-8/JSON malformato, read mai concluso e abort del runner, privacy e uso token. Playwright desktop/mobile: provider simulato con stream fuori limite, Activity failed, nessun rapporto approvato, testo canone invariato, uso token ignoto e nessuna chiamata provider ripetuta.

Il limite sul *corpo ricevuto* non pone un limite al numero di token fatturati dal provider: il budget pre-call e il ledger sono contratti separati. Un futuro supporto SSE/streaming intenzionale richiede un ADR distinto: l'endpoint corrente richiede JSON normale completo.
