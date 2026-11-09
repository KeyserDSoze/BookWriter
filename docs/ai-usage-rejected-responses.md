# Contabilizzare l'AI anche quando una risposta viene rifiutata (v0.11.74)

Un revisore può ricevere una risposta dal modello, ma scartarla perché non è JSON valido, contiene una citazione errata oppure arriva dopo un cambiamento del manoscritto. Un'analoga situazione si verifica nella fusione AI delle scene quando il testo è troppo lungo o il confronto remoto non è più attuale.

**Rifiutare la risposta non significa che la richiesta non sia stata fatturata.** Dalla v0.11.74 BookWriter registra nel ledger, prima della validazione editoriale, i token input/output effettivamente restituiti dal provider. L'attività resta **failed** o **cancelled**, ma il budget utilizza quei numeri osservati, senza trasformarli in una spesa immaginariamente sconosciuta.

## Cosa cambia

- La Dashboard continua a mostrare una **stima in EUR calcolata sui token osservati** e sulle tariffe che l'autore ha inserito: non è una fattura né un saldo.
- Un report editoriale invalido **non** diventa un rapporto approvato, una scena canonica o un draft AI. Il libro rimane nel checkpoint precedente e richiede una ripresa scelta dall'autore.
- Se il provider non invia usage, invia solo uno dei due conteggi, la rete fallisce o la richiesta viene interrotta senza risposta verificata, la spesa resta **incerta**. Con budget attivo BookWriter blocca conservativamente le chiamate successive.
- Il comportamento vale anche per le bozze AI di fusione scene. Non cambia il registro manuale né l'export.

La verifica del consumo deve restare distinta dalla validazione letteraria e da qualunque riconciliazione editoriale. I token comunicati non autenticano il testo prodotto né certificano fatturazione e tariffe.

[ADR 0106](../ADR/0106-provider-usage-before-editorial-validation.md) · [Issue #111](https://github.com/KeyserDSoze/BookWriter/issues/111) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
