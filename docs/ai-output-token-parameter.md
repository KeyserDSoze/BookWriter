# Parametro limite output API — BookWriter, issue #135

In **Impostazioni → Endpoint OpenAI-compatible**, ogni endpoint ha un campo **Parametro limite output API**. Sono disponibili **max_tokens (compatibilità precedente)** e **max_completion_tokens (modelli compatibili)**. Il secondo è utile per modelli che lo richiedono nel protocollo Chat Completions; non tutti gli endpoint e i modelli compatibili accettano le stesse chiavi. Controlla la documentazione del provider prima di cambiarlo. Il default dei profili creati in passato rimane **max_tokens**.

## Quando si invia

Questa scelta interviene solo quando attivi un **budget AI preventivo** e BookWriter fornisce alla chiamata un massimo output configurato. Il preflight del libro e della singola sessione continua a stimare input e output e a verificare i limiti **prima** del POST. La richiesta contiene una sola chiave per il massimo output, mai entrambe. Quando il budget non applica un cap, non viene inviato né `max_tokens` né `max_completion_tokens`: nessun limite di costo garantito.

Quando il provider restituisce **HTTP 400 o 422** su una richiesta che conteneva il cap, BookWriter suggerisce di **controllare anche** il parametro limite output nelle Impostazioni: non può sapere con certezza se questa è la causa, e non mostra il corpo dell’errore del provider: se disponibile, prova a cancellare il flusso della risposta rifiutata senza leggerlo. Un eventuale errore nella cancellazione non modifica la diagnosi HTTP. Senza cap o su altri codici HTTP il messaggio non attribuisce il problema a quel parametro.

I provider possono rifiutare la richiesta se il modello non supporta il parametro scelto. BookWriter **non ritenta automaticamente** con l'alternativa, perché anche un tentativo senza risposta valida può avere un costo. Per correggere il problema, vai nelle Impostazioni, scegli il campo appropriato per l'endpoint, premi **Salva impostazioni**, quindi riprendi il libro **deliberatamente**. Un tentativo precedente senza usage resta incerto e può bloccare il budget finché non riattivi consapevolmente il periodo del libro.

`max_completion_tokens` può includere token di ragionamento non visibili nella prosa. Non è il parametro `max_output_tokens` della Responses API, che questa applicazione non usa. **Nessun** numero mostrato in BookWriter è la fattura reale del provider: i prezzi sono manuali, i token possono essere incompleti e il server può applicare regole proprie.

## Privacy e backup

La scelta è una proprietà locale dell'endpoint salvata insieme alle impostazioni cifrate in IndexedDB. Lo ZIP **full** (da proteggere con password) include la scelta e la chiave come già previsto; gli ZIP **content-only** non esportano né impostazioni endpoint né credenziali. Gli archivi legacy senza questo campo restano compatibili. Le importazioni full che contengono valori inventati o di un'altra API vengono respinte.

[ADR 0122](../ADR/0122-chat-completions-output-cap-parameter.md) · [Guida budget](ai-budget.md) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17) · [Documentazione API ufficiale](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Release npm

Questa funzionalità è inclusa nella versione **0.11.87** (#136), insieme alla diagnostica prudente degli errori HTTP (#137). Verificare comunque la compatibilità del modello/provider; nessun retry automatico.
