# ADR 0104 — Integrità del giudizio persistito prima delle remediation

- **Stato:** accettato per v0.11.72
- **Data:** 2026-11-09
- **Issue:** [#109](https://github.com/KeyserDSoze/BookWriter/issues/109)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0099](0099-complete-editorial-review-checkpoint-gate.md), [ADR 0100](0100-author-confirmed-editorial-checkpoint-recovery.md), [ADR 0103](0103-supervised-stale-repair-recovery.md)

## Problema

Nel runner la remediation può partire anche dopo un reload o import ZIP. Il controllo esistente di `repairPrompt` rivalida le fonti storiche e i conflitti narrativi/raccomandazioni divergenti, ma per una **correzione ordinaria** non provava necessariamente la matrice completa delle decisioni salvate: due accettazioni per lo stesso finding, omissioni, correzioni vuote o prove narrative non più presenti nella scena in attesa potrebbero trasformare il vecchio checkpoint in un'istruzione AI non autorizzata.

## Decisione

1. `assertSavedEditorialJudgmentIntegrity` esegue un controllo **locale e deterministico**: `judgmentSchema` valido, `verdict=repair`, timestamp, identificatori univoci, corrispondenza **uno a uno** di tutte le decisioni con i finding (inclusi quelli respinti), almeno una correzione accettata e remediation concreta per ogni accettazione. Un finding inventato, doppio, omesso o una decisione schema-invalida fermano il repair senza invocare il writer.
2. Per le correzioni approvate della **sola scena che sta per essere riscritta**, richiedere l'ancora narrativa originale ancora valida: la scena stessa potrebbe essere stata modificata da un altro intervento prima dell'applicazione dell'AI. Le scene **già riscritte** in uno step precedente possono avere impronte legittimamente diverse; non applicare loro una verifica delle citazioni originali. Restano invariati tutti i controlli di provenienza storica e di giudizio critico già presenti.
3. Il gate è invocato all'inizio di `repairPrompt`, che il runner chiama sia **prima della richiesta** sia **prima del commit**. La UI di recupero usa il medesimo gate e non deve andare in crash per un finding inventato: l'autore può archiviare il checkpoint originale con consenso tramite il percorso #105/#108, senza rollback o nuova chiamata AI automatica.
4. Nessuna nuova attestazione, modifica di prosa, permesso di condividere dati privati o firma crittografica. Lo schema verifica la forma della decisione, non l'indipendenza cognitiva o il valore letterario del giudizio.

## Test

Vitest con matrice valida 12×2, duplicati, omissioni, IDs inventati, remediation e rationale invalidi, timestamp/verdetto alterati, prova corrente mancata, corretta ripresa dopo primo edit. Playwright desktop/mobile con giudizio `repair` duplicato su matrice 12×1 e fonte ancora attiva: niente provider, recupero supervisionato e archivio originale. CI/Pages/cleanup richiesti sulla HEAD finale.
