# Divergenze fra revisori e giudice — v0.11.23

BookWriter controlla quando **due o più revisori indipendenti indicano correzioni differenti per la stessa citazione**. La funzione non trasforma un semplice report senza criticità in un voto contrario: ogni revisore valuta aspetti diversi del capitolo. Neppure due proposte differenti significano per forza che una sia sbagliata.

## Come leggere il confronto

Apri **Redazione multi-agente** e il dettaglio della tornata. Quando sono presenti segnalazioni pertinenti, compare **Correzioni alternative sulla stessa citazione**. Apri un gruppo per leggere la frase originale, i revisori coinvolti, le loro motivazioni e gli interventi suggeriti.

Il **giudice critico** deve scegliere una fra tre soluzioni, con spiegazione: **una sola modifica**, **nessuna modifica** oppure **più modifiche compatibili**. Deve inoltre indicare se considera le prove sufficienti, **quale elemento manca** e **quale controllo** aiuterebbe a sciogliere il dubbio.

Il prossimo controllo è *solo un suggerimento*. BookWriter non lo esegue in autonomia, non consulta nuove fonti, non chiama altri agenti e non corregge il romanzo sulla base di quel suggerimento.

## Cosa impedisce una correzione inappropriata

Il software confronta nuovamente il testo del capitolo e gli ID esatti dei finding:

- con una prova mancante o incerta (`unresolved`), **nessuna** proposta del gruppo può essere accettata;
- se il giudice sceglie una sola correzione, deve averne accettata esattamente una; se le respinge tutte, nessuna; per più modifiche compatibili, almeno due;
- non vengono accettati gruppi inventati, parziali, duplicati o divenuti obsoleti dopo modifiche del testo;
- per evitare un controllo incompleto, sono mostrati **massimo 6 gruppi** con **12 rilievi per gruppo**. Se la capienza è superata, i relativi finding non possono autorizzare una remediation prima dell'esame manuale.

Gli altri controlli sulla continuità, sulla conoscenza dei personaggi, sulle prove storiche e sui segreti **rimangono necessari** anche quando il giudice riconcilia un disaccordo. Il sistema rivalida il giudizio anche prima di una successiva riparazione, dopo resume o importazione di un backup.

## Piano riassuntivo delle verifiche (v0.11.24)

Apri [Piano verifiche editoriali](editorial-verification-plan.md) nella redazione: separa automaticamente i gruppi in attesa, con prova irrisolta, approvati, senza modifica e da rivalidare; conserva le tornate congelate **solo come storico**. La classificazione deriva dai giudizi esistenti: nessuna nuova richiesta AI o esecuzione automatica del controllo suggerito.

## Privacy e compatibilità

I cinque lettori ciechi continuano a lavorare in modo indipendente e non ricevono proposte degli altri revisori. Il contraddittorio compare solo **dopo** le loro verifiche, nel ruolo giudice. Non ci sono nuovi consensi AI, chiamate HTTP o nuove mutazioni automatiche del canone. I backup ZIP content/full contengono lo storico e validano rigorosamente la struttura; i vecchi ZIP senza questo campo restano leggibili. Le conclusioni del giudice non autenticano la verità della storia.

Riferimenti: [ADR 0056](../ADR/0056-editorial-recommendation-disagreements.md), [redazione multi-agente](editorial-board.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
