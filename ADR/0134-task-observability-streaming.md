# ADR 0134 — Task AI osservabili, SSE facoltativo e tracce locali per consenso

- Stato: accettato per MVP; rewind reale non implementato
- Data: 2026-11-12
- Issue: #156 adapter/trace, #157 dashboard task-first, #158 rewind futuro, #150 tool calling
- Ambito: Chat Completions /v1/chat/completions, Activity, UI task, IndexedDB meta

## Contesto

Una schermata limitata a «Brainstorming in corso» impedisce all'autore di verificare la richiesta al server, l'eventuale output del modello e la separazione tra tokens temporanei e canone. Sui provider locali la POST può restare aperta a lungo e `application/json` non espone testo fino alla fine. La chat di LM Studio può mostrare un selettore reasoning ma la API Chat Completions ha un insieme distinto di parametri.

## Decisione

1. Preservare la modalità JSON legacy come default. Offrire per endpoint `streamMode:"sse"` esplicito; inviare una sola richiesta `stream:true` e `stream_options.include_usage:true` senza retry automatici. Accettare MIME `text/event-stream` con parser SSE incrementale, max 2 MB, deadline 600s, abort, `[DONE]` obbligatorio, delta content testuali e `reasoning_content` o `reasoning` se esistono. Se il provider restituisce `application/json` nonostante SSE, usare il reader legacy con la stessa chiamata, senza riprovare. HTTP 4xx non va automaticamente ritentato.
2. `reasoningEffort` per endpoint optional `low/medium/high/xhigh`; se assente non inviare `reasoning_effort`. La compatibilità dipende dal server e dal modello, non inferirla dal nome.
3. `LiveAiTrace` è in memoria volatile, identificato da book/activity: delta di testo e reasoning ricevuti sono **provvisori** e non approvati. Solo il normale flusso `work.apply` + lease/CAS `saveBookAndActivity` conferma una risposta nel canone. Nessun delta modifica `BookProject` o `Activity.output`.
4. I messaggi system/user possono contenere segreti e non devono essere pubblicati automaticamente: consenso `inspectAiRequests` locale, disabilitato di default. Tracce limitate (`system` 120k, `user` 120k, risposta 120k, reasoning 20k caratteri), registrate **separatamente** in IndexedDB `meta` con prefisso `ai-trace:`. Esclusione da ZIP full/content, Activity, GitHub, outbox, import e sync; cancellazione locale esplicita. In caso di errore, lo status di Activity rimane fonte di verità e la trascrizione può non essere disponibile.
5. UI task-first con timeline attività e progresso/risposta live; collassare il contenuto avanzato quando il libro è in esecuzione. Attività passate ispezionabili, distinguendo log completo consensuale dagli output confermati già persistenti. Il click su un task precedente **prepara soltanto** una nuova istruzione, non ripristina fasi o snapshot né autorizza strumenti per cambiare libri.
6. La vera ripartenza da un task richiede checkpoint esatti, replay non distruttivo, analisi degli impatti sui capitoli a valle, approvazione autoriale e tool schema/permessi (#158/#150). Non indebolire writer lease, CAS, budget, freeze o revisione editoriale.

## Rischi e verifiche

- Streaming JSON malformato o prematuramente interrotto deve essere respinto senza canon; nessun retry dopo un possibile addebito. L'usage può mancare se il provider non lo trasmette, quindi il ledger non deve presentare numeri inventati.
- Il reasoning è solo quello *emesso dal modello via API*. Non riprodurre una chain of thought inesistente. L'API nativa LM Studio può avere eventi avanzati non presenti su Chat Completions.
- Vitest parser SSE, corpo ostile/abort, preflight reasoning, no-key e isolamento trace. Playwright desktop/mobile con provider mock e task inspector, conferma richiesta e output.
- CI, Pages e cleanup sulla stessa HEAD, e prova provider fisico LM Studio separata dai test mock.
