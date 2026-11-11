# ADR 0012 — Budget AI per libro: tariffe dichiarate, riserva preventiva e arresto conservativo

- **Stato:** Implementato e integrato in main (v0.8.1, PR #21 merged, CI desktop/mobile verde)
- **Data:** 2026-11-05
- **Issue:** [#17](https://github.com/KeyserDSoze/BookWriter/issues/17)
- **PR:** [#21](https://github.com/KeyserDSoze/BookWriter/pull/21)
- **Predecessori:** ADR 0010 (token osservati), ADR 0011 (redazione a 12 agenti)

## Contesto

Ogni capitolo della v0.8.0 può comportare 12 × N richieste dei revisori, oltre a giudice, riscritture, consolidamento e sinossi. Un modello su endpoint OpenAI-compatible può non fornire prezzi, crediti residui, usage o supporto per `max_tokens`. Una richiesta terminata in errore può comunque essere fatturata. La Dashboard v0.7.1 mostra già i token noti, ma non impedisce di proseguire con chiamate molto costose.

Non è possibile garantire un limite **rigido** delle fatture di un provider esterno dal solo browser. Un blocco sul consumo stimato prima della chiamata è comunque una protezione concreta.

## Decisione

1. **Opt-in per libro.** `BookProject.aiBudget` contiene `enabled`, `enabledAt`, `limitEur`, `maxOutputTokens`. Il periodo di contabilizzazione inizia **all'attivazione**. Cambiare la soglia mentre il budget resta attivo non azzera la cronologia; disattivare e riattivare avvia volontariamente un nuovo periodo. I libri esistenti non sono bloccati retroattivamente.
2. **Tariffe manuali per coppia modello/provider.** `AppSettings.aiPriceRates` contiene prezzo input e output in **EUR per un milione di token**. Zero è ammesso se l'autore ha verificato che il servizio sia gratuito; un listino assente, duplicato o invalido blocca le nuove chiamate quando il budget è attivo. BookWriter non precompila né inventa listini.
3. **Accounting da log già presenti.** La stima monetaria usa i token input/output effettivamente dichiarati nelle `Activity`, moltiplicati per il listino inserito dall'utente. È **stima basata su usage noto**, non fattura e non saldo reale.
4. **Spesa sconosciuta ≠ zero.** Ogni richiesta provider imminente viene registrata come `Activity.aiRequested=true` *prima* del fetch. Se manca usage completo, modello o listino, se la richiesta è ancora in corso, o se il browser ha subito un'interruzione, il budget è considerato **incerto**. Nessuna nuova richiesta viene avviata automaticamente finché la situazione non è risolta esplicitamente dall'autore; è possibile consultare la fattura, cambiare soglia o riavviare un periodo consapevolmente. Le attività fermate dal preflight con `aiRequested=false` non sono marcate come potenzialmente fatturabili.
5. **Riserva preventiva.** Per la successiva chiamata, `preflightBookAiBudget` stima un limite prudente dell'input usando la lunghezza UTF-8 dei messaggi completi più 256 unità di overhead, e riserva la quantità di output configurata (256–32.768 token). Confronta **stima accumulata + riserva** con `limitEur` prima di inviare il prompt al provider. La richiesta comprende `max_tokens` quando il budget è abilitato. Se la somma è maggiore o uguale alla soglia, il runner **si mette in pausa** con un errore leggibile e senza inviare la richiesta.
6. **Gate applicativo, non soltanto UI.** Il controllo avviene nel runner `AutopilotRunner` su **ogni task** (compresi dodici revisori, direttore, remediation, consolidation/summaries) e anche in `generateSceneMergeDraft` per le proposte AI volontarie. Non sono modificati i controlli manuali di GitHub o le operazioni locali senza provider. È mantenuto il writer guard/lease esistente.
7. **Persistenza/portabilità.** Budget per libro e `aiRequested` restano nei libri/attività content-only e full ZIP. Le tariffe globali passano nel **backup completo** ma non in quello di soli contenuti. Una copia importata senza tariffe si fermerà conservativamente finché l'autore non configura prezzi sul browser di destinazione.
8. **UI responsive.** La Dashboard rende modificabili tariffe, soglia, `max_tokens`, stato opt-in e stima dei costi dal periodo attivo. Non visualizza mai crediti rimanenti o importi di fatturazione confermati.
9. **Nessuna sorveglianza.** I dati sono già in IndexedDB; non vengono inviati a servizi analytics nuovi e non si leggono saldi/provider nativi senza esplicita integrazione autorizzata.

## Limiti non negoziabili

- Il computo di byte UTF-8 è **una riserva prudente, non un tokenizzatore ufficiale** per tutti i modelli e non garantisce un limite di costo; il provider può aggiungere costi di caching, tool o retry, ignorare `max_tokens`, fatturare un output parziale o usare una diversa unità monetaria.
- I prezzi sono inseriti dall'autore e possono essere errati o obsoleti. Un provider può addebitare consumi non osservati o ignorare alcuni parametri. Il guard non sostituisce il portale di fatturazione.
- Il controllo copre le chiamate gestite dal runner e dalla fusione AI delle scene, non eventuali chiamate API fatte fuori BookWriter. A browser chiuso non continuano task né controlli remoti.
- La gestione conservativa degli `Activity` senza usage blocca nuove richieste ma non recupera automaticamente la fatturazione esterna. La disattivazione/reimpostazione del budget è una scelta esplicita, non una prova di recupero costi.
- I calcoli in euro non includono eventuale imposta, cambio valuta, token cached o differenze del listino per data. Occorreranno una ledger temporale e integrazioni provider-native dove disponibili.

## Alternative rifiutate

- Crediti residui inventati a partire dal numero di token: falsa sicurezza.
- Hard cap remoto garantito dal browser: impossibile senza controllo del provider e modello di addebito noto.
- Continuare automaticamente quando manca usage: potrebbe spendere senza limiti.
- Un prezzo hardcoded per modello: prezzi e disponibilità cambiano, e i provider possono essere personalizzati.
- Troncare la prosa per ridurre i token senza consenso: viola il canone narrativo e l'intento autoriale.

## Verifiche

- Vitest di stime, route provider/modello, listini invalidi/duplicati, uso incompleto o fallito, periodizzazione, limite pre-call e `aiRequested=false`.
- Integrazione runner: blocco **prima** del provider e, dopo una richiesta senza usage, stop prima della successiva.
- Playwright desktop/mobile: configurazione tariffe/budget, stop pre-call, riavvio dopo cambio soglia e arresto conservativo su usage mancante, su viewport senza overflow.
- Backup ZIP: prezzi solo nel full backup, budget del libro e history in content-only.
- Gate PR: typecheck, Vitest, smoke, build e Chromium desktop/mobile verdi prima del merge.

## Successivi

- Budget e spesa per sessione; costi e rate cards versionati per periodo e token cached.
- Preflight e prenotazione di budget distribuita fra dispositivi e browser, non solo sessioni locali.
- Supporto per alternative `max_completion_tokens` e per le diverse APIs di output dei provider, conservando il fail-closed.
- Consultazione del saldo provider reale soltanto se esistono API ufficiali appropriate e permessi espliciti.
- Visualizzazione di conti reali separati da stime, con avvisi sul credito prima della pubblicazione.


## Estensione del budget di sessione — issue #130, ADR 0120

Il precedente limite di periodo del libro rimane il gate principale. L'opzione `BookAiBudget.sessionLimitEur?` aggiunge un tetto **stimato** per il `runId` del singolo Avvia/Riprendi, con la stessa riserva di input/output. La ripresa crea un nuovo runId ma non azzera la spesa di libro né l'incertezza di usage/provider. Le proposte AI di fusione applicano il limite a ciascuna bozza. Backup ZIP content/full valida il campo e accetta libri legacy senza campo; nessuna prenotazione finanziaria o fattura viene generata. Dettagli in [ADR 0120](0120-session-ai-budget.md).
