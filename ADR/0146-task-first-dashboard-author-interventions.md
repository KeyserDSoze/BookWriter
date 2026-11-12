# ADR 0146 — Dashboard orientata al task, interventi registrati dell'autore e avvio da sinossi

- Stato: accettato
- Data: 2026-11-12
- Ambito: Dashboard, autopilot, revisione retroattiva, creazione libro, backup ZIP e proiezione GitHub

## Problema

Una revisione complessiva dell'applicazione ha evidenziato che:

1. Nella Dashboard l'autore non capiva **che cosa stava facendo** l'autopilot: il task era un titolo tecnico in una barra, mescolato a contatori di trasporto SSE; obiettivo, motivazione, posizione nel libro e prossimo passo erano nascosti in elementi chiusi. Il «prossimo passo» era solo il nome della fase.
2. **Intervenire** richiedeva pausa manuale e un pannello collassato durante l'esecuzione; l'unica azione possibile era una revisione retroattiva, rifiutata durante l'intera redazione di un capitolo (gran parte del lavoro). L'istruzione non era registrata come evento con data, passo in corso ed esito: diventava solo una stringa in `authorConstraints`.
3. La revisione retroattiva aveva difetti di flusso: se l'analisi d'impatto non trovava scene coinvolte venivano **riscritte tutte le scene canoniche**; due richieste consecutive potevano lasciare `phase:"revision"` senza revisione (errore bloccante) perché `beforePhase` diventava `revision`; una `rationale` vuota faceva ripetere all'infinito l'analisi (chiamate fatturabili); la «Finalizzazione» spendeva una chiamata AI il cui testo veniva scartato; la memoria narrativa non veniva riallineata dopo le riscritture.
4. Il libro poteva partire solo da un brief libero: nessun modo strutturato per fornire una **sinossi capitolo per capitolo** vincolante, né per fermarsi ad approvare il piano.
5. Lo scrittore non riceveva la fine della scena precedente (il `summary` era l'inizio della scena), con transizioni deboli fra scene; ogni prompt di scrittura rimandava tutte le critiche pre-piano (costo senza beneficio).

## Decisioni

1. **Pannello «Lavoro dell'autopilot».** `describeNextAutopilotStep(book)` (dominio, puro, mai eccezioni, nessuna AI) rispecchia la selezione del runner e descrive in italiano il passo corrente/successivo con capitolo, scena, obiettivo e blocchi che richiedono l'autore. La Dashboard mostra fasi (Ideazione → Piano → Scrittura → Redazione → Completato), avanzamento (scene canoniche, capitoli congelati, parole), «Sta lavorando su» con perché/poi del task in corso e il pannello di streaming (diagnostica tecnica in una sezione richiudibile). Se il libro è in esecuzione in un'altra scheda, lo si dice esplicitamente: solo la scheda proprietaria del runner può fermarlo.
2. **Due modi di fermarsi.** «Pausa» interrompe subito la richiesta (può essere comunque addebitata); «Ferma a fine task» (`AutopilotRunner.stopAfterCurrent`) lascia completare e salvare il task in corso e mette in pausa prima del successivo.
3. **Interventi registrati.** `BookProject.authorInterventions` è un registro append-only (max 500, testo max 8000) con data, passo in corso, eventuale task interrotto ed esito. `recordAuthorIntervention` usa lo stesso Web Lock del writer, CAS `updatedAt` e una **sola transazione** `books+activities+outbox` che scrive anche una Activity `aiRequested:false` con il testo (`interventionId`). Nessuna chiamata AI, nessun checkpoint di task (una nota non può essere rifiutata dalla quota delle copie di prosa opt-in). Tre modalità:
   - `next_step` — nota puntuale aggiunta in coda al prompt del **prossimo task di scrittura** (brainstorm, validate, audience, adversarial, outline, prose, continuity, consolidate, revision, chapterRepair) e marcata applicata **nella stessa transazione** che salva il risultato riuscito; un task fallito la lascia in attesa. **Mai** inviata a specialisti, cinque lettori ciechi, giudice o sinossi: la redazione resta indipendente.
   - `from_now` — vincolo permanente (`authorConstraints`) senza riscritture.
   - `rewrite` — vincolo + revisione retroattiva; se esiste solo il piano, rifà il piano (`phase:"outline"`); senza piano è rifiutata. Ammessa durante le fasi `review/adjudicate/summary` della redazione (le tornate già giudicate vengono archiviate nel capitolo prima di scartare il ciclo), rifiutata durante correzioni/riconciliazione o redazione bloccata (che ha il suo percorso nel pannello Redazione). Una revisione pendente viene **fusa**, mai sostituita, conservando il `beforePhase` originale.
   «Interrompi e registra intervento» ferma il runner della scheda, attende il checkpoint e registra; «Registra e continua» riparte subito.
4. **Correzioni del flusso di revisione.** Nessuna scena coinvolta ⇒ nessuna riscrittura e chiusura locale senza AI (Activity `aiRequested:false`); `rationale` vuota non ripete l'analisi; la chiusura dopo riscritture è una vera chiamata di aggiornamento della memoria (`consolidate`) invece della chiamata scartata; il ritorno va alla redazione ancora attiva, alla scrittura o alla pianificazione originale.
5. **Avvio da idea o da sinossi.** `newBook(..., options)` accetta `startMode`, `authorChapterSynopses` (letti localmente da `parseChapterSynopses`: «Capitolo N», romani maiuscoli, numeri in lettere, Markdown, elenchi numerati o paragrafi; max 80 capitoli, 4000 caratteri per capitolo), `targetChapterCount` e `pauseAfterOutline`. In modalità sinossi i prompt di ideazione arricchiscono senza cambiare eventi/ordine/numero dei capitoli, il piano **deve** avere esattamente N capitoli (altrimenti nessun piano applicato e errore leggibile) e usa i titoli dell'autore; ogni scena riceve la sinossi del proprio capitolo come vincolo.
6. **Contesto di scrittura.** Le fasi di ideazione e piano mantengono tutte le critiche; dopo il piano i prompt di scrittura includono brief, vincoli, idee, outline, memoria e scene recenti **ma non** validazione/lettori/adversarial (già incorporati nel piano), più un blocco «focus» con scopo del capitolo, sinossi dell'autore, **fine esatta della scena precedente** (~2400 caratteri, mai una surrogata isolata) e scena successiva prevista. Gli aggiornamenti di memoria chiedono voci compatte, perché la redazione rifiuta (senza troncare) memorie troppo ampie.
7. **Persistenza.** Backup ZIP con schemi strict per i nuovi campi e Activity `interventionId/appliedInterventionIds`; archivi legacy validi. La proiezione GitHub rende leggibili sinossi (`story-design.md`) e interventi (`context.md`); il JSON lossless li contiene già. Il confronto round-trip dello ZIP di sicurezza diventa indipendente dall'ordine delle chiavi (zod ricostruisce gli oggetti nell'ordine dello schema: prima falliva per qualunque libro arricchito durante il lavoro).

## Conseguenze e limiti

- La descrizione del passo è una **vista** coerente con il runner, non un piano garantito: il giudice può aprire correzioni, un errore può fermare il flusso.
- Una nota `next_step` è un'istruzione dell'autore al modello: non è una prova, non autorizza ripristini e non diventa canone automaticamente.
- La pausa immediata può comunque lasciare una richiesta addebitata; il testo interrotto non viene mai applicato.
- La rigenerazione dei soli capitoli non ancora scritti mantenendo quelli scritti non è inclusa: oggi un vincolo permanente guida le scene future, la riscrittura riguarda testo o piano interi.
- Rewind/undo storico restano fuori ambito (#158).

## Verifica

Vitest: lettura sinossi, descrizione dei passi e avanzamento, note dell'autore, registrazione con lock/CAS/limiti/merge revisione, runner (note solo ai task di scrittura e marcate al commit, nota pendente dopo errore, stop a fine task, piano vincolato dalla sinossi, pausa dopo il piano, focus con fine scena precedente, revisione senza scene coinvolte senza AI aggiuntive, revisione con archiviazione delle tornate e memoria aggiornata), backup ostile/legacy, proiezione, regressione ZIP di sicurezza. Playwright desktop/mobile: flusso completo sinossi → task visibile → «Interrompi e registra intervento» → ripresa con nota inviata e marcata applicata → «Ferma a fine task»; concorrenza fra due schede sugli interventi.
