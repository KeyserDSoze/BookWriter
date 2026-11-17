# ADR 0165 — Salvataggio continuo su GitHub del libro a metà lavoro

- Stato: accettato, preparazione locale
- Data: 2026-11-17
- Versione preparata: 0.30.0
- Sostituisce, per i soli blocchi sul salvataggio, le regole degli ADR 0005–0008 (sync manuale e autosync «ai checkpoint canonici») e 0158 (`githubPublicationBlocker` come presentazione dei gate editoriali). Integra ADR 0082–0088 (ACK, intento durabile) e 0164.

## Problema

GitHub era pensato come copia dei soli capitoli **congelati**: finché un capitolo era in redazione o in revisione, «Sincronizza» e l'autosync rifiutavano («Completa la redazione del capitolo in corso prima di pubblicare»). Ma un libro lungo passa giorni in quello stato, con mondo, schede, memoria, registro dei compiti e il ciclo editoriale già prodotti: tutto lavoro che esisteva solo in IndexedDB di un PC. Spostare il lavoro su un altro PC richiedeva uno ZIP a mano, e il lavoro non era al sicuro.

## Decisioni

1. **Si salva tutto, a qualunque punto del lavoro.** Un capitolo non congelato, un ciclo editoriale con rapporti a metà, una revisione retroattiva in corso e una scena pianificata o in bozza non bloccano più né «Sincronizza» né l'autosync. Nulla cambia nel formato: ogni scena e capitolo portano già `canon: planned|draft|canon` nel Markdown, e lo stato completo (ciclo, memoria, registro dei compiti, modifiche) è in `.bookwriter/project.json` e `activities.json`, già validati in import. Un libro salvato a metà lavoro e riaperto su un altro PC è identico (test di andata e ritorno).
2. **Unico blocco rimasto: scena fusa in attesa di conferma.** `githubPublicationBlocker` restituisce solo questo caso (le scene fuse dall'AI che l'autore non ha ancora confermato nel Lettore non lasciano il dispositivo). `pushGitHubBook`, `enqueueCheckpoint`, `setBookAutoSync`, l'Archivio e l'indicatore del Dashboard usano la stessa funzione. Lease del writer, fast-forward `force:false`, repository pubblica con consenso, CAS e ACK atomico restano invariati.
3. **Dopo ogni compito riuscito.** `saveBookAndActivity` accoda una richiesta per qualunque compito `succeeded` (prima solo `outline`/`chapterReview` senza ciclo attivo); `saveBook` con `queueSync` accoda anche le modifiche dell'autore. Resta **una sola voce per libro** (`revision++`), con l'`operationId` che ruota all'ACK se nel frattempo è arrivato altro.
4. **Distanza fra salvataggi.** Ogni salvataggio costa alcune richieste di scrittura, che GitHub limita per ora insieme al battito del blocco di scrittura (circa 5 al minuto): salvare dopo ogni compito di una corsa veloce le esaurirebbe. `AUTO_SAVE_MIN_INTERVAL_MS` = 2 minuti fra due salvataggi automatici dello stesso libro (da `remote.lastSyncAt`; una data nel futuro non trattiene). Ciò che viene saltato non si perde: lo riprende il compito successivo, il passaggio periodico di 15 secondi, la fine della corsa o «Salva ora».
5. **Fine della corsa e «Salva ora».** Quando l'autopilot si ferma, finisce o va in errore, `startRunner` chiama `saveToGitHubNow`: accoda se GitHub non ha l'ultima revisione (`enqueueIfUnsaved`, nella stessa transazione della lettura) e svuota la coda con `force` (ignora distanza e attesa dopo un errore; una coda `blocked` resta bloccata e va sbloccata dall'autore). «Salva ora su GitHub» (Archivio, Dashboard, barra di stato) usa lo stesso percorso e funziona anche mentre l'autopilot lavora, perché l'invio automatico non prende il lock di scrittura. Un `force` chiesto mentre un passaggio è in corso non si perde: parte subito dopo.
6. **Il libro cambia durante la preparazione.** Prima era un `RemoteConflict` non ritentabile che bloccava la coda; con un salvataggio dopo ogni compito sarebbe diventato frequente. Ora `LocalBookChanged` rimette in coda il tentativo senza contarlo come errore (`deferAttempt`, 5 secondi). L'ACK atomico già conservava la revisione più recente.
7. **Interfaccia.** L'interruttore è «Sincronizzazione automatica dopo ogni compito» (attivabile anche a metà lavoro, con il primo salvataggio già fatto); dopo il primo salvataggio manuale l'app lo suggerisce e mostra le dimensioni (`MiB su 12`). La barra di stato delle pagine del libro dice «GitHub: salvato alle HH:MM / modifiche non ancora salvate / in corso / bloccato» e, se c'è qualcosa da salvare, offre «Salva su GitHub». Il pulsante manuale diventa «Salva ora su GitHub» con l'autosync acceso.

## Spostare il libro da un PC all'altro

Sul PC di partenza: fermare l'autopilot (il salvataggio finale parte da solo) o premere «Salva ora», e controllare «GitHub: salvato». Sull'altro PC: libro nuovo → Archivio → «Importa un libro remoto», oppure, se il libro c'è già e non è stato toccato, Libreria → «Aggiorna da GitHub» (fast-forward). Poi controllare chiavi e modelli (non viaggiano) e «Riprendi»: il libro arriva «In pausa». Il blocco di scrittura del PC di partenza si rilascia alla pausa; se si chiude solo la pagina scade in due minuti (ADR 0164).

## Limiti

- **Dimensione.** L'intera proiezione viaggia in un solo `POST /git/trees` con i contenuti inline, limitato a 12 MiB. `.bookwriter/activities.json` cresce con ogni compito (contiene l'output di ciascuno) e `project.json` con i rapporti del ciclo. Un libro lungo può raggiungere il limite: l'errore dice di fare un backup ZIP e la coda si blocca con quel messaggio (senza nuovi tentativi inutili). Non è risolto qui: la strada è dividere `activities.json` e caricare solo i blob cambiati (da fare in un ADR a parte). La dimensione dell'ultimo invio compare dopo il salvataggio manuale.
- Il salvataggio automatico avviene solo con la pagina aperta; il salvataggio finale non può partire se si chiude il browser durante la corsa (l'ultimo compito dopo l'ultimo salvataggio resta solo locale).
- Più cronologia Git: un commit per salvataggio (al massimo uno ogni 2 minuti per libro). La cronologia è l'unica forma di storico; nessun squash o force.
- Il testo del romanzo, i segreti narrativi e il registro dei compiti in repository **pubbliche** restano visibili: invariato il consenso esplicito.
- Un libro con una scena fusa non confermata non si salva (messaggio dedicato).

## Verifiche

Vitest: `githubPublicationBlocker`; `enqueueCheckpoint` per ogni compito riuscito e non per i falliti, a metà lavoro e con scena fusa; `enqueueIfUnsaved` in tutti gli esiti; `deferAttempt` e `markAttempt(force)`; coordinatore (distanza di due minuti, data nel futuro, `force`, coda bloccata, `LocalBookChanged`, `force` durante un passaggio, `saveToGitHubNow`); autosync attivabile a metà lavoro; andata e ritorno di un libro con capitolo non congelato, ciclo editoriale, mondo e compiti verso un altro PC. Playwright desktop/mobile: salvataggio manuale a metà lavoro, attivazione dell'autosync con un ciclo aperto, modifica dell'autore → «Salva su GitHub» → stato e contenuto su GitHub.
