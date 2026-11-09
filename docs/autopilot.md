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
