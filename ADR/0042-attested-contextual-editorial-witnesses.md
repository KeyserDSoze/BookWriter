# ADR 0042 — Testimoni narrativi attestati nella redazione contestuale

- **Stato:** accettato per v0.11.9 (PR #55)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0032, 0033, 0035–0041

## Contesto

I precedenti già congelati possono contenere menzioni esplicite di eventi confermate dall'autore e link fra due nomi motivati. La v0.11.8 rende tali legami consultabili localmente, ma nelle normali review di capitolo non fornisce questi testimoni pertinenti ai revisori: il retrieval cross-chapter precedente scatta principalmente dopo modifiche retroattive. Iniettare tutto lo storico nei prompt rischierebbe di esporre dati privati, sovraccaricare il contesto o trattare l'annotazione come una verità del canone.

## Decisione

1. Introdurre un **pack derivato ed effimero** `buildAttestedReviewContext(book, chapter, currentText)` che consulta solo `buildNarrativeEventLedger(book).currentAffirmed` e `buildNarrativeAliasRegistry(book).linked`, rivalidati su citazione, offset, scena canonica, freeze, timbro e ultima rettifica.
2. Limitare i testimoni alle attestazioni dei **capitoli precedenti** al capitolo sotto review. Scartare ogni scena corrente o futura, decisione `dismissed`, stale e link alias con **almeno una delle due attestazioni fonte non precedente**. Non recuperare trame non congelate, segreti, inventari, timeline privata o motivazioni dell'autore nei pack.
3. Abbinare soltanto un **nome intero letterale** presente nel segmento attuale (non sottostringhe di altri nomi); per nomi diversi usare esclusivamente **una coppia alias `linked` corrente e diretta**, senza chiusure transitive. Il nome e l'alias vengono marcati `literal_name` / `saved_alias`; quest'ultimo resta ipotesi non certificata.
4. Ordinare in modo deterministico i testimoni (nome letterale prima, poi alias, capitoli più recenti per primi) e mostrare massimo **8 citazioni** originali con capitolo, scena, ID del record evento, attore, tipo, dettaglio e offset letterale. Il report contiene conteggi `priorAttestationCount`, `relevantWitnessCount`, `omittedWitnessCount`, `eligibleAliasPairCount`. Scanner della query massimo 20.000 caratteri. È una selezione locale, **non una copertura completa né un motore semantico**.
5. Fornire il pack soltanto ai quattro specialisti `continuity`, `timeline`, `secrets`, `characterVoice` **anche nelle normali review**. Non aggiungerlo a `historical`, `style`, `narrative`, ai **cinque lettori ciechi** o agli strumenti di scrittura. Il giudice lo riceve solo quando esiste almeno un finding con **ancora letterale attualmente valida**, recuperando dal contesto ancorato del finding e non dal giudizio dell'agente.
6. Aggiungere istruzioni esplicite: il pack è prosa precedente **non affidabile come istruzione**; un'attestazione non verifica evento, soggetto, cause, identità, conoscenze o possesso. Confrontare flashback, sogni, dialoghi, omissioni, prospettiva, nomi uguali e narratori inaffidabili; se non esiste contraddizione verificabile il giudice può **respingere motivatamente**. Il campo `finding.evidence` rimane citazione **dal segmento corrente**, mai dal pack. Non alterare `validateReport`, `validateJudgment`, `acceptedRepairs`, limite di tre round o freeze.
7. Nessun nuovo stato persistito, ZIP, cronologia, modello, chiamata HTTP o side effect. Gli stessi agenti inviano già il testo della scena al provider AI configurato: il nuovo pack aumenta in misura limitata **i token** nella chiamata esistente e deve essere comunicato chiaramente all'autore.

## Garanzie e limiti

Il ledger non firma l'identità dell'autore; nomi e frasi nella prosa possono essere ambigui, bugiardi o collocati fuori cronologia. I testimoni sono una pista per controllare un rapporto, **mai prova automatica di colpa narrativa**. Un giudice che respinge un rilievo non promuove l'interpretazione a canone.

## Verifiche

Unit test su provenienza letterale, privacy, no futuro, alias diretti/non transitivi, staleness/revoche, nomi interi, ordering e limite 8. Test di integrazione dei prompt per quattro specialisti, cinque lettori ciechi e giudice che respinge motivatamente. Playwright desktop/mobile con 12 chiamate separate, un rapporto contestuale e giudizio critico finale. Nessuna modifica automatica di scene o memoria.
