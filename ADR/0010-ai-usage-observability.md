# ADR 0010 — Telemetria dei token AI basata sui report dei provider

- **Stato:** Accettato per la prima tranche v0.7.1 (PR #18)
- **Data:** 2026-11-05
- **Issue:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17)
- **PR:** [#18](https://github.com/KeyserDSoze/BookWriter/pull/18)
- **Predecessori:** ADR 0001, 0007, 0009

## Contesto

BookWriter usa più endpoint e modelli, spesso con tariffe, quote, cache e saldi diversi. L'API generica OpenAI-compatible può restituire `usage.prompt_tokens` e `usage.completion_tokens`, ma **non è una fonte universale del saldo residuo del credito del provider**. Le richieste fallite, interrotte o in timeout possono essere fatturate senza che il browser riceva un report.

Un numero di "crediti rimasti" o una tariffa inventata inducerebbe l'autore a continuare l'autopilot basandosi su informazioni false. La prima tranche deve rendere visibile ciò che è osservato e dichiarare l'incompletezza.

## Decisione v0.7.1

1. Non creare una nuova API, token vault o tabella separata per il consumo: usare i dati `Activity.inputTokens`, `Activity.outputTokens`, `modelId` e `endpointId` **già salvati localmente** a ogni checkpoint AI.
2. Il modulo puro `domain/ai-usage.ts` aggrega i report delle attività **del libro attivo** e raggruppa per coppia `endpointId, modelId` (identificatore non ambiguo con serializzazione della coppia), senza combinare i modelli di fornitori differenti.
3. Validare ogni conteggio: numero intero, finito, non negativo e sicuro in JavaScript. Se un campo è assente o invalido non trasformarlo in una stima inventata; mostrare separatamente i conteggi effettivamente disponibili.
4. Distinguere tre classi: **completo** (input e output presenti, anche 0), **parziale** (uno dei due), **mancante** (nessuno dei due, ma attività associata a un modello). Le attività manuali prive di routing/usage non sono chiamate AI.
5. Non sommare attività ancora in esecuzione (`status:running`) in quanto il report non è conclusivo. Contare separatamente le attività fallite e interrotte nel messaggio di avviso, senza pretendere che ogni errore sia stato fatturato.
6. La Dashboard mostra i token di input, output e il totale **noto**, le coperture del report e il dettaglio per modello/endpoint. Usare design responsive e tabella con scorrimento locale in mobile; nessun overflow orizzontale della pagina.
7. Non visualizzare saldo crediti, spesa monetaria, tariffari o prezzo per token senza dati ufficiali/configurati. La UI deve invitare a verificare gli addebiti nel portale del provider.
8. I report restano in IndexedDB e nelle normali attività/ZIP del libro. Non inviare telemetry analytics ad alcun servizio esterno. Non esporre API key, PAT o prompt aggiuntivi nei widget.

## Conseguenze

- La vista può essere incompleta, soprattutto durante generazioni in corso o chiamate fallite; mostrare un avviso e non nascondere le lacune.
- Il numero totale di token osservati **non equivale al saldo credito** né a un limite preventivo. Questa versione non ferma ancora l'AI sulla base di un budget.
- Le copie di un libro importate da ZIP includono la propria cronologia attività; nella dashboard vengono conteggiate separatamente, senza deduzione globale tra tutti i libri.
- Gli endpoint diversi possono riferirsi allo stesso modello e avere costi distinti: la chiave di raggruppamento include sempre l'endpoint.
- La raccolta di dati precisi dipende dal provider: nessun fallback genera conteggi sintetici.
- I conteggi già salvati possono essere osservati senza richiedere una nuova chiamata API a pagamento.

## Limiti e tranche successive

1. **Listino esplicito** per endpoint+modello, con valuta e data: configurato dall'autore o letto da fonti provider ufficiali, eventualmente comprendendo cached tokens.
2. **Ledger di stime** e soglie per libro/sessione, con avvisi e controllo prima della nuova chiamata AI. Una chiamata già avviata può superare il limite; non promettere un hard cap transazionale su fatture remote.
3. Gestione del provider che non riporta usage quando il limite è vincolante: sospensione conservativa e consenso per proseguire.
4. Eventuali endpoint provider-native per conoscere saldo/account credits, solo ove disponibili e autorizzati, con privacy e CORS verificati.
5. Contabilità dei retry e dell'in-flight con ID operazione indipendente dal testo narrativo; dashboard che distingua costo osservato e stimato.

Tutte le tranche future richiedono una nuova ADR o un'estensione esplicita, nuovi test e un messaggio UI che distingua crediti reali, stime e consumi noti.

## Verifiche

- Unit test multi-provider e multi-modello, report completi/parziali/mancanti, token zero, input invalido, attività manuali senza usage e stati non conclusi.
- Playwright desktop/mobile con dati locali di due libri e attività simulate: conferma di isolamento, copertura, warning e larghezza viewport.
- TypeScript, Vitest, smoke, Vite build, browser E2E su HEAD verde prima del merge.
