# Motore autopilot e human-in-the-loop

## State machine

`idle -> planning -> running -> pause-requested -> paused -> running`

Transizioni aggiuntive: `needs-author` quando decisione critica o conflitto; `error` dopo errore endpoint/auth/timeout/invalid JSON/quota; `completed` solo dopo validazione finale. Niente loop infinito di retry silenzioso. L'autopilot può continuare tra moltissime attività, **non** oltre chiusura o sospensione del browser.

## Ogni attività è visibile

```ts
type Activity = {
  id: string; runId: string; bookId: string;
  phase: string; targetRefs: string[]; inputRefs: string[];
  reason: string; objective: string; expectedOutput: string;
  endpointId?: string; modelId?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt?: string; endedAt?: string;
  summary?: string; outputRefs: string[]; nextStep?: string;
  tokenUsage?: {input?: number; output?: number};
  costEstimate?: number; errorCode?: string; errorSummary?: string;
};
```

UI attività: **Sto facendo**, **Perché**, **Risultato**, **Cosa farò dopo**, **Intervieni**. Log cronologico append-only con descrizione comprensibile ed eventuale dettaglio tecnico redatto.

## Pipeline narrativa

- Brainstorm long-term: promessa narrativa, conflitti, mondi, archi, reveal distant.
- Brainstorm mid-term: capitoli/atti, svolte, tentativi, conseguenze, domande aperte.
- Brainstorm short-term: singole scene, beat, obiettivi, ostacoli, chiusure e transizioni.
- Validazione: originalità, causalità, compatibilità con brief e vincoli; ricerca per contenuti fattuali.
- Audience panel: 5 profili di lettori **definiti e versionati**, feedback indipendenti e aggregazione critica.
- Adversarial review: incongruenze, banalità, deus ex machina, plausibilità, spoiler e monotonia.
- Outline capitoli e scene; check del segreto per soglie di indizio/rivelazione.
- Preflight canon -> draft scena -> review/dialoghi/stile/continuità/segreti -> patch -> canonicalize.
- Consolida state, plot, timeline, entità e resumes; link intelligente ai capitoli precedenti (semina retroattiva senza spoiler); audit delle conseguenze.
- Final review di arco, trama, promesse aperte e completezza.

## Routing dei modelli

`taskKinds`: `summarize`, `brainstorm`, `validate`, `audience`, `adversarial`, `outline`, `prose`, `continuity`, `secret-audit`, `fact-check`, `revise`, `consolidate`, `export-metadata`.
Ogni `taskKind` ha endpointId+modelId e parametri di generazione; override nel libro, fallback esplicito controllato. `GET /models` dove supportato, scelta manuale se non disponibile. Concurrency limit globale e rate limiter per endpoint. Token e costi solo se il provider li rende disponibili; stime indicate come tali.

## Feedback e revisione retroattiva

Una change request contiene istruzione autore, target, priorità, vincoli immutabili, motivazione, ambito, stato e ID operazione. L'orchestratore:
1. Ferma alla boundary sicura, salva checkpoint e snapshot before;
2. Identifica dependencies: characters, locations, timeline, secret-reveal, scenes, summaries, plot;
3. Formula piano d'impatto con file potenzialmente coinvolti, costo stimato, precedenze e rischi;
4. Propone anteprima e, se in `autopilot`, applica solo modifiche compatibili con l'istruzione; per conflitti irrisolvibili passa a `needs-author`;
5. Riscrive dal punto più antico affetto in ordine topologico, revalida downstream e aggiorna canon/snapshot;
6. Pubblica un audit before/after, con undo mirato basato su hashes, mai reset di branch.

Se l'autore dice "assolutamente", l'istruzione diventa un **constraint prioritario persistente**, non una singola chat message che si perde.

## Stabilità e checkpoint

- Event log append-only, ogni chiamata AI con idempotency key applicativa e distinzione tra richiesta, risposta, convalida, commit.
- AbortController per stop della fetch; possibile chiamata remota già fatturata quando si abortisce.
- Checkpoint prima di chiamata e dopo output; un crash a metà chiamata NON deve canonizzare risultati incompleti o duplicare output al resume.
- Su errore remoto: stop, messaggio leggibile, HTTP/status/redacted body, capacità di `Retry task`, `Switch model`, `Edit settings`.
- Mostrare `minima spesa residua stimata` e `budget safety stop` opzionali; non dichiarare quanti crediti API restano senza una fonte del provider.
- Su mobile, `visibilitychange` e `pagehide` persistono checkpoint; chiedere schermo attivo per lunga generazione. Wake Lock può aiutare quando disponibile, non è garanzia.

## v0.11.41 — scrittura locale senza Web Locks bloccata (ADR 0074)

Il libro **locale** condivide IndexedDB fra le schede dello stesso origin, esattamente come un libro collegato a GitHub. Nelle versioni precedenti, se il browser non esponeva `navigator.locks.request`, `withWriterGuard` permetteva al solo libro locale di avviare `action` **senza lock**: due schede potevano generare contemporaneamente sullo stesso manoscritto, addebitare chiamate AI duplicate e salvare checkpoint incompatibili. Il lease GitHub protegge solo le repository collegate e non risolve il caso locale.

Da v0.11.41, **nessun autopilot si avvia senza Web Locks**, anche su un libro locale. La Dashboard mostra l'errore leggibile prima di `status=running` o di qualunque `aiRequested`: «Web Locks non disponibile: autopilot bloccato per evitare scritture concorrenti, anche nei libri locali. Usa un browser aggiornato in un contesto HTTPS sicuro.» Il libro e il checkpoint rimangono salvati e modificabili manualmente; si può usare il medesimo libro in un browser con Web Locks disponibili. Le attività di verifica fallita possono essere registrate per diagnosticare il blocco, ma **nessuna chiamata AI** viene inoltrata.

Con Web Locks disponibili, rimane la richiesta **non bloccante** `ifAvailable:true`: due tab sullo stesso libro non partono insieme. Sui libri GitHub collegati rimane obbligatorio anche il lease remoto, senza fallback offline. Non viene usato `localStorage` per simulare lock affidabili (i suoi write non sono una transazione di fencing). Nessun aumento di chiamate HTTP, credenziali o nuove dipendenze. Questa è una misura di sicurezza conservativa, non un coordinamento transazionale tra dispositivi e non protegge modifiche **manuali** concorrenti: issue [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#10](https://github.com/KeyserDSoze/BookWriter/issues/10) e [#77](https://github.com/KeyserDSoze/BookWriter/issues/77).

## v0.11.42 — fail-closed per orologi palesemente sfasati su GitHub

Per un libro collegato, il writer guard verifica che il clock del dispositivo sia plausibile rispetto alla finestra `X-RateLimit-Reset` esposta dall'API GitHub prima di usare il lease. In caso di scarto di ore, header mancante o errore remoto, l'operazione fallisce prima della chiamata AI: controlla che data e ora automatiche siano attive e poi riprova. Il controllo è **grossolano**, non sincronizza orologi al secondo, non protegge editor manuali concorrenti e non elimina l'intervallo non atomico tra verifica GitHub e IndexedDB. Vedi `docs/github-sync.md`, ADR 0075 e issue #78/#10.

## v0.11.43 — 404 di lock remoto verificato e UI fail-closed

Nel libro collegato a GitHub, un `404` sulla branch di lock non è considerato prova di assenza se manca il `X-RateLimit-Reset` CORS-esposto o l'orologio è palesemente incoerente. Anche la prima acquisizione si ferma prima di chiamate AI o scritture Git. In Archivio lo stato è «verifica in corso», «verificato» oppure «non verificabile»; un errore invalida l'ultimo risultato mostrato, e risposte tardive non prevalgono su controlli recenti. Nessuna chiamata o dato nuovo. Vedi ADR 0075, issue #79/#10 e `docs/github-sync.md`.

## v0.11.44 — rinnovo remoto attestato dal commit esatto

Il semplice fatto che la sessione AI abbia ancora un lease non scaduto **non** conferma che l'ultimo heartbeat GitHub abbia esteso la scadenza. Ora il rinnovo richiede la conferma della HEAD sullo SHA esatto del commit creato, oltre a proprietario e stato attivo. Se GitHub rifiuta il CAS o il PATCH non è stato applicato, il guard si arresta con `RemoteWriterLost` e abortisce l'AI se possibile. Una risposta di rete persa **dopo** il PATCH applicato non fa ripetere la scrittura: la HEAD verificata consente di proseguire. Non viene alterato il numero di GET, il provider AI o il formato lease. Non è risolto il fencing delle modifiche manuali cross-device (issue #10). Vedi ADR 0076, issue #80 e `docs/github-sync.md`.

## v0.11.45 — non fermare un autopilot vivo aprendo una seconda tab

Quando una nuova scheda apre BookWriter, il recupero di attività marcate `running` ora prova a ottenere il Web Lock del **singolo libro** prima di cambiare qualsiasi stato. Se un altro tab detiene ancora `bookwriter:writer:<bookId>`, la seconda scheda **non** mette il libro in pausa né annulla le attività. Dopo una vera interruzione del writer, il lock diventa libero e al successivo avvio il recovery esamina di nuovo i record dentro una transazione, imposta `paused` e annulla solo le attività ancora `running` di quel libro. Stato di altri libri, attività già riuscite e recovery ripetuti non vengono alterati.

Se Web Locks è assente, il recovery non può distinguere una sessione attiva da un crash e **conserva** i record anziché inventare la chiusura; l'autopilot rimane non disponibile in quel browser. Non è un coordinamento tra dispositivi o una protezione completa delle scritture manuali. [ADR 0077](../ADR/0077-lock-aware-recover-interrupted-runs.md), [issue #81](https://github.com/KeyserDSoze/BookWriter/issues/81), epic #6/#10.

## v0.11.46 — override del modello non riscrivono una versione vecchia del libro

Negli override endpoint/modello del **singolo libro**, una seconda scheda può conservare una copia React più vecchia dei checkpoint salvati in IndexedDB. Prima il cambio del modello salvava l'intero record, rischiando di cancellare modifiche successive. Ora il salvataggio tenta un Web Lock `bookwriter:writer:<bookId>`, rilegge il record e confronta `updatedAt` anche **nella transazione finale books+outbox**. Se l'autopilot sta lavorando, il lock è occupato oppure la revisione è diversa, la modifica non viene scritta e compare un messaggio; la UI aggiorna il valore attuale. Se manca l'API Web Locks, il cambio per libro fallisce chiuso.

Per editare un modello in testo, digita l'ID e **esci dal campo**: il commit avviene su blur, non a ogni carattere. I normali modelli globali hanno una configurazione distinta. Questa protezione riguarda **gli override di routing**, non ancora tutti gli altri interventi manuali, né garantisce il coordinamento cross-device. [ADR 0078](../ADR/0078-manual-book-model-route-local-fencing.md), [issue #82](https://github.com/KeyserDSoze/BookWriter/issues/82), epic #10.

## v0.11.47 — feedback dell'autore con lock e revisione confrontata

La richiesta manuale «Richiedi revisione» non deve cancellare capitoli o attività avanzati nel frattempo dall'autopilot o da un'altra tab. BookWriter usa la versione `updatedAt` **vista dall'autore**, prova a ottenere il Web Lock `bookwriter:writer:<bookId>` senza attendere uno scrittore già attivo e verifica anche nella transazione IndexedDB finale che il libro sia ancora quella revisione. Se il writer è impegnato, Web Locks non è disponibile, la redazione è bloccata o il libro è cambiato, il feedback **non viene applicato** e compare un errore esplicito. Non viene inviata una richiesta AI né aggiunta una nuova voce outbox al semplice tentativo fallito.

In caso di conflitto, la Dashboard **aggiorna il libro ma conserva l'istruzione digitata**, così l'autore può confrontare la nuova situazione e scegliere se riprovare. Solo un salvataggio riuscito aggiunge il vincolo e svuota il campo. La misura protegge il percorso di revisione nello stesso browser e non garantisce il coordinamento dei libri su dispositivi separati, né copre ogni altra modifica manuale. [ADR 0079](../ADR/0079-author-revision-local-fencing.md), [issue #83](https://github.com/KeyserDSoze/BookWriter/issues/83), epic #10 e #6.

## v0.11.48 — conferma di scene fuse senza audit obsoleti

Quando una scena fusa in `draft` viene approvata nel Lettore, BookWriter salva lo stato canonico e la registrazione di audit in **un'unica transazione IndexedDB condizionata alla revisione `updatedAt` letta dall'autore**. Se qualcuno cambia il libro dopo la verifica iniziale, l'operazione viene rifiutata senza scrivere né la scena né l'attività; la UI ricarica la versione corrente. Web Locks e autosync disabilitato continuano a proteggere la conferma e il successivo uso AI. La protezione vale per il browser, non è un fencing transazionale GitHub/IndexedDB fra dispositivi. Vedi [ADR 0080](../ADR/0080-atomic-editorial-scene-approval-audit.md), [issue #84](https://github.com/KeyserDSoze/BookWriter/issues/84) e `docs/scene-merge.md`.

## v0.11.49 — impostazioni GitHub non modificabili mentre scrive l'autopilot

Collegare una repository o cambiare il toggle autosync non può più sovrascrivere una copia stale del libro o cambiare la policy durante un autopilot attivo: sono richiesti il Web Lock del writer, quello dell'outbox e un CAS della revisione `updatedAt` nella transazione IndexedDB. L'eventuale controllo di rete della repository avviene **prima** dei lock; dopo viene ricontrollato il libro e, per autosync, il completamento di redazione/scene. Il writer AI e le chiamate già avviate restano invariati. L'outbox conserva le richieste pendenti al toggle off. [ADR 0081](../ADR/0081-local-github-settings-writer-outbox-cas.md), [issue #85](https://github.com/KeyserDSoze/BookWriter/issues/85), epic #10.

## v0.11.50 — ACK GitHub non cancella il checkpoint AI arrivato durante un push

Il worker autosync può pubblicare un checkpoint mentre l'autopilot produce quello successivo. Al ritorno da GitHub, `persistRemoteAcknowledgment` salva soltanto i metadati del commit e la decisione sulla coda nella **stessa transazione IndexedDB**, rileggendo il libro corrente e senza riscrivere il vecchio snapshot del runner. Se `updatedAt` è avanzato, il checkpoint nuovo rimane locale e una richiesta di sincronizzazione resta pendente. In caso di ACK remoto perduto, il marker GitHub permette il recupero conservativo. Non è un coordinatore cross-device atomico. [ADR 0082](../ADR/0082-github-ack-atomic-local-checkpoint.md), [issue #86](https://github.com/KeyserDSoze/BookWriter/issues/86).

## v0.11.51 — conferma remota del checkpoint prima dell'ACK GitHub locale

La coda autosync e il pulsante di push manuale accettano un commit del libro solo se la risposta del `PATCH force:false` contiene il **commit SHA esatto** e una lettura successiva del ref GitHub attesta che la HEAD punta allo stesso commit. Se il ref non avanza o la rete fallisce, il writer non presume che i contenuti siano sincronizzati: la baseline locale e la coda rimangono da recuperare o verificare. L'ACK locale atomico della v0.11.50 continua a conservare nuove revisioni durante il push. Nessun costo AI aggiuntivo; la verifica è una GET remota. Rimangono limiti di atomicità cross-device. [ADR 0083](../ADR/0083-github-push-exact-head-ack.md), [issue #87](https://github.com/KeyserDSoze/BookWriter/issues/87).

## v0.11.52 — recupero conservativo degli ACK GitHub persi

Quando l'autosync invia un checkpoint AI e la risposta del `PATCH` si perde **dopo** l'applicazione GitHub, BookWriter può attestarne subito il successo con una verifica read-only della HEAD, del messaggio Git e del marker `operationId/bookId/sourceRevision`, senza pubblicare due volte. L'ACK atomico continua a non cancellare un checkpoint creato durante il push. Se le prove non sono tutte disponibili, l'outbox conserva la richiesta e il worker applica i normali criteri conservativi; un 409/422 non viene trattato come successo. Nessun nuovo consumo AI. [ADR 0084](../ADR/0084-lost-patch-response-read-only-recovery.md), [issue #88](https://github.com/KeyserDSoze/BookWriter/issues/88).

## v0.11.53 — push manuale non compete con il writer e conserva il tentativo

La sincronizzazione manuale usa da ora gli stessi Web Locks `bookwriter:writer:<bookId>` e `bookwriter:github-outbox` già usati dall'autopilot/worker, acquisiti senza attesa, prima di salvare l'intento durabile e di inviare GitHub. Il suo `operationId` rimane nello store `meta` se il browser si interrompe; dopo reload può essere recuperato leggendo il marker remoto, senza doppio push. La normale coda autosync non viene requisita. Dopo ACK esatto, il libro, la coda e l'intento manuale sono aggiornati in una transazione IndexedDB. Il coordinamento cross-device non è ancora atomico. [ADR 0085](../ADR/0085-durable-manual-github-push-intent.md), [issue #89](https://github.com/KeyserDSoze/BookWriter/issues/89).

## v0.11.54 — riconciliazione GitHub manuale separata dall'autopilot

L'intento manuale sospeso può essere archiviato **solo** dall'autore dopo verifica read-only del commit sulla vecchia repository e con Web Lock writer del libro e GitHub-outbox disponibili. Se il writer AI sta scrivendo, l'operazione non entra nel critical section. Il commit remoto, il suo parent e il marker `operationId/bookId/sourceRevision` devono essere esatti. La transazione locale cancella solo il promemoria `meta`, preservando checkpoints canonici e outbox; non forza una sincronizzazione né riavvia agenti. [ADR 0086](../ADR/0086-verified-manual-push-intent-reconciliation.md), [issue #90](https://github.com/KeyserDSoze/BookWriter/issues/90).

## v0.11.55 — verifica manuale di checkpoint GitHub nella storia lineare

La riconciliazione **esplicita dell'autore**, distinta dal push del writer AI, può riconoscere il commit originale di un tentativo manuale sospeso anche se un altro dispositivo ha avanzato la HEAD. La prova è limitata a 32 commit su catena parent singola, verifica lo SHA, il messaggio, il parent della baseline e il marker alla revisione storica, poi rilegge la HEAD. Web Locks writer/outbox e CAS `books+meta` continuano a proteggere l'archiviazione locale. Non si riavvia l'autopilot, non si forza la HEAD e non si modifica alcun checkpoint. Merge, profondità maggiore e conflitti cross-device restano aperti. [ADR 0087](../ADR/0087-bounded-linear-github-history-manual-reconciliation.md), [issue #91](https://github.com/KeyserDSoze/BookWriter/issues/91).

## v0.11.56 — riconciliazione separata dal writer anche con merge Git

La verifica **manuale** di un `ManualPushIntent` sospeso può attraversare un DAG bounded di massimo 32 commit Git (inclusi merge con due parent), prima di riconoscere il commit originario e il suo marker allo SHA corretto. Non crea nuove chiamate LLM, non esegue push o merge di canone, non sblocca outbox; acquisisce i Web Locks writer/outbox e applica CAS `books+meta` come nelle versioni precedenti. Il push automatico continua a usare solo HEAD esatta per l'ACK. [ADR 0088](../ADR/0088-bounded-merge-history-manual-reconciliation.md), [issue #92](https://github.com/KeyserDSoze/BookWriter/issues/92).


## Plafond di sessione stimato — issue #130

Con budget del libro attivo, un limite facoltativo per sessione può fermare il ciclo corrente **prima della prossima chiamata AI** anche se la soglia complessiva ha ancora margine. Una sessione è il singolo `runId` creato a ogni Avvia/Riprendi; la ripresa assegna un nuovo ID, **senza cancellare** il costo globale o i consumi incerti del libro. Una bozza AI di fusione scena è una sessione autonoma di una richiesta, sempre sotto il limite globale. Nessun tetto contrattuale remoto o prenotazione fra dispositivi è garantito. [Guida budget](ai-budget.md) · [ADR 0120](../ADR/0120-session-ai-budget.md).


## Scelta esplicita del parametro output — issue #135

Il guard preventivo resta attivo per libro e sessione: quando riserva i token di output, `callModel` invia una sola delle chiavi Chat Completions `max_tokens` (default legacy) o `max_completion_tokens` scelta dall'autore in Impostazioni per l'endpoint. Non si fanno retry automatici modificando il parametro dopo una risposta HTTP non riuscita, un abort o un timeout; i consumi privi di usage restano ignoti. Il modello e il provider possono richiedere altre API o parametri non supportati: verificare la compatibilità prima dell'avvio. [Guida](ai-output-token-parameter.md), [ADR 0122](../ADR/0122-chat-completions-output-cap-parameter.md).
