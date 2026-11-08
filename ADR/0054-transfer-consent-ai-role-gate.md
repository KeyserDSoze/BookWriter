# ADR 0054 — Consenso specifico e revocabile per le valutazioni di piste informative

- **Stato:** accettato per v0.11.21 (PR da verificare)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0048, 0050–0053

## Problema

La v0.11.20 salva giudizi motivati dell'autore su singole frasi che *potrebbero* descrivere il passaggio di una notizia, ma li lascia tutti privati. Il consenso v0.11.15 copre soltanto una **singola interpretazione knowledge**, non le nuove valutazioni né i link fra personaggi. Condividere tacitamente tali giudizi con la redazione potrebbe rivelare spoiler privati e trasformare una lettura umana fallibile in una prova narrativa.

## Decisione

1. Introdurre **separatamente** `BookProject.narrativeTransferShareDecisions?: NarrativeTransferShareDecision[]`, append-only **max180**. Chiave `transferAssessmentId` esatta, `status=allowed|revoked`, `recipients` univoci da `continuity,timeline,secrets,characterVoice,judge`, motivazione privata 12–500, timestamp ISO e ID. `allowed` richiede almeno un ruolo; `revoked` lista vuota. I cinque lettori ciechi, storico, stile, narrativa, writer e repair non sono destinatari.
2. **Default deny:** nessuna nuova informazione è condivisa senza un nuovo click e conferma esplicita su una valutazione `NarrativeTransferAssessment` **corrente**, che deve riferire due conoscenze e un link `same_information` correnti, una direzione esatta, e una formula letterale presente nel campione bounded della v0.11.19. Vecchie autorizzazioni `narrativeKnowledgeShareDecisions` non si estendono mai.
3. La permission più recente per **ID esatto della valutazione** prevale, comprese revoche e valutazioni che diventano stale. Una rettifica del giudizio usa un nuovo ID, perciò il consenso vecchio **non si trasferisce** a nuove classificazioni; niente resurrezione di permessi dopo edit, riapertura/freeze, modifiche knowledge o invalidazione della coppia. `buildTransferSharingRegistry` rivalida fonte e permesso, non si fida dello ZIP come attestazione.
4. `buildSharedTransferPack(book,chapter,role,currentText)` produce per ruolo **al massimo tre** testimonianze, dopo **al massimo 12** autorizzazioni candidate al controllo approfondito. Solo fonte canonica congelata in capitolo **precedente nel manoscritto** e entrambe le menzioni knowledge in capitoli precedenti; il destinatario deve apparire come **nome intero nella scena corrente**. Il payload comprende **soltanto** numero capitolo/scena, offset, citazione letterale, mittente/destinatario e `authorVerdict`. Omessi *tutti* i rationale e ID privati di knowledge/topic/assessment/consenso, tempi, memorie, segreti, alias e storico. Contatori `eligibleCount`, `omittedCount` e `unscannedGrantCount` non attestano copertura completa.
5. **Prompt:** il pack compare solo ai quattro specialisti con ruolo esattamente autorizzato, nelle chiamate già esistenti. Il **giudice** lo riceve solo se è stato autorizzato come `judge` **e** possiede un finding `knowledge` con prova testuale **ancorata e corrente** nella scena in esame; il controllo viene eseguito nuovamente sul libro corrente. Nessun cambiamento alle prove obbligatorie dei finding, `validateReport`, `validateJudgment`, ai tre round, al gate knowledge della v0.11.12 o al repair. Il modello deve ragionare indipendentemente e può RESPINGERE un giudizio dell'autore: `author_attested_report` **non** attesta consegna, ascolto, credibilità, verità o conoscenza canonica.
6. **Scrittura e privacy:** UI per ogni valutazione corrente, 5 caselle **vuote inizialmente**, motivo, consenso o revoca con dialogo esplicito sul rischio di provider esterno e spoiler. `recordNarrativeTransferShareDecision` protegge Web Locks writer/outbox, CAS `updatedAt`, blocca autopilot/redazione attiva, transazione atomica `books+activities+outbox`, disabilita autosync e svuota outbox. Nei log/activity **mai** nomi, quote, verdict, destinatari, segreti o rationale. Revoca solo **futuri invii**, non cancella il contenuto già ricevuto da un provider.
7. ZIP content/full schema **strict** con enum, limiti, data, ID e cap180; legacy senza nuovo campo rimane importabile. **`importBackup` revoca automaticamente ogni ultimo grant `allowed` importato** prima di rendere il libro utilizzabile: storico conservato e revoca append-only. Se lo storico è pieno e non consente la revoca, scartare **l'intero** audit importato dei nuovi permessi (fail-closed). Push manuale GitHub e ZIP possono contenere spoiler; nessuna sincronizzazione automatica autorizzata dalla registrazione.
8. Il testo citato e i giudizi dell'autore restano **dati non attendibili**, mai istruzioni o evidenza semantica autenticata; il giudice rimane critico. Nessun nuovo endpoint, chiamata AI o modifica alla prosa, al canone, alla timeline o ai segreti. I prompt autorizzati possono crescere in token.

## Test richiesti

Vitest su default deny, limitazione per ruoli, giudice con/senza finding knowledge ancorato, privacy delle note, limite del pack, ultima revoca, cambio giudizio/fonte e vecchi permessi; application su locks/CAS/transazione/outbox e log privati; backup content/full cifrato, ZIP ostili, import con revoca e cap pieno; browser Playwright desktop/mobile su grant, revoca, reload, storage, assenza richieste AI/GitHub e layout.

## Limiti

Non dimostra la semantica delle informazioni o la cronologia della finzione; una frase letterale rimane un'ipotesi su quanto un personaggio *dica* di aver saputo. Consentire un estratto non trasforma in verità il giudizio umano e non autorizza nuove riparazioni.
