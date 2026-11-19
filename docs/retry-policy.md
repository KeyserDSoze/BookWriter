# Retry short-term e long-term — progetto comune a browser e server

> **Implementazione locale in preparazione, non ancora rilasciata.** `engine/retry-policy`, adapter IndexedDB/file e runner condividono pianificazione e claim; le impostazioni e il pannello di attesa sono operativi nel sorgente. Test sintetici su gruppi, runId, budget, crash/claim, revoca e isolamento delle repliche. Restano i gate completi e le prove Windows del progetto server. [ADR 0168](../ADR/0168-short-and-long-term-retry.md) · [F03](../features/F03-two-level-retry.md) · [Stato server](personal-server-development.md).

## Comportamento richiesto

| Livello | Quando | Configurazione |
| --- | --- | --- |
| **Short-term retry** | Ripete ravvicinatamente lo stesso compito fallito. | Attivazione e numero `S` di nuovi tentativi; conserva la semantica legacy, default 2 e massimo 5. |
| **Long-term retry** | Esaurito lo short-term, attende e apre un nuovo gruppo di tentativi sullo stesso compito. | Attivazione separata, intervallo `M` in minuti e massimo `L` di ripartenze; illimitato solo con consenso esplicito. |

Esempio **illustrativo**, non valori imposti: `S=2`, `M=15`, `L=3` significa una richiesta iniziale e due retry ravvicinati; se falliscono, attesa di almeno 15 minuti e nuovo gruppo. Sono consentite tre ripartenze differite. Al successo si prosegue; all'esaurimento di `L` si resta fermi chiedendo l'intervento dell'autore.

Con parametri finiti il massimo delle richieste del compito principale è `(1 + S) × (1 + L)`. Non è un tetto di costo o del numero complessivo di chiamate della redazione: ricerche autorizzate, task successivi e revisori anticipati hanno le proprie Activity.

Le due attivazioni sono indipendenti. Short-term spento significa `S=0`: il long-term, se autorizzato, può attendere già dopo il primo fallimento. Long-term spento significa nessuna ripartenza differita. Non c'è fallback automatico di modello, endpoint o host.

## Impostazioni e UX

Nelle opzioni dell'endpoint si separano due sezioni:

- **Short-term retry — tentativi ravvicinati:** rinomina comprensibile della politica esistente.
- **Long-term retry — riprova dopo una pausa:** interruttore, «Minuti fra i cicli», «Numero massimo di ripartenze» oppure scelta esplicita «Continua fino al successo o all'annullamento».

`M` deve essere un intero positivo validato prima del salvataggio, con massimo tecnico documentato e calcolo senza overflow; niente `0`, valori negativi, frazioni, `NaN` o troncamenti silenziosi. Il limite iniziale proposto per `M` è 10.080 minuti (7 giorni), da confermare con i test e la UX. `L` finito è un intero positivo entro un limite dichiarato; l'illimitato ha una rappresentazione distinta, mai un valore assente reinterpretato come consenso.

Il long-term è spento di default, anche per i profili legacy. Attivarlo richiede di mostrare intervallo, limite/ripetizione illimitata, ambito per endpoint e possibile addebito di **ogni** tentativo, anche quelli precedentemente falliti. Cambiare o importare la politica non avvia task fermi.

L'autorizzazione del run fotografa la politica long-term consentita: una modifica/importazione delle impostazioni non aumenta i tentativi, non accorcia l'attesa e non abilita il long-term di un run già avviato senza riconferma. Disabilitare o revocare la ripartenza, invece, ha effetto anche sui piani pendenti.

Durante l'attesa mostrare:

> «In attesa di retry long-term · ripartenza 2 di 3 · non prima delle 14:35».

Con ultimo errore spiegato, contatori short/long separati, autorità dell'esecuzione e azioni **«Annulla ripartenza»**, **«Riprova ora»** e pausa manuale. «Riprova ora» consuma una ripartenza del medesimo piano, mantiene il runId e richiede gli stessi controlli; non azzera i contatori o la spesa. Con piano annullato/esaurito si usa la normale azione manuale di avvio, esplicita e distinta.

La pausa programmata non è né un task in esecuzione né una pausa richiesta dall'autore. Nessuna nuova Activity `running` o `aiRequested:true` per il solo tempo che passa; eventuale audit di pianificazione è `aiRequested:false`, senza prompt o prosa.

## Quali errori consentono la ripartenza

La classificazione deve essere **condivisa e tipizzata**, non una regex nuova e divergente tra frontend e backend. Il nuovo livello non deve allargare implicitamente gli errori ammessi dallo short-term.

- Candidati: guasti temporanei del trasporto/provider già ammessi, rate limit o sovraccarico e risposte scartate che la politica correttiva consente già di rifare. I gate di validazione rimangono identici; aspettare non rende valida una citazione falsa.
- Mai automatici: stop/abort dell'autore, autorizzazioni o configurazioni da correggere, prompt oltre contesto, budget insufficiente/incerto, ownership persa, conflitti CAS/autorità, storage/quota e checkpoint invalidi, decisioni editoriali o consensi umani mancanti.
- Un timeout può essere addebitato: se il precedente tentativo è terminato localmente e la politica autorizza consapevolmente nuovi tentativi, l'eventuale costo ignoto resta segnalato. Con budget attivo e usage insufficiente il preflight blocca comunque: nessun intervallo temporale aggira il blocco.
- Crash con richiesta o effetto remoto ancora incerti: prima riconciliazione e verifica dell'audit. Il timer non prova che una richiesta precedente non sia arrivata e non promette «exactly once».

Un errore tecnico del modello è diverso dall'esaurimento delle tornate editoriali: il long-term non chiude un capitolo, non supera un `blocked` e non sostituisce le decisioni dell'autore/direttore.

Outbox GitHub, PATCH incerti, heartbeat e update mantengono le proprie regole. Non rilanciare tutto `startRunner` per eludere uno stop di sicurezza.

## Politica e stato operativo separati

Forma logica proposta, **non campi già implementati**:

```text
retryPolicy:
  shortTerm: enabled, maxRetries
  longTerm: enabled, intervalMinutes, maxCycles | explicitUnlimited
retrySchedule:
  scheduleId, generation, bookId, authorityEpoch
  runId, taskKey, endpointId, modelId, policyRevision, authorizedPolicy
  shortRetriesUsed, longCyclesUsed, nextRetryAt
  status: waiting | claimed | cancelled | exhausted
```

La politica appartiene all'endpoint; i valori legacy `autoRetry/autoRetryMax/localAutoRetry` sono letti/migrati senza due fonti di verità. Lo stato operativo appartiene soltanto all'host autorevole:

- **Browser locale:** record validato in `meta["retry-schedule:v1:<bookId>"]` con autorizzazione del run; commit del tentativo fallito, pausa programmata e piano nella stessa transazione con libro/attività. Nessun export dello store `meta`.
- **Server:** `retrySchedule` e autorizzazione del run nel contenitore operativo del libro, atomici con tentativo/audit/stato. I client ricevono lo stato per mostrarlo, non una copia eseguibile del piano.

`taskKey` contiene identificatori strutturali: tipo, ruolo, scena/capitolo, tornata/segmento/cursore e impronta pertinente. Mai titolo, prompt, testo della risposta rifiutata, credenziali o errori grezzi. `generation` e revisione della politica impediscono a un timer vecchio di ripartire dopo annullamento/modifica.

La **politica** può seguire impostazioni cloud e ZIP full versionati; la **pianificazione attiva** non va in cloud, GitHub, ZIP o fork e non viene ricreata da un import. Un handoff annulla il piano dell'host precedente; riarmarlo sul nuovo host richiede consenso esplicito e conserva i contatori/budget del run logico.

## Ciclo dello scheduler

1. Registra il fallimento e l'usage noto. Se short-term è ancora disponibile e consentito, segue il retry ravvicinato corrente.
2. Se short-term è esaurito e long-term autorizzato/disponibile, salva il piano `waiting` con `nextRetryAt = fineGruppo + M`. Se il commit fallisce non esiste una ripartenza autorizzata in RAM.
3. Prima dell'attesa chiude/contabilizza richieste e look-ahead del gruppo; rilascia writer lock e lease GitHub. Non mantiene heartbeat per minuti soltanto per dormire e non consente due chiamate del medesimo compito.
4. Il timer è un segnale di risveglio, non l'autorità. Alla scadenza l'esecutore prende i lock e acquisisce il piano con CAS sulla generazione; un solo processo/scheda lo può rivendicare. Lock occupato significa nessuna AI e nessun consumo di tentativi, con verifica successiva limitata.
5. Rilegge libro, politica, autorizzazione, task e budget. Riconcilia esiti precedenti e riacquisisce lease senza takeover automatico. Cambi narrativi/di compito, rotta, consensi o autorità invalidano il vecchio piano; semplici ACK operativi non cancellano un'attesa valida.
6. Ricostruisce il lavoro dal libro fresco, mai da una closure o un prompt salvato. Se tutto passa, incrementa il ciclo long-term in modo durevole, azzera il solo contatore short-term e avvia il nuovo tentativo con Activity nuova.
7. Successo cancella il piano e prosegue. Nuovo esaurimento programma `M` minuti dalla fine effettiva del gruppo, se restano cicli; annullamento, blocco o limite lasciano il libro fermo.

Un risveglio o processo che si perde dopo `claimed` non riarma alla cieca: il checkpoint distingue nessuna AI partita, tentativo concluso o richiesta incerta. Nessuna duplicazione per perdita dell'ACK.

**Budget:** mantenere il runId logico attraverso attesa e riacquisizione. `AutopilotRunner.run` oggi ne crea uno nuovo a ogni avvio: va aggiunto un ingresso interno di ripresa del piano che non sia un nuovo «Avvia/Riprendi» manuale. Altrimenti ogni ciclo differito azzererebbe erroneamente il cap per sessione.

## Browser, server e orologi

Stesso motore puro per classificazione, contatori e transizioni; adapter distinti per timer, persistenza e lock.

- Nel browser non c'è promessa di puntualità o lavoro a pagina chiusa. Reload/riapertura possono ripristinare un piano valido **del medesimo dispositivo e run autorizzato**, dopo riconvalida; non si ampliano le regole del generico auto-resume dopo F5.
- Nel server il servizio può attendere e riprovare senza client, ma non mentre la macchina è spenta o sospesa.
- Ora di scadenza UTC persistita, timer monotono per l'attesa in corso e controllo dei cambi significativi dell'orologio. Dati/clock non verificabili richiedono stop o riconferma, non tentativi anticipati.
- Risveglio tardivo: al massimo un gruppo, mai tanti gruppi quanti sono gli intervalli saltati. Nei client di un server il conto alla rovescia è informativo; decide lo scheduler server.
- Nessun nuovo runId, reset dei cicli o di consensi per effetto di reload, riavvio, cambio pagina o riconnessione.

## Verifiche prima dell'implementazione

F03 richiede test a tempo virtuale per contatori e scadenze, persistenza/CAS tra due schede e due processi, annullamento, sleep/riavvio, budget della stessa sessione, privacy, parità dei due host e compatibilità delle impostazioni. Tutte le etichette qui descritte sono future; oggi è disponibile soltanto la politica ravvicinata corrente.
