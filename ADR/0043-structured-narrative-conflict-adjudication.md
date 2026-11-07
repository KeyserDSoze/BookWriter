# ADR 0043 — Giudizio strutturato per conflitti narrativi attestati

- **Stato:** proposto per v0.11.10
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0011, 0032–0033, 0035–0042

## Problema

La v0.11.9 porta ai quattro specialisti di continuità e al giudice testimonianze precedenti provenienti da scene congelate, approvate dall'autore. Queste menzioni non provano da sole identità, cronologia, causa/effetto o errore artistico. Il giudice dispone di testo libero con motivazioni, ma manca un controllo strutturato su queste quattro dimensioni per i **rilievi specificamente legati a una testimonianza precedente**. Una citazione vera non rende vera una critica: il rischio è introdurre remediation per falsi positivi.

## Decisione

1. Introduciamo un campo **opzionale** `finding.narrativeConflict` limitato a `priorEventDecisionId,dimension,hypothesis` con `dimension=identity|chronology|causality|knowledge|item_state`, ipotesi 20–500 caratteri e ID max 300. Non è il fatto canonico. Solo i quattro specialisti `continuity,timeline,secrets,characterVoice` possono emetterlo, **unicamente quando l'ID appartiene a un testimone realmente presente nel pack limitato della stessa scena corrente**. La validazione runtime richiede `book`, citazione `finding.evidence` di almeno 12 caratteri nel segmento ricevuto e fonte precedente rivalidata; qualsiasi ID allucinato o collegamento stale rende il rapporto non valido.
2. Per **ogni** finding marcato `narrativeConflict` il giudice autonomo deve rispondere con `decision.narrativeReview`: `subjectIdentity=same|different|unknown`, `chronology=conflict|compatible|unknown`, `causality=conflict|compatible|unknown`, `artisticContext=plausible_explanation|none_found|unknown`, `assessment=supported_conflict|explained_or_nonconflicting|insufficient_evidence`, quattro motivazioni separate (20–650 caratteri) e una conclusione (24–900 caratteri). Lo schema è `strict`, non sono ammesse istruzioni/campi extra. Per finding non marcati, un tale giudizio non è ammesso, e le vecchie decisioni restano compatibili.
3. Il giudice può **respingere** anche quando la citazione è reale; un rigetto strutturato viene archiviato senza riparazione. Per **accettare** un conflitto marcato, il gate richiede almeno `assessment=supported_conflict`, `subjectIdentity=same`, `artisticContext=none_found` e **`chronology=conflict` o `causality=conflict`**. Inoltre il segmento deve avere l'ancora narrativa ancora valida e la fonte precedente deve risultare nel pack corrente ricalcolato. È un controllo di coerenza **conservativo ma non una prova semantica**. Altrimenti il modello deve respingere o riesaminare.
4. Il gate viene applicato **sia al salvataggio del giudizio** (`validateJudgment`) **sia prima di generare una remediation** (`repairPrompt`), contro riaperture o import/resume di cicli già in stato repair. Nessuna autorizzazione da vecchi ID, quote importate, alias obsoleti o presenza lessicale senza confronto. I finding non marcati conservano il flusso precedente: questa ADR **non promette copertura esaustiva** di ogni conflitto.
5. UI: mostra l'ipotesi dello specialista con identificativo della fonte, le quattro dimensioni, i limiti di prova e la conclusione autonoma del giudice. Resta separata la `conflictReview` storica (evento/periodo/luogo/edizione/indipendenza). Non cambiano la semantica degli storici né i sette specialisti, cinque lettori indipendenti, conferma del canone, revisione, freeze o massimo tre round.
6. ZIP: convalida rigorosa `narrativeConflict` e `narrativeReview` in `editorialRounds`, `editorialCycle.reports`, `editorialCycle.judgment` e `priorRounds`, mantenendo il resto dei vecchi campi dei rapporti come legacy passthrough. Un archivio non attesta l'identità dell'autore e non sostituisce la rivalidazione del gate prima di una riparazione.
7. Nessun modello, rete, richiesta AI extra o modifica autonoma del testo/canon/memoria/segreti. Le istruzioni più dettagliate possono aumentare moderatamente i token dell'attuale chiamata ai revisori e al giudice. I cinque lettori ciechi non ricevono i pack di attestazioni e non possono produrre conflitti marcati.

## Limiti

Il modello può motivare erroneamente la propria valutazione e una `supported_conflict` non certifica verità. Il gate verificabile controlla provenienza e forma, non comprende la trama. Gli autori hanno la responsabilità finale sulle intenzioni narrative e le false piste. Eventi non attestati o privi di testimoni precedenti possono ancora produrre finding ordinari, senza questa analisi strutturata.

## Test

Unit test: ID fantasma/stale, ruolo non autorizzato, `finding.evidence` errata, campo mancante/superfluo, motivazioni corte, identità differente/incerta, flashback plausibile, prove insufficienti, remediation ammessa solo con requisiti, nuova invalidazione prima del repair, vecchi finding. ZIP round-trip e input manipolati. Playwright desktop/mobile: 12 review indipendenti, specialista con ID reale, giudice che respinge col formato nuovo, niente riscrittura e UI leggibile.
