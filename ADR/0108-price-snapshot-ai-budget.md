# ADR 0108 — Snapshot tariffa nella singola Activity AI

- **Stato:** accettato per v0.11.76
- **Data:** 2026-11-10
- **Issue:** [#113](https://github.com/KeyserDSoze/BookWriter/issues/113)
- **Epic:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17) e [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** [ADR 0012](0012-book-ai-budget-guardrails.md), [ADR 0106](0106-provider-usage-before-editorial-validation.md), [ADR 0107](0107-empty-provider-response-usage.md)

## Problema

La contabilità originale di `accountBookAiBudget` moltiplicava i token storici per la tariffa **attualmente** configurata in `AppSettings.aiPriceRates`. Modificare il prezzo per future chiamate rivalutava implicitamente tutta la spesa passata. Le tariffe non sono recuperate da un provider né sono una fattura; non si può risalire al listino storico di un archivio legacy che non lo registrava.

## Decisione

1. Ogni nuova chiamata del runner e della fusione scene cattura **una copia** del listino valido per la coppia endpoint/modello al momento del preflight, prima di porre `Activity.aiRequested=true` e inviare la richiesta. Il campo opzionale `Activity.priceRateSnapshot` contiene soltanto `endpointId`, `modelId`, `inputEurPerMillion`, `outputEurPerMillion` (nessuna credenziale). Il record resta anche se il provider fallisce, l'uso è parziale, l'output è rifiutato o manca il testo.
2. L'accountant usa lo snapshot **se presente**, senza consultare il listino corrente per quel record. Deve essere valido (numeri finiti, 0–10.000, ID non vuoti) e riferirsi **esattamente** a endpoint/modello dell'Activity. Uno snapshot presente ma malformato o con route diversa è `unpriced`, quindi budget fail-closed, mai fallback a prezzi correnti.
3. Per **Activity legacy senza il campo**, mantenere la vecchia stima col listino corrente evitando migrazioni distruttive: aggiungere `legacyPricedCount` e avviso locale nel pannello budget che **questi importi possono cambiare** se il prezzo viene modificato. Senza listino corrente anche il legacy resta `unpriced`. Non inventare snapshot passati a posteriori.
4. Aggiungere la validazione del campo opzionale nello ZIP content-only/full (oggetto bounded e strict), preservandone il round-trip; nessuna modifica della versione ZIP o delle credenziali. Un ZIP con rate invalido viene rifiutato prima di importare. Un backup legacy senza campo resta valido.
5. Mostrare che una tariffa modificata oggi vale per le **chiamate future**, non per quelle già registrate con snapshot. Nessun prezzo provider automatico, rate history remota, costi cached/tool/FX o hard cap promesso.

## Prove

Vitest: prezzo copiato, aumento a posteriori senza rivalutazione, nuovo preflight che usa prezzo corrente, legacy dichiarato, snapshot manipolato/out-of-route bloccato, runner + scene merge con risposte scartate e quote preservate; backup content-only e import legacy. E2E desktop/mobile: una richiesta mock rifiutata ma con usage, costo ricostruito dopo reload, cambio di tariffa 10×, importo storico identico dopo nuovo reload, nessun canone approvato. CI+EPUBCheck, Pages, cleanup verdi sulla HEAD finale.

## Limiti

Il prezzo storico è quello **dichiarato dall'autore nel browser**, non prova di fatturazione né di disponibilità. I vecchi record senza snapshot non possono essere ricostruiti retroattivamente; mostrano un avviso e rimangono ricalcolabili con tariffe correnti. L'archivio ZIP non autentica crittograficamente un listino e il browser non garantisce un tetto remoto di spesa.
