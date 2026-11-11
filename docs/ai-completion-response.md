# Risposte AI sicure e limitate — v0.11.82, issues #123/#124

BookWriter invia richieste esplicite OpenAI-compatible a `POST /chat/completions` per scrivere o revisionare libri. I provider sono servizi esterni: una risposta HTTP 200 non è automaticamente attendibile né autorizza la modifica del romanzo.

## Dimensione e completezza

La risposta viene letta progressivamente fino a **2.000.000 byte** per l'intero JSON (non soltanto per la prosa). Il client controlla `Content-Length` quando presente, ma misura sempre i byte realmente ricevuti. Se il corpo è maggiore, se manca lo streaming limitabile, se il MIME contraddice il JSON, o se il JSON/UTF-8 è corrotto, l'intera risposta viene rifiutata. Non viene conservata una parte apparentemente valida del testo né troncato un capitolo per adattarlo al limite.

L'attesa **prima degli header** di `POST /chat/completions` ha ora una deadline distinta, configurata per ciascun endpoint: **300 secondi (5 minuti) per default**, regolabile da 60 a 1800 secondi nelle Impostazioni → Endpoint OpenAI-compatible → «Attesa massima header AI (secondi)»; richiede il pulsante «Salva impostazioni». Le inferenze editoriali complesse possono essere più lente: seleziona deliberatamente una soglia più lunga se serve. I backup completi conservano la scelta, i precedenti privi del campo usano 300 s. La deadline usa AbortController anche se il fetch non risponde mai, non effettua retry e non modifica il manoscritto. La lettura del corpo ha un timeout separato di **60 secondi dal ricevimento degli header**. La richiesta può sempre essere interrotta dall'autore tramite la pausa/cancellazione già disponibile: l'interruzione ha priorità rispetto al timeout. Non ci sono retry automatici; eventuali tentativi successivi richiedono la supervisione prevista dall'autopilot.

## Consumi e recupero

Quando il JSON completo contiene `usage` valido, il ledger conserva i token dichiarati anche se il contenuto editoriale non supera la validazione. Se la risposta è stata **rifiutata prima del parsing** per limite, timeout o dati non validi, non è lecito dichiarare i token pari a zero: il consumo reale è **sconosciuto**, anche se il provider potrebbe avere fatturato una generazione. Il budget locale deve rimanere conservativo.

Gli errori mostrano la categoria del problema in italiano, non il corpo HTTP, credenziali, prompt o dettagli del manoscritto. Il canone, scene, giudizi di revisione e congelamenti rimangono invariati dopo un rifiuto. Questa protezione non garantisce la correttezza fattuale o narrativa del testo e non è un limite di costo imposto al provider.

Riferimenti: [ADR 0117](../ADR/0117-ai-header-deadline.md), [issue #124](https://github.com/KeyserDSoze/BookWriter/issues/124), [ADR 0116](../ADR/0116-bounded-ai-completion-response.md), [issue #123](https://github.com/KeyserDSoze/BookWriter/issues/123), [limiti budget](ai-budget-price-snapshots.md).
