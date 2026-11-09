# Integrità del giudizio editoriale prima del repair (v0.11.72)

Quando il direttore editoriale ha valutato i rapporti, BookWriter salva un giudizio con una decisione **per ogni rilievo**, indicando se accettare o respingere la remediation. Dopo un backup ZIP, un reload o un'interruzione, questi dati potrebbero risultare incompleti o incongruenti.

## Controlli della nuova versione

Il sistema verifica che il giudizio salvato sia valido e che nessun rilievo sia stato dimenticato, duplicato o inventato. Ogni correzione accettata deve avere una remediation concreta. Prima di chiamare il modello di riscrittura, la prova narrativa della **scena da correggere ora** deve ancora trovarsi nello stesso segmento.

Se altre scene sono già state correttamente riscritte dal processo, i loro vecchi estratti **possono non coincidere più**: non sono un motivo per fermare da soli il prossimo repair. La nuova regola protegge i dati del giudizio senza ripristinare le correzioni già applicate.

Se il checkpoint è invalido, il pannello presenta **Recupera checkpoint e ricomincia**. La procedura richiede il consenso autore, archivia integralmente il giudizio precedente e ricomincia dai dodici revisori soltanto alla successiva pressione di **Riprendi**. Non modifica la prosa, né avvia richieste AI durante il controllo o il recupero. È consigliato esportare prima un backup ZIP.

**Limite:** validare forma, provenienza e copertura del giudizio non significa che il direttore abbia interpretato correttamente una scena, che la fonte storica sia vera o che il testo prodotto sia di qualità.

[ADR 0104](../ADR/0104-saved-editorial-judgment-integrity.md) · [Issue #109](https://github.com/KeyserDSoze/BookWriter/issues/109) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
