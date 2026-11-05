# ADR 0006 — Autosync opt-in con outbox IndexedDB e recupero idempotente

- **Stato:** Accettato per implementazione v0.4.0
- **Data:** 2026-11-05
- **Issue:** [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **PR:** [#9](https://github.com/KeyserDSoze/BookWriter/pull/9)
- **Predecessore:** [ADR 0005](0005-github-manual-sync.md)

## Contesto

La v0.3.0 richiede la sincronizzazione manuale per ogni checkpoint. In autopilot un capitolo produce più operazioni e il browser può perdere la connessione, sospendersi o essere ricaricato. Vogliamo inviare automaticamente le revisioni importanti senza perdita locale né duplicazione non rilevata dei commit.

## Decisione

1. L'autosync è **opt-in per libro**, inizialmente disattivato. Si abilita solo dopo un commit GitHub manuale riuscito e con PAT fine-grained configurato. Una repository pubblica richiede consenso esplicito prima dell'abilitazione; nessun consenso predefinito.
2. Nella stessa transazione IndexedDB che canonizza una scena, un outline, un consolidamento o una revisione, si scrive una richiesta di sync nello store `outbox`. Un solo record **coalesced per libro**, con `operationId`, `revision`, `requestedAt`, `attempts`, `state`, `retryAfter`, `lastError`.
3. Le richieste successive aggiornano la revisione della coda conservando l'ID dell'operazione finché non è confermata. I conflitti bloccati **non** vengono azzerati da nuove scene. L'app conserva il canon in locale anche se GitHub non è disponibile.
4. Un worker mentre la pagina è aperta processa le code quando cambiano i checkpoint, al caricamento, al ritorno online, alla visibilità della scheda e con polling prudente. Se è offline si astiene. **Non** promette esecuzione a tab chiuso.
5. Un lock Web Locks `bookwriter:github-outbox` impedisce due invii concorrenti tra schede dello stesso origin. Se il browser non implementa Web Locks, non avvia l'autosync per prudenza. Questa protezione **non** è un lease distribuito tra dispositivi.
6. GitHub riceve un commit multi-file e `.bookwriter/sync.json` che dichiara `operationId` + `sourceRevision`. Il messaggio del commit include l'operazione. Se la risposta del PATCH va persa, al retry si accetta come già conclusa solo se **HEAD è esattamente il commit con quel marker** e `sync.json` corrisponde allo stesso libro/operazione. Se HEAD è un altro commit, conflitto: nessuna riscrittura automatica o force push.
7. L'ACK della coda avviene in transazione condivisa con `books`: se la revisione del libro non coincide con quella realmente inviata, la coda rimane attiva con **nuovo operationId**. I timestamp dei libri aumentano strettamente anche per scritture nello stesso millisecondo.
8. Errori temporanei: retry esponenziale 15–300 secondi, fino a 6 tentativi, poi blocco visibile. Conflitti, credenziali non valide, permessi assenti e repository pubbliche non autorizzate: blocco immediato con intervento manuale. Mai retry infinito.
9. Il pulsante di sincronizzazione manuale viene disabilitato per un libro con autosync attivo, per evitare la competizione tra due write path nel medesimo browser.
10. Nessun token, chiave API, API URL contenente segreti o CryptoKey viene scritto nella coda, nel marker Git o nei log GitHub.

## Conseguenze e limiti

- Il libro resta consistente localmente anche quando GitHub è offline.
- Una risposta GitHub persa dopo il commit è recuperabile senza creare un doppio commit.
- La UI distingue pending, sending, blocked, retry-after e synced, senza promesse di background 24/7.
- **Non è ancora safe l'esecuzione simultanea di due autopilot su due dispositivi.** Il controllo SHA protegge i commit, ma un remote lease deve essere implementato prima di abilitare il multi-device writing. Vedere la fase lease nell'issue #3.
- Non esistono ancora merge automatico della prosa, remote ZIP snapshot, OAuth Google/Microsoft o sincronizzazione di credenziali. Le credenziali rimangono nel browser.

## Verifiche necessarie

Test unitari su outbox, ACK dopo modifiche concorrenti, recovery commit, policy pubblica, nessun force push e API key mai serializzata; Playwright desktop/mobile per l'attivazione del toggle. CI verde obbligatoria prima del merge.
