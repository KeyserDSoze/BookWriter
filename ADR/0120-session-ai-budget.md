# ADR 0120 — Limite AI per sessione autopilot con identità runId e budget globale invariato

- **Stato:** accettato, rilasciato su `main` in v0.11.85 (issue #131)
- **Data:** 2026-11-11
- **Issue:** [#130](https://github.com/KeyserDSoze/BookWriter/issues/130), epic [#17](https://github.com/KeyserDSoze/BookWriter/issues/17) e [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** [ADR 0012](0012-book-ai-budget-guardrails.md), [ADR 0108](0108-price-snapshot-ai-budget.md), [ADR 0118](0118-local-ai-cost-ledger-csv.md), [ADR 0119](0119-task-ai-cost-history.md)

## Problema

Il budget preventivo opzionale del libro considera tutti i tentativi AI osservati dal momento dell'attivazione, ma l'autore potrebbe voler fermare una **singola esecuzione** del runner dopo un ammontare più basso, senza abbassare la soglia complessiva. Il sistema dispone già del `Activity.runId` UUID creato a ogni pressione Avvia/Riprendi; aggiungere un secondo registro o cancellare le Activity al resume sarebbe ridondante e pericoloso.

## Decisione

1. Aggiungere `BookAiBudget.sessionLimitEur?` opzionale, numero EUR finito nell'intervallo **0,01–100.000**. Un libro legacy senza campo continua a funzionare con il precedente limite globale. L'autore può inserire o eliminare il limite dalla Dashboard del libro, salvando con le protezioni già esistenti: libro non in esecuzione, CAS su `updatedAt`, nessuna mutazione della prosa. La configurazione è efficace solo quando il budget globale opt-in è abilitato.
2. **Identità di sessione:** per l'autopilot una sessione coincide con una sola invocazione `Avvia/Riprendi`, il cui `runId` è creato prima di acquisire il writer guard e condiviso fra tutti i tentativi AI fino alla pausa/errore/fine. Alla successiva ripresa viene creato un nuovo ID e la somma di **quella sessione** riparte, non il budget del libro. Una proposta AI di fusione scena è una sessione autonoma di una singola richiesta, con lo stesso `runId` in preflight e Activity; una fusione manuale non richiede token.
3. **Contabilità senza nuova persistenza:** `accountSessionAiBudget` prende solo Activity dello stesso `bookId` **e** `runId`, dopo `enabledAt`, che siano effettivamente tentativi AI. Riutilizza `accountBookAiBudget` e `assessAiCostAttempt`: tariffe snapshot valide per route, listino corrente dichiarato per legacy, token interi realmente osservati, zero noto soltanto con report completo. Usage parziale/mancante/in corso e tariffe assenti non valgono zero.
4. **Preflight di entrambi i tetti:** `preflightBookAiBudget` applica per prima cosa il **budget globale di libro**, incluso lo stop su usage incerto, e calcola la stessa riserva prudente di input/output. Se `sessionLimitEur` è configurato, richiede un `runId` non vuoto (altrimenti stop fail-closed) e verifica **stima sessione + medesima riserva** contro il limite; al raggiungimento blocca la chiamata **prima del provider**, senza registrarla come `aiRequested=true`. Disabilitare/riprendere la sessione non consente di ignorare i costi precedenti del libro.
5. **UI onesta:** mostra limite stimato e costo della **ultima sessione con Activity AI registrata** nel periodo del libro, distinguendo eventuali consumi ignoti. Il valore di questa ultima sessione non è saldo finanziario, né necessariamente la sessione attualmente attiva o la somma di tutte le sessioni. Le stime/costi del libro completo rimangono sempre visibili separatamente.
6. **Portabilità controllata:** `sessionLimitEur` è proprietà del `BookProject.aiBudget` e attraversa i backup ZIP content/full come il precedente budget. Lo schema dei libri importati valida finitezza, limite e campi obbligatori, scarta valori ostili senza promuoverli; backup legacy senza `sessionLimitEur` restano leggibili. Nessuna modifica a struttura o versione dell'archivio, credenziali, remote lease o modelli.

## Rischi e limiti espliciti

- **Nessun plafond transazionale distribuito**: due dispositivi offline potrebbero avviare run con ID distinti prima della sincronizzazione; nessuna prenotazione condivisa o conto provider reale. Il guard writer/lease esistente resta necessario, ma non trasforma il limite in garanzia bancaria.
- Avvia/Riprendi crea una **nuova sessione**; non deduce che due riprese siano una singola sessione finanziaria. Il limite globale sopravvive a tutte le riprese e continua a bloccare se ci sono tentativi incerti nel periodo, salvo riattivazione consapevole del budget del libro.
- Una richiesta esterna a BookWriter o un provider senza usage può ancora avere addebiti ignoti; prezzo manuale, stima input UTF-8 + overhead e `max_tokens` non costituiscono un tetto di fattura. Nessun recupero automatico del costo provider, nessun nuovo backend e nessuna telemetria.
- Gli archivi ZIP contenenti schemi budget malformati prima tollerati come metadati non tipizzati vengono ora rifiutati per proteggere l'attivazione del budget. È una validazione intenzionale, non una migrazione automatica.

## Verifiche

Vitest sul preflight globale + sessione, isolamento fra libri/runId/date, blocco dopo più chiamate nello stesso run, ripresa con budget globale immutato, mancanza di runId, uso incerto, snapshot invalidi e limiti numerici; backup ZIP valido, legacy e manomesso; Playwright Chromium desktop/mobile per blocco prima della rete con limite sessione, aumento deliberato e arresto per usage mancante. CI, Pages, cleanup e EPUBCheck 5.4.0 sulla medesima HEAD definitiva prima di chiudere #130.


## Estensione di osservabilità — ADR 0121 / #132

La UI del budget per sessione riceve ora un **avviso anticipato dall'80%** della spesa stimata nota nel `runId` più recente, indipendente dall'avviso sul periodo globale. È una proiezione dell'accounting, senza blocco aggiuntivo prima del provider o nuovo stato persistente; usage/tariffe incerti **nascondono** i margini apparentemente disponibili. [ADR 0121](0121-early-ai-budget-headroom-warnings.md) conserva definizioni e limiti, compreso il fatto che la Dashboard non può conoscere la riserva della prossima richiesta.
