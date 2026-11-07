# ADR 0045 — Giudizio epistemico sui conflitti relativi alla conoscenza dei personaggi

- **Stato:** proposto per v0.11.12
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0042, 0043, 0044

## Problema

Le v0.11.10–0.11.11 distinguono le fonti **attestate** da semplici citazioni di scene precedenti. Il giudice sa già valutare identità, cronologia, causalità e spiegazioni artistiche. Rimane però ambiguo il caso `dimension=knowledge`: «Mara sa il segreto» può essere narrazione diretta, voce riportata, sogno, menzogna o conversazione avvenuta fuori scena. Una citazione esatta non prova che il personaggio abbia appreso una notizia, e l'assenza della scena di apprendimento non prova che l'accesso fosse impossibile.

## Decisione

1. Per ogni nuovo finding `narrativeConflict` (eventi dell'autore) oppure `priorSceneConflict` (frasi precedenti), **soltanto se `dimension=knowledge`**, il giudice deve fornire anche `decision.knowledgeReview` **strict**. Questo è aggiuntivo rispetto a `narrativeReview`, che resta obbligatorio. Per ogni altra dimensione `knowledgeReview` è vietato.
2. Struttura: `priorClaimMode` e `currentClaimMode` con `direct_narration|dialogue_or_report|dream_or_hypothesis|unknown` e relative `priorReason`/`currentReason` da 20–650 caratteri; `accessPath=explicitly_ruled_out|explicitly_shown|plausible_unshown|unknown` con `accessReason` da 20–650; `assessment=supported_knowledge_conflict|explainable_or_unknown`; `conclusion` da 24–900. Non è una mappa canonica del sapere dei personaggi, ma un giudizio fallibile motivato e archiviato.
3. Un `reject` può descrivere dialogo, sogno, voce inattendibile, informazione appresa fuori scena, identità dubbia o prova insufficiente, senza alcuna remediation. Un `accept` richiede ancora fonte attuale verificata e `narrativeReview.assessment=supported_conflict`, `subjectIdentity=same`, `artisticContext=none_found`. Per la specifica dimensione **knowledge** il gate sostituisce l'obbligo di un conflitto cronologico/causale con **tutte** le condizioni `knowledgeReview.assessment=supported_knowledge_conflict`, due citazioni valutate `direct_narration` e `accessPath=explicitly_ruled_out`. Una via d'accesso solo sconosciuta, plausibile fuori scena, mostrata nel testo, un dialogo, un'ipotesi o una menzogna **non autorizzano** correzioni.
4. Il software NON controlla semanticamente la verità del ragionamento del giudice né impone la modifica: convalida provenienza e schema e rifiuta interpretazioni dichiaratamente insufficienti. La prova narrativa rimane tratta dal solo segmento corrente; le fonti precedenti sono quelle bounded della v0.11.9/v0.11.11. Nessuna nuova lettura di segreti, dossier privati, scena futura o memoria per i cinque lettori ciechi; il giudice conserva gli accessi al canone già previsti dall'ADR 0011.
5. `repairPrompt` e la callback di scrittura riapplicano `validateJudgment` sul libro fresco. Le decisioni importate o create con vecchie versioni restano **visualizzabili**; un conflitto knowledge salvato senza `knowledgeReview` non può però autorizzare nuove riscritture, e richiede una nuova valutazione critica. ZIP: campo opzionale rigoroso in `editorialCycle.judgment`, `editorialRounds` e `priorRounds`, archivi legacy ancora leggibili, import non autenticato.
6. Dashboard mostra separatamente il percorso della conoscenza con modalità della fonte precedente e corrente, accesso, valutazione e motivazioni, distinguendolo dal giudizio narrativo generale. Nessun nuovo modello, chiamata AI, endpoint, stato di canone, outbox o migrazione obbligatoria. I prompt più dettagliati possono usare qualche token aggiuntivo nelle chiamate al giudice già previste.

## Limiti

Il modello può erratamente classificare una frase del narratore come vera, quando deriva da un narratore inaffidabile; `direct_narration` resta un'interpretazione e non un'autenticazione. Neanche un `accessPath=explicitly_ruled_out` è un proof checker indipendente: si tratta di un gate **conservativo sulle condizioni dichiarate**, non di comprensione semantica garantita. La copertura delle scene precedenti è bounded; l'assenza di una fonte non prova né incoerenza né correttezza.

## Verifiche

Vitest su entrambi i tipi di fonte, campo obbligatorio per knowledge/assente per altre dimensioni, schema strict, dialoghi/sogni/accessi fuori scena, rifiuto motivato e gate in repair dopo invalidazione. ZIP round-trip e payload ostili. Playwright desktop/mobile con 12 review indipendenti, rilievo `knowledge`, giudice che rigetta su accesso plausibile fuori scena, prosa invariata e cinque lettori ciechi senza nuove fonti.
