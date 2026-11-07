# ADR 0044 — Confronti su scene precedenti non attestate e rivalidazione prima della scrittura

- **Stato:** accettato per v0.11.11 (PR #57)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0032, 0035, 0042–0043

## Problema

La v0.11.10 struttura il giudizio per i conflitti che citano un evento attestato dall'autore. Un romanzo può però avere scene precedenti congelate **senza annotazioni autore**: i revisori potrebbero segnalare contraddizioni senza un ancoraggio alla frase precedente. L'estensione indiscriminata ai testi storici privati e alle deduzioni della AI aumenterebbe falsi positivi, leak e riscritture errate.

## Decisione

1. Aggiungere `buildUnattestedSceneContext(book,chapter,currentText)` **puro, read-only, effimero**, basato su `retrievePriorContinuityScenes` già bounded: solo **scene canoniche e non vuote in capitoli precedenti congelati**, massimo 1600 scene scansionate dal ranking, al massimo 4 selezionate da quel ranking, fino a **3 finestre riportate** con offset e testo letterale. Massimo 10.000 caratteri di query per segmento. Non usa memoria privata, inventari, dossier, segreti, scene future, modelli o rete. Il ranking è lessicale/strutturale, non semantico; `omittedMatchedSceneCount` conta soltanto i match nel set già selezionato e `unscannedSceneCount` dichiara le scene oltre il limite di scansione.
2. Ogni testimone include `chapterId,chapterNumber,sceneId,sceneNumber,sourceFrozenAt,sourceTextStamp,offset,text,matchTerms`. Il timbro è un checksum **non crittografico**, non certifica autenticità. Includere il pack **solo nei prompt esistenti** dei quattro specialisti `continuity,timeline,secrets,characterVoice`, non nei cinque lettori ciechi né negli altri tre specialisti. Il giudice può vederlo solo quando riceve un finding ancorato nella **scena corrente**. Il payload non è un fatto o un'istruzione: sogni, menzogne, flashback, punti di vista e omissioni restano possibilità.
3. Nuovo campo **opzionale, strict** `finding.priorSceneConflict` per quei quattro specialisti: la citazione precedente **letterale** da 12–500 caratteri con `chapterId,sceneId,sourceFrozenAt,sourceTextStamp,offset,quote,dimension,hypothesis`. L'offset deve stare nella **finestra effettivamente selezionata** per il segmento e la citazione deve coincidere parola per parola con `scene.text.slice(offset,offset+quote.length)`. `finding.evidence` rimane per forza una citazione distinta del **solo segmento corrente**. ID falsi, future scene, fonte cambiata o fuori campione causano rifiuto del report.
4. `finding.narrativeConflict` (testimone attestato) e `priorSceneConflict` (scena non attestata) sono mutuamente esclusivi. Entrambi richiedono lo stesso `narrativeReview` strutturato con identità, cronologia, causalità, spiegazioni artistiche, motivazioni e conclusione. Il giudice può **respingere** un rilievo anche se entrambe le citazioni sono presenti. Per accettare una remediation il gate esige `supported_conflict`, `subjectIdentity=same`, `artisticContext=none_found`, conflitto in cronologia o causalità e citazione corrente/più antica ancora rivalidate; tali condizioni **non provano** la verità della critica.
5. **Controllo al momento della scrittura:** `repairPrompt` esegue di nuovo `validateJudgment` su cicli importati/ripresi; anche il callback che riceve la nuova prosa dal modello rivalida **sul libro fresco `b`** prima di modificare la scena. `validateReport` e `validateJudgment` usano lo stesso `b` nella callback, evitando decisioni su snapshot non più correnti.
6. Lo ZIP mantiene la compatibilità legacy e rende strict i nuovi campi all'interno dei report e dello storico senza attribuire autenticità agli import. La dashboard mostra frase precedente, offset, fonte, ipotesi e conclusione autonoma del giudice; nessuna modifica automatica a canone/segreti/possessi/timeline basata solo sulla selezione lessicale.
7. Nessuna nuova chiamata AI/HTTP, nessun nuovo stato persistente top-level o migrazione. Il testo supplementare aumenta in misura limitata i token delle richieste esistenti. I lettori ciechi restano separati, il giudice conserva la facoltà di rigettare e i cicli restano limitati a tre round.

## Limiti

Il software controlla **provenienza e freschezza** di citazioni, non la verità semantica, la continuità completa o l'intenzione artistica. Solo i nuovi finding con `priorSceneConflict` sono soggetti al gate strutturato: altri rilievi ordinari continuano ad avere il giudizio editoriale già esistente. Il retrieval è bounded e non garantisce copertura esaustiva per libri lunghi; una fonte non trovata non dimostra coerenza. La stessa scena può contenere menzogne, dialoghi o menzioni di eventi non avvenuti.

## Verifiche

Test di dominio su testo/freeze/status/offset/timbro, ruolo, privacy, futuro, conflitti misti vietati, giudice che respinge, gate before repair su fonte diventata stale. ZIP import con campi manomessi e archivi compatibili. Playwright desktop/mobile con 12 agenti, nessuna attestazione evento, finding legato a citazione precedente non attestata, giudice critico, freeze senza mutare prosa e nessuna nuova chiamata.
