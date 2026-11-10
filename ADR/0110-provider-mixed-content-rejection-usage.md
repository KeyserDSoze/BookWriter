# ADR 0110 — Risposta provider con parti non testuali: fail-closed e usage preservato

- **Stato:** accettato per v0.11.78
- **Data:** 2026-11-10
- **Issue:** [#115](https://github.com/KeyserDSoze/BookWriter/issues/115)
- **Epic:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0106](0106-provider-usage-before-editorial-validation.md), [ADR 0107](0107-empty-provider-response-usage.md), [ADR 0108](0108-price-snapshot-ai-budget.md)

## Problema

Il parser di `callModel` usava `content.map(x => x.text ?? "").join("\\n")` per le risposte OpenAI-compatible con `choices[0].message.content` in array. Se una parte era `null`, il codice lanciava un `TypeError` non tipizzato e **perdeva l'usage osservato**. Se una parte aveva `text` numero/oggetto, `join` ne costruiva implicitamente prosa (`42`/`[object Object]`). Un array misto testo/immagini poteva eliminare silenziosamente parti del risultato e approvare prosa incompleta.

## Decisione

1. `callModel` considera un `ModelAnswer` valido **solo** se `choices[0].message.content` è una stringa utilizzabile oppure un array completo di parti non nulle, ognuna oggetto con `text:string` e `type` assente o esattamente `"text"`. Concatena parti testuali con newline, conservando il formato preesistente. Parti `null`, numeri, booleani, stringhe al posto dell'oggetto, `text` non stringa, `type=image_url/refusal` o struttura `choices/message` mancante sono malformati: rifiutare **tutto**, non accettare solo le parti sane.
2. Per HTTP **2xx** e JSON già decodificato, il nuovo `MalformedProviderContentError` (sottotipo di `ProviderContentError`) trasporta soltanto identificativi pubblici della route e `prompt_tokens/completion_tokens` passati da `validTokenCount`. Rimane distinto da `EmptyProviderContentError` per stringa nulla/vuota o array testuale senza testo. **Non** copiare il payload, la prosa restituita, il prompt, l'URL con segreti o l'API key nell'errore e nei log.
3. Il helper `keepObservedUsageOnRejectedReply` sostituisce la variante riservata all'output vuoto e viene usato dai `catch` dell'autopilot e della fusione AI. Il ledger `failed/cancelled` conserva i contatori veramente comunicati e il prezzo pre-fetch già fotografato; nessun report, scena, bozza o giudizio diventa canon. Usage assente/parziale rimane **incerto** e blocca i nuovi tentativi nel budget; HTTP non-2xx, JSON invalido e rete non autorizzano usage inventato.
4. Nessuna migrazione schema, nuova chiamata AI, retry, modifica di consent/lease, provider SDK o accettazione automatica di parti non testuali. Per endpoint provider-native con modalità differenti occorrerà adattamento esplicito, non coercizione implicita.

## Verifiche

Vitest su content semplice/array text-only, array `null`, mixed `image_url`, oggetto, numero, booleano, envelope privo di choices, usage completo/parziale o non valido; integrazione in runner e merge con `Activity` unica e failed, canon invariato. Playwright desktop/mobile su report errato, testo vuoto e parti miste con usage 243/72: zero rapporto applicato, una sola attività fallita, stima locale persistente e nessun retry. CI completa, EPUBCheck, Pages e cleanup sulla HEAD di main.

## Limiti

I token e le tariffe costituiscono osservabilità dichiarata dal provider/autore, non una fattura e non una prova di validità letteraria. Supportiamo soltanto il contenuto testuale OpenAI-compatible esplicitamente verificato.
