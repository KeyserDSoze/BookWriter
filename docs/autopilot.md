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
