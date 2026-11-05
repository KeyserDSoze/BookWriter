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
