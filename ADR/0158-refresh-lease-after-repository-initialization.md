# ADR 0158 — Verifica del blocco aggiornata dopo l'inizializzazione della repository

- Stato: accettato
- Data: 2026-11-14
- Versione: 0.17.1
- Integra ADR 0156, 0075 e 0079; non cambia il protocollo del lease o i gate editoriali.

## Problema riprodotto

Un libro già scritto localmente può essere associato a una repository ancora senza rami. Aprendo Archivio, la verifica periodica del lease può ricevere HTTP 409 prima dell'inizializzazione. Il collegamento guidato crea poi il file tecnico e conferma il ramo, ma se libro, owner, repository e branch sono gli stessi, le dipendenze della verifica React non cambiano. Rimane quindi visibile il vecchio errore fino al controllo periodico successivo o al clic manuale. Anche la scheda di anteprima conserva il vecchio stato «vuota».

Inoltre il messaggio finale raccomandava «usa Sincronizza» anche quando il primo invio era correttamente bloccato da un capitolo non ancora congelato. Questa distinzione è importante per chi collega un manoscritto già avviato sul dispositivo: il collegamento non pubblica il testo e non equivale al superamento della redazione.

## Decisione

1. Dopo un collegamento riuscito, anche alla stessa destinazione, un evento esplicito aggiorna la verifica del lease: stato `checking`, rimozione dei dati precedenti e nuovo GET. L'effetto precedente viene invalidato, quindi una sua risposta tardiva non può sostituire il risultato successivo al collegamento. Il percorso manuale usa lo stesso aggiornamento.
2. La verifica nuova continua a essere reale: **mai convertire HTTP 409 in blocco assente** e mai dichiarare il libro libero perché la repository è stata inizializzata. Solo il percorso corrente, compresi 404 e controllo del clock, può stabilirne lo stato. Nessuna scrittura o acquisizione del lease da questo aggiornamento UI.
3. Dopo il successo, l'anteprima non dice più «repository vuota»: il caso d'uso ha già ricontrollato il ramo inizializzato e la destinazione disponibile. Non si inventa un commit sincronizzato o una baseline del manoscritto.
4. `githubPublicationBlocker` descrive, senza modificarli, i gate già esistenti: scene fuse da approvare, revisione in corso, ciclo editoriale o capitoli scritti non congelati. Il pulsante resta disabilitato e il motivo è visibile. La raccomandazione di sincronizzare compare soltanto se non c'è questo blocco editoriale.
5. Nessuna modifica a prosa, memoria, audit, checkpoint, freeze, autorizzazioni, autosync, PAT o protocollo GitHub. L'inizializzazione resta il solo file neutro dell'ADR 0156. Non si allenta la protezione per consentire un primo push di capitoli non approvati.

## Verifiche

Il test Playwright desktop/mobile riproduce prima il fallimento con HTTP 409 ricevuto mentre la repository è vuota, libro già collegato, scena canonica, memoria e redazione locale in corso. Dopo il fix verifica una nuova lettura immediata, l'eliminazione della segnalazione obsoleta, il motivo del blocco editoriale e l'uguaglianza del libro prima/dopo (esclusi i soli metadati di collegamento e revisione). Ulteriori casi: vecchia risposta 409 ritardata dopo una lettura nuova riuscita; 409 ancora presente alla lettura nuova che deve restare errore, anche con verifica manuale. Zero POST del lease, un solo PUT tecnico. Vitest su descrizione dei gate e immutabilità.

Questo riproduce un difetto del client, non certifica lo stato della repository privata dell'autore. Un 409 che persiste dopo una nuova verifica resta un problema distinto da diagnosticare, senza presumere assenza di altri writer.
