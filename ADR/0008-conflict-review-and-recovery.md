# ADR 0008 — Confronto visuale dei conflitti e recupero locale con due copie di sicurezza

- **Stato:** Accettato per v0.6.0 (in PR)
- **Data:** 2026-11-05
- **PR:** [#14](https://github.com/KeyserDSoze/BookWriter/pull/14)
- **Issue:** [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#10](https://github.com/KeyserDSoze/BookWriter/issues/10)
- **Predecessori:** ADR 0005, 0006, 0007

## Problema

Dopo un conflitto del ramo GitHub, l'autosync si blocca conservando correttamente IndexedDB, ma l'autore non può esaminare né recuperare le differenze. Forzare il push cancellerebbe modifiche remote; importare con lo stesso ID è intenzionalmente vietato.

## Decisione

1. Il browser legge **solo in GET** `.bookwriter/project.json` e `.bookwriter/activities.json` dal commit HEAD del ramo narrativo configurato. Se disponibile, legge anche il commit SHA dell'ultima sincronizzazione come **baseline immutabile**. I file provengono dalla stessa revisione, non da richieste senza ref. Rifiutare libri con ID diverso.
2. Il confronto è strutturato: campi editoriali, capitoli aggiunti/eliminati, metadati capitolo, singole scene (ID stabili), personaggi, luoghi, fazioni, oggetti, segreti, timeline e stato narrativo corrente. Se esiste una baseline, distinguere **solo locale**, **solo remoto**, **entrambi**; altrimenti mostrare differenze senza attribuirne la provenienza.
3. **Nessun merge automatico di prosa o canone.** Ogni differenza propone per default **versione locale**; l'autore può selezionare espressamente **versione GitHub**. L'assenza di un elemento in una versione equivale a potenziale eliminazione e va mostrata con avviso.
4. L'autore può anche salvare lo snapshot GitHub come un **nuovo libro separato**, con nuovo UUID, activity ID rigenerati, `remote: undefined`, status paused. Non modifica mai il libro originale.
5. L'azione **Applica scelte con doppio backup** richiede conferma esplicita. In un'unica transazione IndexedDB `books + activities + outbox` crea (a) la copia locale completa, (b) la copia GitHub completa, (c) la versione risolta sullo **stesso bookId** del libro originale e (d) un log di audit. Se la transazione fallisce non si applica alcuna sostituzione.
6. Prima della transazione bisogna detenere sia il Web Lock del writer del libro sia il lock del worker autosync GitHub; rifiutare se uno è occupato o il browser non supporta Web Locks. Dopo un `GET HEAD` di conferma verificare ancora nel database il timestamp locale, la connessione remota e l'ultimo SHA conosciuto. Se il libro o il branch sono cambiati, bloccare la risoluzione e chiedere una nuova ispezione.
7. La risoluzione **non scrive nulla su GitHub**. Aggiorna soltanto la baseline locale al commit esaminato, imposta `autoSync: false`, elimina l'outbox precedente, mette il libro in `paused` e produce un messaggio che chiede la rilettura prima di un nuovo push **manuale**. Rimangono invariati PAT e API key in settings, che non vengono trasferiti nei progetti.
8. Non fondere lo stato operativo di due autopilot in modo cieco: `revision` e `currentSceneId` vengono azzerati; il runner torna a una fase sicura `prose` se esistono capitoli, altrimenti `brainstorm`. L'autore deve verificare continuità e memoria prima di riprendere.
9. Gli errori leggibili devono spiegare cosa fare. Nessun pulsante `force push`, nessuna cancellazione remota automatica. Le copie non hanno collegamento GitHub, così un loro avvio non può sovrascrivere involontariamente il repository originario.

## Limiti e rischi residui

- Le due copie sono conservate in **IndexedDB nello stesso browser**, non in un server né in una garanzia di backup. Serve esportare uno ZIP per protezione da pulizia storage o perdita dispositivo.
- Non viene generato automaticamente un diff di parola/per frase, né una riscrittura AI della soluzione; la scelta è per **unità narrativa** (per scena/entità/section). Se entrambe le versioni della stessa scena contengono passaggi preziosi, l'autore può leggere le due copie e impartire una revisione alla AI in seguito.
- La conferma di HEAD precede la transazione IndexedDB, ma non c'è un'operazione atomica tra GitHub e il browser. Se HEAD cambia subito dopo, il successivo push GitHub si bloccherà per SHA divergente, senza forzare.
- Se la baseline GitHub è stata eliminata o è illeggibile il confronto resta **a due versioni**, senza attribuzione automatica della provenienza.
- L'outbox viene disattivata dopo il recupero per non pubblicare risoluzioni non approvate. L'utente deve eseguire una sincronizzazione manuale, poi riattivare l'autosync.
- Un altro dispositivo potrebbe avere una copia locale non sincronizzata: il recupero protegge le versioni **visibili in questo browser e nel commit GitHub esaminato**, non versioni mai caricate da altri dispositivi.

## Verifiche di rilascio

- Test confronto base/locale/remoto, scene/entità/eliminazioni e protezione `__proto__`.
- Test IndexedDB di doppio backup, activity audit, outbox eliminata, autosync disattivata.
- Test negativo di HEAD remota mutata e revisione locale mutata dopo l'anteprima.
- Test di sola lettura GitHub per il confronto e ripristino: **zero POST/PATCH**.
- Playwright desktop/mobile con selezione di una differenza e verifica di tre libri distinti.
- Typecheck, Vitest, smoke, build e browser E2E verdi sulla HEAD della PR prima del merge.

## Evoluzioni successive

Visualizzazione diff parola/per frase, archivio ZIP remoto a checksum, ricerca/riconciliazione semantica assistita e gestione delle versioni di dispositivi ancora offline richiedono ADR separati.
