# ADR 0154 — Testo AI sempre visibile, conservazione temporanea impostabile, senza scadenza e GitHub facoltativi

- Stato: accettato — **supera la parte «consenso» di ADR 0134 (punto 4) e ADR 0152 (punto 1)**; non modifica i gate canonici
- Data: 2026-11-14
- Versione: 0.15.0
- Integra ADR 0134, 0136, 0138 e 0152.

## Contesto

Il riquadro in basso a destra diceva «Abilita l'ispezione per vedere il testo dalle prossime richieste». L'autore non capiva cosa fosse né dove si abilitasse, e aveva ragione: la sola casella «Ispezione locale richieste AI» mescolava **due cose diverse**.

1. **Guardare** il testo mentre il modello lo scrive (risposta e reasoning). È ciò che serve per capire cosa sta succedendo. Non richiede di salvare niente.
2. **Conservare** richiesta e risposta per rileggerle dopo. Questo sì contiene il testo del romanzo e i segreti narrativi.

L'autore ha chiesto: il testo in arrivo si vede **sempre**; salvare le conversazioni è una spunta opzionale che, se attiva, può portarle su Git insieme al libro; quando non sono salvate si tengono gli ultimi 20 task e si cancellano i vecchi dopo 10 giorni; tutto **impostabile**, anche a mezz'ora, ma le scritte su cosa sta succedendo devono comparire comunque.

## Decisione

1. **Anteprima live sempre attiva.** Risposta e reasoning in arrivo si accumulano in RAM (stessi limiti: 120.000 caratteri risposta, 20.000 reasoning, coda 4.000) e si mostrano in Dashboard, nel riquadro fisso e in Attività senza alcun consenso. Resta provvisoria, mai canonica; nessuna chiamata, persistenza o divulgazione in più. Il campo `LiveAiTrace.inspect` non esiste più.
2. **Salvataggio temporaneo di default.** Ogni task salva il prompt prima della richiesta e la risposta alla fine (anche parziale, anche dopo un errore) in IndexedDB `meta`: `ai-trace:<activityId>` (testo) e `ai-trace-meta:<activityId>` (`{activityId,bookId,createdAt,kept}`), **nella stessa transazione** e con il controllo di attualità subito prima della scrittura. È **best effort**: un disco pieno non ferma mai un task già autorizzato.
3. **Scadenza impostabile.** Si tengono al massimo `maxTasks` conversazioni temporanee (default **20**, 1–500) e nessuna più vecchia di `maxMinutes` (default **10 giorni**; 5 minuti–365 giorni; menu da 30 minuti a 90 giorni). Vale il limite che scatta per primo. La potatura legge **solo i metadati**, mai i testi, e non cancella mai una richiesta ancora in corso né una conversazione conservata. Parte all'avvio, ogni 5 minuti, a fine task e subito dopo una modifica delle impostazioni. La politica è sempre letta dalle impostazioni **salvate**: all'avvio la pagina ha ancora i valori di fabbrica e potare con quelli cancellerebbe cose che l'autore ha scelto di tenere.
4. **Conservazione senza scadenza** (`keepAiConversations`, default off, dai prossimi task). Le conversazioni marcate `kept:true` non si cancellano da sole. Chi aveva attivato l'ispezione nelle versioni ≤ 0.13 (`inspectAiRequests`) resta in «conserva» e le sue tracce, prive di metadati, vengono adottate come conservate (`adoptLegacyAiTraces`): ciò che l'autore aveva scelto di tenere non sparisce per sbaglio.
5. **GitHub, un secondo consenso** (`syncAiConversationsToGitHub`, default off, attivabile **solo** dopo la conservazione senza scadenza, con conferma e avviso su repository private). Nel push si scrivono `.bookwriter/conversations/<activityId>.json` e `.bookwriter/conversations/index.json` con le sole conversazioni **conservate di quel libro**, dalla più recente, fino a 6 MiB e 400 file, misurati con la stessa grandezza che usa il controllo dei 12 MiB del push; **mai una conversazione a metà**; l'indice dichiara quante sono rimaste fuori. I percorsi sono nel manifest. Si rimuovono dalla repository **solo** i percorsi che BookWriter stesso ha scritto (`isConversationPath`) quando non vanno più inclusi. `project.json` e `activities.json` non le contengono, quindi lo snapshot resta lossless.
6. **«Cancella tutte le conversazioni».** Cancella testi e metadati (temporanei e conservati), svuota il testo in memoria e incrementa la generazione, così nessuna richiesta già partita può salvare dopo. Il testo nuovo della richiesta in corso **ricompare** (`previewClearedAt` lo dichiara). Le copie già scritte su GitHub non si toccano.
7. **Solo dispositivo.** Le quattro preferenze non entrano mai nel profilo cloud (ADR 0153) né nello ZIP.
8. **Pulizia di un testo falso.** In Impostazioni restava «Login cloud non ancora attivi in questa versione» dopo la 0.14.0: rimosso.

## Conseguenze e limiti

- 20 task sono pochi per una revisione di capitolo (una tornata completa fa più di 13 chiamate): per questo il numero è impostabile fino a 500.
- Spazio: una conversazione arriva a ~360.000 caratteri; 20 task fino a ~7 MB, 500 fino a centinaia di MB e alla quota del browser. Un errore di quota non blocca i task.
- **Su Git le conversazioni contengono testo del romanzo e segreti narrativi.** Cancellarle dopo non le toglie dalla cronologia. Usare solo repository private; il push resta bloccato per repository pubbliche senza consenso esplicito, come prima.
- Il push non parte da solo per le sole conversazioni nuove: viaggiano con il prossimo push del libro.
- Le conversazioni su Git sono **solo scritte**: BookWriter non le rilegge in import o aggiornamento. Servono a consultarle e archiviarle.
- Potatura tra schede: un'altra scheda potrebbe cancellare il prompt salvato di un task in corso altrove se più vecchio della scadenza; la risposta, a fine richiesta, riscrive la conversazione intera.
- Chiavi API, PAT e credenziali non fanno mai parte di richiesta o risposta e non vengono registrate.

## Verifiche

Vitest: politica (default, legacy, clamp, mezz'ora), calcolo delle scadenze (ordine, età, limite per primo, conservate e in corso mai cancellate), salvataggio atomico e con fence, adozione legacy, potatura, «cancella tutto» che non tocca altre chiavi, raccolta delle conservate per GitHub con budget, file di conversazione e indice (budget, ID non sicuri, altro libro), push completo con GitHub finto (default senza conversazioni, due spunte, snapshot lossless, rimozione dei soli file propri, limite di 12 MiB con 20 conversazioni grandi), task che prosegue con disco pieno, preferenze fuori dal profilo cloud. Playwright desktop e mobile: testo visibile subito senza impostazioni, nessun invito ad «abilitare», cancellazione durante lo stream, impostazioni di conservazione persistenti e dipendenza della casella GitHub.
