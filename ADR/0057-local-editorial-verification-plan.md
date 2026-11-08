# ADR 0057 — Piano locale e consultivo delle verifiche editoriali

- **Stato:** accettato per v0.11.24 (PR #70)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0046, 0055–0056

## Contesto

La v0.11.23 richiede al giudice di specificare **prove mancanti** e **prossimo controllo suggerito** quando più agenti propongono rimedi alternativi sullo stesso passo. Questi dati sono visibili solamente dentro i singoli dettagli della redazione e si perdono nel percorso di navigazione quando l'autore consulta un capitolo già congelato o una tornata precedente. Una lista automatica di attività senza controlli sull'attualità delle fonti rischierebbe però di far sembrare ancora applicabili decisioni stale, importate o già risolte.

## Decisione

1. Introdurre `buildEditorialVerificationPlan(book,cycle,chapter)` **pura e locale**, senza campi persistiti, nuove chiamate AI/HTTP, ricerche, azioni, sync o modifiche al canone. Origine **esclusiva**: finding, ancore e `recommendationReconciliations?` già registrati nel ciclo editoriale. Non inferire nuovi conflitti da nomi, assenza di `pass`, sinonimi o parole simili.
2. Mostrare per ciascun gruppo di proposte differenti con fonte letterale **corrente** uno dei seguenti stati: `awaiting_judge` (ancora senza conclusione), `needs_evidence` (giudice dichiara `unresolved`), `approved_edit` (giudizio completo rivalidato e almeno un accept), `closed_no_edit` (tutte respinte), `requires_recheck` (giudizio o fonte non più corrente) e `archived` (tornata precedente, mai autorizzazione attuale).
3. Una voce è indicata come **approvata** soltanto se `validateJudgment` passa **interamente** sul libro, capitolo, finding, permessi e prosa correnti. Niente scorciatoie basate su `judgment.verdict` o `recommendationReconciliations` importati. Se il controllo fallisce, niente ID di remediation approvati e label **da rivalidare**. La categoria approvato **non** prova che il testo sia stato riparato o che l'interpretazione del giudice sia vera.
4. Per ogni riconciliazione, mostra `missingEvidence`, `nextCheck` e spiegazione **esattamente come scritti dal giudice**, senza derivare check nuovi. Se il giudice non si è ancora espresso, non inventare nessuna prova mancante o richiesta. Controlli **solo consultivi**, senza pulsanti di esecuzione, automazioni, invii ai modelli o promozione a memoria/segreti/canon/timeline.
5. Preservare le riconciliazioni salvate anche dopo un **edit che rende stale l'ancora**: presentarle come `requires_recheck` nell'area privata, senza permessi correnti e senza copia in prompt. Tornate in `cycle.priorRounds` sempre `archived`; capitoli congelati con `chapter.editorialRounds` visibili nello storico locale con ciclo virtuale **privo di judgment corrente**, evitando riabilitazioni.
6. Bounded: al massimo **24 voci di piano** in schermata con conteggio `omittedItemCount`; conservare i segnali di limite del calcolo v0.11.23 (`unreviewableFindingCount`, `omittedGroupCount`, `oversizedGroupCount`). Nessun elemento omesso viene automaticamente considerato risolto. Ordinare prima `needs_evidence`, quindi attesa, recheck, approvati, chiusi, storici; determinismo per tornata, segmento e ID. I limiti dei gruppi e gli stop di remediation v0.11.23 non cambiano.
7. La UI, dentro **Redazione multi-agente**, offre riepilogo dei contatori e filtro locale `Da verificare / Correzioni approvate / Chiuse senza intervento / Tornate precedenti / Tutte`. In archivio seleziona *Tornate precedenti* di default. Non creare nuovi ID DOM duplicati con più pannelli. L'autore può ispezionare citazione, finding ID, motivazione, prova mancante e controllo proposto; la nuova UI non invia contenuti ad agenti ciechi, giudice, writer o repair.
8. Compatibilità: nessuna modifica a DTO, ZIP, import/export, IndexedDB, sync, consensi o protocolli AI. Gli archivi legacy senza `recommendationReconciliations` semplicemente non mostrano un piano. Le opinioni AI e le citazioni importate non sono autenticate e restano **dati non attendibili**, mai istruzioni.

## Test e limiti

Vitest: piano vuoto, giudizio assente, evidenza non risolta, proposta approvata dopo **validazione totale**, respinta, edit/stale, giudizio manipolato, storicizzazione non riattivante, limiti gruppi e assenza di mutazioni. Playwright desktop/mobile: filtro, testo di `missingEvidence/nextCheck`, testo modificato e archivio. CI: TypeScript, Vitest, smoke, build e E2E. Resta impossibile verificare automaticamente se le prove suggerite esistano davvero o quale correzione sia artisticamente preferibile.
