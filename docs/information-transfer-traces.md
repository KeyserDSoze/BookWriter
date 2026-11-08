# Possibili passaggi di informazioni fra personaggi — v0.11.13

Durante la review di un capitolo BookWriter può mostrare ai revisori alcuni **passaggi di informazione citati in scene precedenti**, per esempio una frase che dice che un personaggio racconta a un altro una notizia. È un controllo utile quando un revisore pensa che un personaggio «non possa sapere» qualcosa: un dialogo precedente potrebbe offrire una spiegazione alternativa.

## Cosa viene letto

Il software seleziona **massimo quattro menzioni letterali** da un campione locale di massimo **240 scene** di capitoli precedenti già congelati, cercando formule italiane esplicite come «Elio rivela a Mara che…». Il nome del destinatario deve comparire come parola intera nella scena corrente, con almeno un termine tematico condiviso. Ogni menzione è accompagnata da citazione, scena e capitolo, offset, versione del testo e termini comuni. Il sistema segnala quanti possibili candidati restano fuori dal limite.

La selezione non è un'analisi semantica: non segue pronomi, catene di confidenze o conoscenze implicite. **Una frase può essere una bugia, un sogno o una diceria.** Il risultato non attesta che un messaggio sia stato consegnato, ascoltato, creduto o compreso; non aggiorna il canone, i segreti o la conoscenza reale di alcun personaggio.

## Cosa vede il giudice

I quattro specialisti di continuità, timeline, segreti e voce dei personaggi ricevono le piste pertinenti nelle **chiamate AI già previste**. I cinque lettori ciechi non ricevono i nuovi estratti, né le annotazioni private dell'autore.

Quando il giudice valuta un finding `knowledge` ancorato alla scena attuale e ci sono piste pertinenti, deve classificare ciascuna pista come **possibile via d'informazione**, **non pertinente**, **racconto non attendibile** oppure **indeterminata**, con motivazione. Il resoconto nella dashboard mostra le disposizioni sotto **Esame dei possibili passaggi informativi**.

Se rimane una pista classificata come possibile o indeterminata, **il software blocca l'accettazione della correzione fondata su accesso impossibile**; il giudice può respingere la critica con motivazione. Se giudica tutte le piste non pertinenti o inattendibili, potrà valutare un intervento solo rispettando gli altri controlli sulla conoscenza della v0.11.12. Non significa che il software abbia provato l'assenza di comunicazioni; sono interpretazioni fallibili del modello.

## Anteprima privata fra due personaggi (v0.11.19)

Se l'autore ha già confermato direttamente che due menzioni knowledge riguardano la **stessa informazione**, può avviare a mano un'anteprima locale A→B e B→A con un filtro **esatto** su mittente e destinatario. La vista non cambia il filtro ordinario dei revisori, non introduce una rete di conoscenze e non convalida l'effettivo passaggio di una notizia. Consulta [la guida alle anteprime](knowledge-transfer-preview.md) e ADR 0052.

## Privacy, backup e limiti

I nuovi dati sono **effimeri e locali**, senza nuovo registro delle conoscenze da sincronizzare. I giudizi motivati vengono conservati nel normale storico editoriale e validati nell'import ZIP. Le fonti vengono rivalidate prima di qualunque nuova riscrittura, anche dopo un import. I capitoli futuri e le note private non sono inclusi nel nuovo pacchetto; non si effettuano chiamate AI aggiuntive, anche se i prompt possono diventare più lunghi.

La selezione è limitata a formule esplicite e non costituisce una mappa completa di chi sa cosa. Le omissioni e gli errori di interpretazione restano possibili: **l'autore conserva la decisione sul canone narrativo**.

Riferimenti: [ADR 0046](../ADR/0046-bounded-information-transfer-traces.md), [giudizio sulle conoscenze](knowledge-provenance-review.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
