# Freeze editoriale: validare di nuovo il giudizio prima del riassunto — v0.11.79

Dopo che sette specialisti e cinque lettori hanno verificato tutti i segmenti di un capitolo, il direttore editoriale registra una decisione **per ogni rilievo** e indica se le critiche vengono respinte o richiedono una correzione. Il congelamento del capitolo è possibile solo in assenza di remediation accettate.

## Perché serve

Un file ZIP importato, un vecchio checkpoint o un dato alterato nel browser può contenere tutti i 12 rapporti correnti ma un campo `judgment.verdict=freeze` non accompagnato dalla matrice completa delle decisioni. Prima della v0.11.79, lo stage `summary` controllava soltanto il verdetto testuale: il sistema poteva sintetizzare o congelare ignorando il giudizio effettivo.

## Controlli

Prima di ogni segmento di riassunto, e **nuovamente prima del suo salvataggio**, BookWriter rilegge tutta la matrice dei 12×N report e le prove correnti. Rivalida schema e data del giudizio, una decisione per ogni finding, la coerenza fra rifiuti e proposte di riscrittura, oltre alle verifiche critiche di conflitti fra correzioni e fonti/storie precedenti quando presenti. Il verdetto risultante deve essere effettivamente **freeze**. Cursori di riassunto fuori intervallo o riprese parziali prive delle sinossi progressive sono respinti.

Una fase sana già iniziata continua normalmente; nessuna revisione aggiuntiva viene chiesta ai modelli solo per questo controllo locale. Non si modifica il contenuto narrativo.

## Se il checkpoint non è valido

Il pannello **Redazione multi-agente** mostra il motivo e offre **Recupera checkpoint e ricomincia**. L'autore conferma esplicitamente l'operazione: BookWriter salva nell'archivio locale il ciclo precedente completo di giudizio, rapporti e riassunti e crea una nuova review da zero. Non ripristina o cancella la prosa corrente, non congela il capitolo, non esegue chiamate AI durante il recupero e disabilita l'autosync per consentire un riesame consapevole.

La verifica non certifica la **verità letteraria** del giudizio: un direttore può respingere formalmente ogni rilievo ed essere comunque nel torto sul significato della storia. Il controllo assicura che una decisione non sia stata saltata, persa o trasformata implicitamente in un freeze.

[ADR 0111](../ADR/0111-saved-freeze-judgment-and-summary-gate.md) · [Issue #116](https://github.com/KeyserDSoze/BookWriter/issues/116) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
