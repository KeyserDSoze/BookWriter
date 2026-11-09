# ADR 0106 — Usage osservato anche se la risposta editoriale viene scartata

- **Stato:** accettato per v0.11.74
- **Data:** 2026-11-10
- **Issue:** [#111](https://github.com/KeyserDSoze/BookWriter/issues/111)
- **Epic:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** [ADR 0010](0010-ai-usage-observability.md), [ADR 0012](0012-book-ai-budget-guardrails.md)

## Problema

Il provider può completare la richiesta con usage noto e una risposta **letterariamente inutilizzabile**: un report JSON invalido, una remediation non conforme, una scena rifiutata dal controllo di provenienza o una lease persa. `AutopilotRunner` assegnava input/output token alla `Activity` soltanto **dopo** `work.apply`. In caso di fallimento del validatore, la chiamata restava `failed` ma la contabilità diventava `unknown`, come se il provider non avesse restituito conteggi. La stessa lacuna esisteva nel `catch` delle bozze `generateSceneMergeDraft`.

## Decisione

1. Al ritorno **riuscito** di `callModel` copiare subito `endpointId`, `modelId`, `inputTokens`, `outputTokens` sul **medesimo** oggetto `Activity` creato prima del fetch; farlo **prima** dei check di lease, freshness, schema del testo e commit, e **senza** dichiarare `succeeded`. Il `catch` preesistente registra `failed/cancelled` preservando i token osservati.
2. Applicare lo stesso passaggio in `generateSceneMergeDraft`, prima di `validateSceneProposal`, verifica del confronto remoto, persistenza della bozza. Una proposta scartata **non** viene promossa a draft o canon e non genera checkpoint fittizi.
3. Se `callModel` lancia per errore HTTP, rete, JSON dell'envelope o testo vuoto, nessun oggetto `ModelAnswer` confermato esiste: restano `aiRequested=true` e usage **ignoto**. Se manca uno dei due conteggi, il budget continua a bloccare conservativamente come già stabilito nell'ADR 0012. La stima non diventa una fattura e non autorizza retry automatici.
4. Conservare separati **risultato narrativo valido** e **consumo potenzialmente fatturabile**. Non cambiare la soglia, le tariffe, il limite `max_tokens`, i diritti sui dati o il locking. Nessuna nuova dipendenza o migrazione IndexedDB.

## Prove

Vitest con risposta `callModel` dal contenuto invalido ma usage completo, con uso parziale e con checkpoint mutato tra richiesta e commit; scena di fusione AI troppo lunga con usage completo e scena invariata; E2E desktop/mobile con report rifiutato, unica chiamata mock, Activity failed e usage completo senza rapporti approvati. La CI/Pages/cleanup della release devono essere verdi sulla stessa SHA.

## Limiti

Lo usage è soltanto quello dichiarato dal provider, non dimostra una fattura effettiva. Un output rifiutato non implica che la spesa si azzeri e un output accettato non garantisce che il provider abbia incluso tutti i costi. Il blocco fail-closed in assenza di usage non viene allentato.
