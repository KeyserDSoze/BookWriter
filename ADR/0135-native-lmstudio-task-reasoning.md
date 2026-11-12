# ADR 0135 — LM Studio nativo e reasoning controllabile per attività

- Stato: accettato per MVP; prova hardware reale separata #159
- Data: 2026-11-12
- Issue: #160 stream lenti, #161 reasoning task, #159 validazione reale, #150 tool calling separato

## Motivazione

Muse Glimmer può generare più di mille token prima della risposta finale, a velocità locale di pochi token/secondo. In Chat Completions OpenAI-compatible il reasoning potrebbe non essere trasmesso; il vecchio timeout del corpo SSE di 600 secondi poteva abortire una generazione ancora attiva. La chat incorporata in LM Studio ha parametri diversi da quelli inviati da BookWriter.

## Decisione

1. Conservare `/v1/chat/completions` come default con JSON o SSE esplicito. `streamTimeoutSeconds` per endpoint da 600 a 3600, default 600, distinto da header e reader JSON. Nessun retry automatico dopo una richiesta potenzialmente addebitata.
2. Solo con `apiProtocol:"lmstudio_native"` e Base URL di loopback letterale con path `/v1`, inviare una singola POST `/api/v1/chat` con `model`, `system_prompt`, `input`, `stream:true`, `store:false`, eventuale cap `max_output_tokens`, eventuale `reasoning:low|medium|high`. Non inviare tools, integrations, previous_response_id né usare fallback automatico. `xhigh` non appartiene ai valori nativi supportati e deve essere rifiutato **prima della rete**.
3. Validare stream nativo `text/event-stream`, `chat.start`, `chat.end` con `result.output` testuale, stats reali, byte ≤2MB, deadline, cancel e abort. `error`, tool_call, eventi sconosciuti, stream incompleto e reasoning-only non devono toccare il canone. Accettare `message.delta`/ `reasoning.delta` come anteprima, percentuali solamente dai veri `model_load.progress` e `prompt_processing.progress` del provider. `chat.end` fornisce la risposta da sottoporre al normale writer lock/CAS.
4. Reasoning gerarchico: `book.taskReasoningEfforts[TaskKind]` > `settings.taskReasoningEfforts[TaskKind]` > `endpoint.reasoningEffort`. `automatic` significa omettere il parametro e non ereditare, `undefined` significa ereditare. Validazione completa di enum e chiavi su runtime/save/ZIP, override libro con Web Lock + CAS e libro non running. `requestedReasoningEffort` in Activity attesta solo la richiesta, non l'effort effettivamente applicato da LM Studio.
5. Tracce con contenuti sensibili solo su consenso in IndexedDB meta esistente; eventi/status/byte non contengono prompt. Mai inviare dati a GitHub, non fare richieste extra o strumenti durante lo streaming. Non inventare thinking non trasmesso. La prova sul PC dell'autore è richiesta in #159 e non dimostrata da CI mock.
6. Test unitari su parser native, con error/abort/tool/reasoning-only, routing task, input validation e budget; E2E desktop/mobile. Frontend CI, EPUBCheck, Pages e cleanup devono essere `completed/success` sulla stessa commit. La release npm #155 mantiene lockfile riproducibile separato.

Fonti: [LM Studio Chat nativa](https://lmstudio.ai/docs/developer/rest/chat), [Eventi SSE LM Studio](https://lmstudio.ai/docs/developer/rest/streaming-events), [Confronto API](https://lmstudio.ai/docs/developer/rest), [Muse Glimmer prompting](https://dev.meta.ai/docs/muse-glimmer/prompting).
