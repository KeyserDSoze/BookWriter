# Recupero supervisionato di una redazione bloccata (v0.11.68)

## Quando usare il recupero

Se BookWriter mostra un errore di **checkpoint editoriale obsoleto, incompleto o fuori ordine** nelle fasi di revisione, giudizio o sinossi, la scheda **Redazione multi-agente** espone un avviso e il pulsante **Recupera checkpoint e ricomincia**. Il pulsante non appare quando un checkpoint attivo è coerente, quando l'autopilot è in esecuzione o quando la redazione segue la procedura speciale `repair/blocked`.

Il problema può nascere da un report legacy privo dell'impronta v0.11.67, da una scena cambiata dopo la lettura, da rapporti duplicati oppure da un processo interrotto che è passato a `adjudicate` senza 12 rapporti completi. Il recupero non attribuisce la colpa a un particolare agente AI.

## Procedura

1. **Salva un backup ZIP** del libro prima dell'operazione; conserva eventuali indizi di errori o rapporti precedenti.
2. Metti l'autopilot in pausa. Nel pannello leggi la motivazione del blocco e seleziona **Recupera checkpoint e ricomincia**.
3. Conferma la scelta nella finestra che avvisa: i **sette specialisti e i cinque lettori** saranno chiamati di nuovo dall'inizio. Puoi annullare senza modificare nulla.
4. Dopo conferma, il vecchio ciclo viene **conservato integralmente** nell'**Archivio recuperi editoriali** (data, motivo, rapporti, giudizio e tornate precedenti) e la nuova redazione torna al primo revisore. Il canone, la memoria, le scene e i capitoli già congelati **non vengono modificati**.
5. La sincronizzazione automatica GitHub è disabilitata, la vecchia outbox cancellata e una Activity registra il recupero. La nuova review **non invia chiamate AI** fino a quando non premi **Riprendi**.
6. Dopo una nuova revisione completa, valuta criticamente le conclusioni del giudice e le possibili remediation come prima. Non usare il vecchio checkpoint per approvare interventi o forzare il congelamento.

## Protezioni e limiti

Il recupero richiede Web Locks su libro/outbox, controllo ottimistico `updatedAt` e conferma dell'autore. Massimo **8** snapshot: quando l'archivio è pieno BookWriter si ferma per evitare cancellazioni silenziose. Gli archivi sono inclusi nel backup ZIP e consultabili localmente ma non sono certificazioni né firme del modello. Il comando non recupera automaticamente una scena in fase `repair`, non salva un canone malformato e non sostituisce il giudizio umano.

[ADR 0100](../ADR/0100-author-confirmed-editorial-checkpoint-recovery.md) · [Issue #105](https://github.com/KeyserDSoze/BookWriter/issues/105) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).

## Estensione v0.11.71

La fase `repair` non è più esclusa **quando la prossima correzione non può essere applicata in sicurezza**; una remediation sana continua. Le scene già riscritte sono preservate e la nuova review non è un rollback. [Guida dedicata](editorial-repair-recovery.md) e [ADR 0103](../ADR/0103-supervised-stale-repair-recovery.md).

## Estensione v0.11.79 — giudizio di congelamento non affidabile

In `stage=summary` un campo `verdict=freeze` privo della matrice completa delle decisioni non autorizza alcuna nuova sinossi o un `frozenAt`. Il controllo locale usa il medesimo validatore del direttore, la copertura 12×N corrente e un cursore di sintesi bounded; il pannello propone recupero **solo** quando il checkpoint non è riprendibile. L'archivio conserva l'intero giudizio precedente senza rollback di prosa, nessuna AI parte prima di Riprendi. [Guida](editorial-saved-freeze-judgment.md) · [ADR 0111](../ADR/0111-saved-freeze-judgment-and-summary-gate.md).
