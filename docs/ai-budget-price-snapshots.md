# Tariffa storicizzata per richiesta AI — BookWriter v0.11.76

Quando configuri il prezzo di un modello in **Dashboard → Budget AI**, BookWriter lo esprime in euro per milione di token input e output. È un prezzo dichiarato dall'autore, non una tariffa verificata automaticamente sul provider.

## Cosa cambia

Dalla v0.11.76 ogni nuova chiamata AI conserva nel proprio registro una **copia della tariffa attiva** al momento della richiesta. La stima della spesa di quella chiamata si calcola sempre usando quei quattro campi (endpoint, modello, input/output €/milione), anche se più tardi cambi il listino. Questo vale anche per output rifiutati, richieste con usage mancante e bozze AI di fusione scena. Il testo non valido continua a non essere approvato.

Per esempio: una chiamata con 2.000 token input e 1.000 token output al prezzo di 3 €/milione input e 9 €/milione output ha una stima di **0,015 €**. Se poi aumenti il prezzo configurato a 6/12 €/milione, la stima della chiamata **già registrata resta 0,015 €**; solo le richieste successive usano la nuova tariffa.

## Chiamate precedenti alla nuova versione

I vecchi registri **senza tariffa storicizzata** non consentono di sapere quale prezzo valeva allora. Per compatibilità continuano a usare la tariffa attuale, ma il pannello mostra un avviso e il numero di righe valorizzate in questo modo: la loro stima può variare al cambio di prezzo. Non ricostruiamo né attribuiamo tariffe passate inventate.

Un record che presenta uno snapshot malformato, negativo o riferito a un altro endpoint/modello viene classificato come **senza tariffa valida**: con budget attivo le nuove richieste si fermano per sicurezza, senza applicare di nascosto il prezzo attuale. Lo stesso blocco conservativo rimane per token mancanti o parziali.

## Backup e limiti

Le tariffe per singola Activity sono salvate negli ZIP **content-only** e **full**, senza esportare credenziali API. I vecchi ZIP restano compatibili; un listino storico inserito in un archivio malevolo e invalido viene rifiutato. Un file ZIP modificato non è automaticamente autenticato: importare solo archivi affidabili.

La stima deriva dai token dichiarati dal provider e da una tariffa manuale. Non è un addebito certificato; tasse, cached tokens, cambi di valuta, altri costi e fatture provider possono differire. Il browser non implementa un limite rigido sui costi remoti.

[ADR 0108](../ADR/0108-price-snapshot-ai-budget.md) · [Issue #113](https://github.com/KeyserDSoze/BookWriter/issues/113) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
