# ADR 0122 — Parametro limite output Chat Completions esplicito per endpoint

- **Stato:** implementato su `main`, incluso nella release npm 0.11.87 (issue #136)
- **Data:** 2026-11-11
- **Issue:** [#135](https://github.com/KeyserDSoze/BookWriter/issues/135), epic [#17](https://github.com/KeyserDSoze/BookWriter/issues/17), autopilot [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Riferimenti:** [ADR 0012](0012-book-ai-budget-guardrails.md), [ADR 0120](0120-session-ai-budget.md), [guida](../docs/ai-output-token-parameter.md), [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

## Problema

Il preflight preventivo dell'autopilot e delle proposte di fusione AI calcola un massimo di token output; il client `POST /chat/completions` ha finora inviato esclusivamente `max_tokens`. La documentazione ufficiale OpenAI indica `max_completion_tokens` come nuovo parametro (inclusi eventuali token di ragionamento non visibili) e `max_tokens` come deprecato, non compatibile con alcuni modelli reasoning. I server OpenAI-compatible possono però accettare insiemi diversi di parametri, anche quando servono modelli con lo stesso nome. Indovinare il parametro dal nome del modello o fare due POST automatici potrebbe consumare denaro non osservato.

## Decisione

1. Ogni `EndpointProfile` può definire `outputTokenParameter?: "max_tokens" | "max_completion_tokens"`. Il valore **assente** equivale esattamente al precedente `max_tokens`: impostazioni, importazioni e libri legacy non cambiano il proprio contratto API. Il campo vive nel profilo di endpoint (e nel ZIP full), non nei record Activity o nel canone.
2. Il form **Impostazioni → Endpoint OpenAI-compatible** espone le due opzioni in italiano con il valore letterale della chiave JSON. Il salvataggio esplicito conserva il campo con lo stesso coordinatore di snapshot che protegge URL, cifratura e modelli da commit obsoleti. Prima di cifrare **qualsiasi** chiave, il coordinatore valida tutti i profili: solo `undefined` o i due valori esatti sono accettati.
3. `callModel` controlla il campo scelto **prima** di aprire la rete, senza fallback silenzioso per valori non fidati. Se il preflight ha passato `maxOutputTokens` intero e positivo (massimo 32768), il corpo JSON aggiunge **esattamente una** tra `max_tokens` e `max_completion_tokens`. Senza budget/cap, non aggiunge nessuna delle due. `model`, `messages`, route, headers, timeouts e handling usage restano immutati. La riserva del preflight sul limite output rimane la stessa per entrambi i parametri.
4. La chiamata esegue **un solo POST**. Su HTTP 400/422/429, timeout o aborto non ritenta con l'altra forma né tenta un endpoint secondario: il server potrebbe avere già elaborato/addebbitato parte della richiesta. L'autore deve correggere esplicitamente la configurazione e riprendere, rispettando il blocco di usage incerto del budget globale.
5. Il backup ZIP full conserva `outputTokenParameter`, il content-only non include né endpoint né chiavi. L'importazione full valida `z.enum(["max_tokens","max_completion_tokens"]).optional()` prima di ripristinare la chiave cifrata, rifiutando valori arbitrari anziché inventare una compatibilità; gli archivi legacy senza campo continuano a funzionare.
6. I provider/modelli che richiedono altre API o `max_output_tokens` (Responses API) **non** sono supportati da questo intervento. Nessuna autodetection, retry di compatibilità, modifica di token osservati o dichiarazione di saldo reale provider. Il cap input/output è prudenziale, non una garanzia fattura; `max_completion_tokens` può includere token interni non visibili.

## Verifiche

Vitest: default legacy, opt-in, JSON mutuamente esclusivo, route per endpoint, chiamata senza cap, input invalidi e limite non intero, errori HTTP senza retry, aborto prima della rete, commit cifrato e validazione pre-encrypt, ZIP full/legacy/ostile. Playwright Chromium desktop/mobile: selezione, salvataggio, reload, attivazione budget, singolo POST 400 mock con `max_completion_tokens` e Activity fallita senza usage, nessun retry, segreto assente dal corpo e viewport senza overflow.

La tranche #135 è stata chiusa dopo CI/EPUBCheck/Pages/cleanup sulla sua HEAD. La release numerica 0.11.87 (#136) include il parametro output; manifest e lockfile npm sono stati generati con il registry ufficiale. CI e deploy della release devono essere verificati sulla nuova HEAD prima di chiudere #136.
