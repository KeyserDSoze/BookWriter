# Anteprima dei possibili passaggi fra due conoscenze — v0.11.19

Dopo aver dichiarato che due menzioni di personaggi distinti riguardano **la stessa informazione**, puoi cercare nel testo precedente delle frasi che descrivano una *possibile comunicazione* fra quei due nomi, senza chiedere niente a un modello AI.

## Utilizzo

Apri **Indice eventi candidati → Conoscenze interpretate dall'autore → Collegare informazioni fra personaggi** e individua una coppia corrente «Stessa informazione secondo l'autore». Premi **Esamina piste possibili**: il pannello mostra i due versi, A→B e B→A, con le menzioni del destinatario, eventuali frasi letterali, posizione, capitolo/scena e parole in comune. Puoi chiudere l'anteprima senza modificare il libro.

Per esempio, «Elio rivela a Mara che la lettera è falsa» può essere mostrata quando Elio e Mara hanno menzioni knowledge già confermate sul tema della lettera. Il sistema non deduce che Mara abbia realmente ascoltato o creduto Elio: il narratore potrebbe mentire, la frase potrebbe essere un sogno o i due nomi potrebbero riferirsi a persone diverse.

## Fonte dei risultati e copertura

- Sono necessari **due giudizi knowledge correnti** e un **link diretto e corrente `same_information`** dell'autore: due citazioni simili non bastano.
- Per ogni direzione, il filtro è su mittente e destinatario **esatti**; non vengono ricercati alias, pronomi o passaggi attraverso una terza persona.
- Si cercano solo scene canoniche di capitoli **già congelati e precedenti nel manoscritto** alla menzione del destinatario, non necessariamente precedenti nella cronologia del romanzo.
- Ogni verso esamina al massimo **240 scene**, i primi **6.000 caratteri** di ciascuna scena e le prime **12 formule** incontrate per scena. Mostra fino a **4 citazioni**, con numero di scene non scansionate e piste omesse; non è un indice completo.
- «Nessuna frase candidata trovata» **non dimostra** che la comunicazione non sia avvenuta. I dialoghi nello stesso capitolo, passaggi impliciti, flashback e sinonimi possono sfuggire.

## Privacy e modifiche

L'anteprima è solo locale e temporanea, non viene salvata né spedita ad agenti, giudice, servizi AI o GitHub. Non aggiorna la memoria, i segreti, i personaggi, i capitoli congelati, le autorizzazioni ai revisori, il registro delle relazioni o il canone. Se il collegamento viene rettificato in «informazioni differenti» o una fonte diventa obsoleta, l'anteprima non è più disponibile.

Le **decisioni sottostanti**, non questa analisi temporanea, possono già comparire nei backup ZIP e nei push GitHub manuali: valuta i possibili spoiler.

Riferimenti: [ADR 0052](../ADR/0052-knowledge-transfer-preview.md), [relazioni delle conoscenze](knowledge-topic-links.md), [piste della redazione](information-transfer-traces.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
