# ADR 0168 — Retry short-term e long-term nello stesso motore

- Stato: **frontend dalla 0.32.0**, con pianificatore, adapter IndexedDB/file e test; host server sperimentale.
- Data: 2026-11-19.
- Integra ADR 0157 (retry correttivo), 0120–0121 (budget sessione), 0164 (limiti del browser) e 0167 (motore browser/server).
- [Specifica](../docs/retry-policy.md) · [Accettazione F03](../features/F03-two-level-retry.md).

## Richiesta

Dopo l'esaurimento dei tentativi ravvicinati, BookWriter deve poter attendere un numero configurabile di minuti e riprovare. La stessa regola deve valere nel frontend locale e nel backend Node, senza due implementazioni della politica.

Il meccanismo attuale diventa **short-term retry**. Il nuovo livello si chiama **long-term retry**: introduce un'attesa temporale persistente, non un ciclo che chiama il provider senza sosta.

## Decisioni proposte

1. **Short-term:** richiesta iniziale più `S` nuovi tentativi ravvicinati, dove `S` mantiene la semantica corrente di `autoRetryMax` (1–5, default 2). La richiesta iniziale non conta come retry.
2. **Long-term:** esaurito il gruppo short-term su un errore ammissibile, si salva un'attesa di `M` minuti. Alla scadenza parte un nuovo gruppo sullo stesso compito, con contatore short-term azzerato e contatore long-term incrementato. Successo = proseguimento normale e cancellazione dell'attesa.
3. `M`, massimo `L` di ripartenze long-term e attivazione sono configurabili per endpoint, come la politica attuale. Ripetizione illimitata soltanto con una scelta esplicita e avviso sui costi. Long-term assente/spento conserva lo stop attuale, senza nuovi tentativi impliciti.
4. Politica e transizioni pure nel motore condiviso; scheduler browser/server diversi soltanto per persistenza e risveglio. Una replica non programma retry del server.
5. **Attesa distinta da pausa manuale:** data `nextRetryAt`, contatori, compito, generazione e autorizzazione del run persistono atomicamente con il tentativo fallito. Una pausa dell'autore, annullamento o cambio di autorità revoca la ripartenza.
6. Il gruppo differito mantiene il **runId logico e la spesa della sessione originari**. La nuova invocazione dell'esecutore non crea un nuovo budget. Tutti i tentativi hanno Activity separate e usage osservato; una durata trascorsa non rende noto un costo ignoto.
7. Durante l'attesa si chiudono le richieste/look-ahead e si rilasciano writer lock e lease; alla ripartenza si riacquisiscono e si rivalidano libro, task, impostazioni, consensi, contesto e budget. Nessun prompt o apply vecchio viene rigiocato.
8. Il long-term non autorizza retry di abort volontari, credenziali/configurazione errate, budget bloccante, perdita di ownership, checkpoint non verificabili o conflitti di scrittura. Un esito remoto incerto dopo crash richiede prima riconciliazione, non una nuova POST automatica.
9. La nota correttiva di ADR 0157 resta confinata ai retry short-term del medesimo compito/ruolo nel gruppo in memoria. Non si persiste un vecchio messaggio/prompt per trasferirlo a un gruppo differito.
10. Timer scaduti non producono recuperi a raffica: un solo risveglio acquisito con CAS, nessun recupero di tutti gli intervalli mancati. Ogni successiva pausa decorre dall'esaurimento reale del nuovo gruppo.

## Ambito e compatibilità

Questa politica riguarda i task AI già autorizzati dell'orchestratore. Non si applica come wrapper generico a sync GitHub, rinnovi di lease, pairing, installazioni o aggiornamenti: conservano i propri protocolli di retry/recovery.

Le politiche per endpoint possono seguire il profilo cloud versionato e lo ZIP full, come oggi; **l'attesa operativa e il consenso a ripartire non viaggiano** in cloud, ZIP o GitHub. Importare impostazioni non arma un run.

In browser il risveglio dipende da pagina e sistema operativo attivi; reload può ritrovare l'attesa del medesimo dispositivo dopo verifica del relativo consenso, non crea lavoro a pagina chiusa. Questo scheduler è distinto dall'auto-resume generico di ADR 0164. Il server può risvegliarsi senza client, finché host e servizio restano attivi.

Non basta aggiungere `setTimeout` nel `catch`: servono stato durevole, annullamento, esclusività, identità del compito e contabilizzazione che non si azzera. Contratto completo e scenari in F03. La richiesta successiva ha avviato il runtime; le prove su servizi Windows e la feature server completa restano distinte.
