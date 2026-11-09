# ADR 0107 — Usage su risposta provider vuota ma HTTP 200 e JSON valido

- **Stato:** accettato per v0.11.75
- **Data:** 2026-11-10
- **Issue:** [#112](https://github.com/KeyserDSoze/BookWriter/issues/112)
- **Epic:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Predecessore:** [ADR 0106](0106-provider-usage-before-editorial-validation.md)

## Contesto

Il gate #111 conserva usage quando il provider ritorna un `ModelAnswer` e la risposta viene rifiutata *dopo* quel ritorno. Ma `callModel` scarta una risposta HTTP 200 con JSON valido e `choices[0].message.content` vuoto o composto da whitespace, lanciando prima del `ModelAnswer`. Il provider può avere comunicato `usage` valido: imputarlo come *ignoto* nel ledger nasconde una stima che è già disponibile, bloccando il budget #17 inutilmente.

## Decisione

1. **Errore tipizzato** `EmptyProviderContentError` in modulo indipendente `infrastructure/ai-provider-error.ts`, contenente solo `endpointId`, `modelId` e contatori provider passati tramite `validTokenCount` (interi non negativi), *mai* corpo AI o credenziali. La risposta rimane un errore; nessun modello viene approvato senza testo.
2. Soltanto dopo HTTP 2xx e JSON parsato, `callModel` genera l'errore con le misure del campo `usage` se il testo è assente, vuoto o whitespace-only. Risposte non vuote continuano a tornare come `ModelAnswer` con contatori validati. Non usare `usage` da HTTP error, fetch abortita o envelope non JSON; non attribuire numeri mancanti, negativi, float, stringhe o `null`.
3. Nei `catch` di `AutopilotRunner` e `generateSceneMergeDraft` il helper `keepObservedUsageOnEmptyReply` copia esclusivamente le misure certificate dalla forma validata dell'errore tipizzato sulla `Activity` già registrata come `aiRequested=true`. Poi il salvataggio di `failed/cancelled` prosegue invariato: nessun report, draft o canone salvato.
4. Nessuna modifica a rate card, retroattività, threshold, Web Locks, remote lease, consenso autore, ZIP o UI. Non confondere `HTTP 200` con addebito confermato, né ignorare chiamate senza usage. **Non** effettuare retry automatici.

## Prove

Test Vitest di `callModel` con risposta vuota/whitespace e usage completo, usage parziale/invalidi, HTTP 429 con usage nel body ignorato, JSON non valido, testo normale; Vitest end-to-end della logica di autopilot e scene merge con errore tipizzato e checkpoint/canon immutato; Playwright desktop/mobile con review malformata e HTTP 200 vuoto entrambi con usage noto, Activity failed, importo dopo reload e zero approvazioni. CI completa, EPUBCheck, Pages e cleanup verdi sulla HEAD finale.

## Limite

Le quantità sono riportate dal provider, non una fattura. In caso di usage parziale o assente il budget resta fail-closed: una risposta vuota non implica spesa zero.
