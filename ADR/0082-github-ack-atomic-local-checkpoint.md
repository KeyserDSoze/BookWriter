# ADR 0082 — ACK GitHub e outbox nella stessa transazione locale

- **Stato:** accettato per v0.11.50
- **Data:** 2026-11-09
- **Issue:** [#86](https://github.com/KeyserDSoze/BookWriter/issues/86)
- **Epic ancora aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0007, 0076, 0078, 0080, 0081

## Difetto

Dopo il successo della richiesta `PATCH force:false` a GitHub, `pushGitHubBook` eseguiva `persistRemoteAcknowledgment`: una lettura `db.get("books")` e una separata scrittura `db.put("books")`. Un'altra scheda poteva aggiornare canone o vincoli **tra le due operazioni**; l'ACK riscriveva l'intero libro con lo snapshot vecchio. La coda `outbox` veniva poi confermata separatamente dal worker autosync o dal pannello manuale, creando una seconda finestra di crash e una richiesta pendente per un commit già attestato localmente. In quel caso un nuovo giro può ripubblicare lo stesso libro, perché la HEAD GitHub e il `lastSyncedCommit` locale risultano già uguali e il marker del tentativo precedente non viene consultato.

## Decisione

1. La funzione `persistRemoteAcknowledgment(bookId, remote, sha, sourceRevision, operationId, expectedLastSyncedCommit?)` usa **un'unica transazione `readwrite` IndexedDB `books + outbox`**. Rilegge il libro *dentro* la transazione e cambia esclusivamente `remote.lastSyncedCommit`, `lastSyncAt` e `lastSyncedLocalUpdatedAt`. Non ricostruisce il record da uno snapshot pre-PATCH e **non incrementa `updatedAt`**: la baseline indica quale revisione narrativa è stata pubblicata.
2. Prima di qualsiasi scrittura, rifiutare il commit locale se il libro è stato eliminato, la destinazione `owner/repository/branch` è diversa o `lastSyncedCommit` è già avanzato verso una baseline differente da quella attesa e dallo SHA appena confermato. Non riscrivere una conferma GitHub più recente con la risposta tardiva di un commit precedente. Errore `RemoteConflict`, nessuna mutazione della coda.
3. Nella **stessa** transazione, leggere l'outbox:
   - Se `latest.updatedAt === sourceRevision`, tutto il record locale corrisponde al contenuto proiettato: eliminare la richiesta pendente, anche quando un push manuale ha usato un `operationId` diverso.
   - Se nel frattempo il libro è avanzato e la coda contiene **lo stesso** `operationId` pubblicato, mantenere il nuovo lavoro ma generare una nuova operazione `pending`, con tentativi/backoff azzerati. Se la coda è `blocked`, non sbloccarla automaticamente.
   - Se c'è una richiesta indipendente con ID diverso e il libro è avanzato, conservarla invariata. Non trasformare una revisione nuova in «già sincronizzata».
4. Entrambi i percorsi `pushGitHubBook` — POST/PATCH riuscito e **recupero read-only del marker** `.bookwriter/sync.json` dopo risposta persa — chiamano la medesima operazione atomica, passando il vecchio `lastSyncedCommit`. Il worker `auto-sync.ts` e la UI `GitHubSyncPanel` **non** eseguono più `acknowledgeOutbox` dopo il ritorno: una seconda conferma dopo il commit locale potrebbe cancellare una richiesta prodotta nel frattempo.
5. Il vecchio `acknowledgeOutbox` rimane disponibile per eventuali altri consumer/test, ma non fa parte del nuovo happy path GitHub. Il writer lease remoto, `PATCH force:false`, controlli PAT/pubblico, manifest e versioni ZIP rimangono identici.

## Test e limiti

Vitest su ACK valida e outbox rimossa, commit manuale con ID indipendente, checkpoint che avanza dopo la preparazione, retry con nuovo operationId, outbox blocked preservata, repository cambiata, ACK stale che non retrocede la baseline, ripetizione dello stesso SHA e libro eliminato. Adeguati i mock del coordinatore autosync per simulare la responsabilità del client GitHub sulla coda. Playwright desktop/mobile: due schede con un PATCH sospeso; la seconda aggiorna testo e coda mentre la prima attende GitHub, poi l'ACK deve preservare il nuovo testo e la revisione pendente senza force push o nuovo commit duplicato.

**Limiti espliciti:** GitHub e IndexedDB **non condividono** una transazione distribuita; se il browser si interrompe dopo PATCH remoto ma *prima* del nostro commit locale, il marker remoto con `operationId` e SHA può ancora consentire il recupero, non una garanzia di atomicità assoluta. Questa modifica protegge l'ACK locale e la coda; un writer esterno non cooperativo che salva uno snapshot obsoleto resta un rischio distinto, così come i dispositivi diversi, la rete instabile e gli orologi moderatamente sfasati. Le epic #10/#3/#6 restano aperte.
