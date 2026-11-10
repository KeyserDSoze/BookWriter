# Risposte AI con parti non testuali — BookWriter v0.11.78

BookWriter accetta risposte OpenAI-compatible con `choices[0].message.content` come **stringa** oppure come **array interamente testuale** di oggetti `{type:"text",text:"..."}` (è consentito anche il campo `type` assente). Le parti sono unite nell'ordine ricevuto, senza convertirne implicitamente numeri o oggetti in prosa.

Se il provider restituisce in una risposta HTTP 200 e JSON valido parti `null`, immagini, oggetti con `text` non stringa, contenuti misti o una struttura dei messaggi malformata, BookWriter **rifiuta l'intera risposta**: non aggiorna scene, rapporti editoriali, canone o bozze di fusione.

I token input/output **validi effettivamente dichiarati** nel campo `usage` vengono tuttavia conservati nell'Activity fallita, con tariffa manuale già registrata prima del tentativo. Il messaggio di errore non contiene prompt, segreti, credenziali o contenuto restituito. Se il provider invia usage incompleto o inesistente, il budget conserva il blocco preventivo: nessun consumo mancante viene inventato né considerato zero.

Errori HTTP, rete o JSON non decodificabile **non** confermano usage. Non sono effettuati retry automatici: l'autore può valutare l'attività e decidere consapevolmente come riprendere. Una risposta HTTP 200 non dimostra che l'AI abbia prodotto prosa corretta o che il provider abbia effettivamente fatturato tutti i token.

[ADR 0110](../ADR/0110-provider-mixed-content-rejection-usage.md) · [Issue #115](https://github.com/KeyserDSoze/BookWriter/issues/115) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
