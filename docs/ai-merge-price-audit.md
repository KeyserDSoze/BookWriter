# Tariffe delle fusioni AI riuscite — BookWriter v0.11.77

Quando chiedi a BookWriter di fondere due versioni di una scena, il modello può produrre una **bozza** da revisionare prima dell'eventuale approvazione autore. La chiamata può consumare token AI anche se la bozza non diventa mai parte del manoscritto.

## Correzione del registro

Dalla v0.11.77 anche un tentativo di fusione **riuscito** conserva, nell'Activity finale, la tariffa di input/output che avevi configurato **prima della chiamata**. L'Activity iniziale e quella conclusiva hanno lo stesso ID: il salvataggio non moltiplica le chiamate né raddoppia la spesa.

Prima della correzione, quando la bozza veniva salvata, l'audit perdeva la tariffa storicizzata; una modifica successiva del listino poteva far variare la stima del costo della fusione già completata.

## Cosa aspettarsi

- L'Activity di una fusione AI riuscita registra i token osservati, il modello, lo stato `succeeded` e la tariffa manuale storicizzata. Un cambio di prezzo aggiorna soltanto il preventivo delle **nuove** richieste. Tornando alla Dashboard da Archivio, la stima rilegge subito le attività salvate, senza richiedere un reload manuale.
- Una bozza **manuale** non contiene prezzi AI e non conta come richiesta a pagamento.
- Una bozza AI salvata rimane `proposed`: non cambia il canone, non approva automaticamente la fusione e non fa un push GitHub.
- I record vecchi **senza** uno snapshot tariffario restano segnalati come stime legacy basate sul listino corrente; non si inventano prezzi passati.

La tariffa è dichiarata dall'autore e la spesa rimane una **stima**, non una fattura. Verifica prezzi reali, consumi fatturati, caching ed eventuali costi supplementari nel portale del provider.

[ADR 0109](../ADR/0109-successful-ai-merge-price-audit.md) · [Issue #114](https://github.com/KeyserDSoze/BookWriter/issues/114) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
