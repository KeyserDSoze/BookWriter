# Risposta AI vuota e costi osservati — BookWriter v0.11.75

Un provider OpenAI-compatible può rispondere con **HTTP 200** e un oggetto JSON valido, ma senza alcun testo utile: ad esempio `choices[0].message.content: ""` o soltanto spazi. La generazione editoriale deve **fallire** e non scrivere nel manoscritto. Se lo stesso JSON include `usage`, tuttavia, i token possono essere stati utilizzati.

Dalla v0.11.75 BookWriter tratta separatamente due fatti:

- **Testo non approvabile:** il libro conserva la scena originale, il report non viene aggiunto e il workflow si ferma con errore; una fusione AI non produce bozza.
- **Usage già comunicato:** i contatori input/output **validi e presenti** sono salvati nell'Activity `failed/cancelled` e nella stima del budget, anche quando la risposta non può diventare un `ModelAnswer`.

Se il provider risponde senza usage, con usage parziale o invalido, oppure con errore HTTP, rete o JSON non decodificabile, BookWriter **non inventa consumi**. Il blocco preventivo su informazioni incerte rimane attivo. Un conteggio riportato è una stima per tariffe inserite dall'autore, **non** il totale fatturato.

Nessuna risposta vuota può canonizzare prosa, approvare un finding o autorizzare una nuova chiamata AI automatica. Il funzionamento offline del libro e le decisioni dell'autore restano invariati.

[ADR 0107](../ADR/0107-empty-provider-response-usage.md) · [Issue #112](https://github.com/KeyserDSoze/BookWriter/issues/112) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
