# Collegare due conoscenze della stessa informazione — v0.11.17

Due personaggi possono parlare di una lettera, di un delitto o di un segreto, ma **non per questo sanno la stessa cosa**. BookWriter permette all'autore di confrontare due citazioni già attestate e di dichiarare esplicitamente se, secondo lui, riguardino **la stessa informazione** o **informazioni diverse**.

## Come usare la funzione

Apri il libro e vai a **Indice eventi candidati → Conoscenze interpretate dall'autore → Collegare informazioni fra personaggi**. Servono almeno **due decisioni knowledge correnti** di **personaggi con nomi distinti**, fondate su scene canoniche congelate e menzioni prima confermate dall'autore. Il sistema mostra due menu separati con capitolo, scena, nome e citazione: scegli **prima** e **seconda conoscenza**, verifica entrambe le prove, scrivi una motivazione di 20–650 caratteri e seleziona **Conferma stessa informazione** oppure **Conferma informazioni differenti**.

L'autore conferma la propria interpretazione con un avviso. Una nuova scelta rettifica la precedente senza eliminarla. Se una fonte viene modificata, riaperta, riattestata o reinterpretata, il collegamento diventa **storico/non corrente** finché l'autore non conferma una nuova coppia.

## Che cosa significa il confronto

Il riepilogo mostra entrambe le citazioni e, quando ci sono, i relativi momenti d'accesso annotati nella v0.11.16. **Non interpreta l'ordine dei capitoli come tempo della storia**. Anche se due personaggi sanno la stessa notizia, non è provato che A l'abbia comunicata a B, che il secondo gli creda, che la notizia sia vera oppure che ci sia una contraddizione.

Le relazioni sono **solo a coppie**: se Mara ed Elio parlano della stessa cosa, ed Elio e Nina parlano della stessa cosa, il sistema **non presume** automaticamente che Mara e Nina si riferiscano allo stesso contenuto. Per un'ulteriore coppia serve un'altra decisione esplicita dell'autore. Il software non deduce alias, catene di trasmissione, confronti semantici o fatti canonici.

## Avvisi su tre scelte già confermate (v0.11.18)

Quando esistono **tutti e tre** i confronti A/B e B/C «stessa informazione» ma A/C «informazioni differenti», il pannello segnala una possibile incoerenza nelle **decisioni dell'autore** con le tre citazioni correnti. Le prime due coppie da sole **non** generano la terza. La segnalazione è soltanto locale, consultiva e scompare dopo una rettifica o l'invalidazione delle fonti. Vedi la [guida agli avvisi](knowledge-topic-triangle-advisories.md) e ADR 0051.

## Privacy, backup e sincronizzazione

Le nuove relazioni e motivazioni sono **private ai modelli AI**. Nemmeno il precedente opt-in per condividere con Continuità, Timeline, Segreti, Voce o Giudice critico le semplici classificazioni delle conoscenze autorizza a divulgare il collegamento. Non viene avviata alcuna richiesta AI quando l'autore salva la relazione, e il canone, la memoria e i segreti restano invariati.

Il salvataggio usa Web Locks e controllo delle revisioni, disabilita l'autosync GitHub e cancella la coda di sincronizzazione. Lo storico compare nei backup ZIP, validati in modo rigoroso; un archivio importato **non autentica** le scelte dell'autore. **Un push GitHub manuale o un ZIP condiviso può divulgare spoiler e note private**.

Riferimenti: [ADR 0050](../ADR/0050-author-pairwise-knowledge-subject-links.md), [tempi delle conoscenze](knowledge-timing-registry.md), [consensi ai revisori](knowledge-sharing-consent.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
