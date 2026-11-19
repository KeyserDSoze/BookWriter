# Motore condiviso e protocollo del server personale — proposta

> Contratto del progetto completo. È ora presente **un sottoinsieme sperimentale**: [implementazione e limiti effettivi](personal-server-development.md). Le parti non implementate di questo contratto non sono funzionalità rilasciate. [ADR 0167](../ADR/0167-optional-personal-server-and-shared-engine.md) · [Flussi e installazione](personal-server.md) · [Tranche F02](../features/F02-personal-server.md).

## 1. Confini dei pacchetti

```text
src/engine/src/               # pacchetto TS condiviso, senza dipendenze dagli host
  domain/                     # tipi, schemi, prompt, regole, migrazioni, proiezioni
  core/                       # HostRuntime (le porte), errori, politica di retry
  application/                # runner, model-call, guardia di scrittura, sync, mutazioni autore
  infrastructure/             # trasporti AI, protocolli GitHub, outbox, intenti, retry durevole
  testing/                    # contratto di comportamento che ogni host deve rispettare
src/frontend/                 # React, host browser (IndexedDB/WebCrypto/Web Locks), client HTTP
src/server/                   # host Node, API, adapter file/OS, servizi e vault
src/server-installer/         # packaging, supervisore/updater e script OS
```

`src/engine` e `src/server` sono presenti; `src/server-installer` non è implementato. L'estrazione fisica è fatta: dominio, runner, trasporti e protocolli GitHub vivono in `src/engine/src` e sia il bundle del browser sia quello del server li importano da lì (alias `@engine/*`; una sola copia di `zod`). Restano da fare i comandi remoti non ancora esposti, non l'estrazione.

### Mappa del codice attuale

| Dove vive ora | Responsabilità |
| --- | --- |
| `src/engine/src/domain/*` (editorial-board, manual-review*, book-editing, narrative-change*, book-format, book-schema, consent-revocation…) | Dominio condiviso, puro. Nessun import browser (verificato da test e dal `tsc` senza DOM). |
| `src/engine/src/application/autopilot.ts`, `model-call.ts`, `web-research.ts`, `author-*.ts`, `writer-guard.ts`, `auto-sync.ts`, `manual-github-push.ts` | Runner e casi d'uso condivisi; parlano solo con `HostRuntime` (`core/store.ts`). |
| `src/engine/src/infrastructure/github-*`, `outbox`, `manual-push-intent`, `retry-schedule`, `writer-sessions`, `ai*`, `lmstudio-*`, `web-search` | Protocolli e trasporti condivisi; ACK, intento, coda e retry sono una sola logica sopra `host.transaction`. |
| `src/engine/src/core/host.ts` | Le porte: libri/attività/impostazioni, transazione per libro, lettori, cifratura, record del dispositivo, lock, scope del libro, ammissione, online, tracce. |
| `src/frontend/src/host/browser-host.ts`, `infrastructure/db.ts`, `crypto.ts`, `ai-trace-store.ts` | Host browser: IndexedDB, WebCrypto, Web Locks, conversazioni conservate. |
| `src/server/src/runtime.ts`, `files.ts`, `vault.ts` | Host Node: file per libro con CAS, vault, lock del processo e della radice dati, PAT per libro. |
| `src/frontend/src/application/*` non spostati (cloud, ZIP, modifiche UI, repliche del server), `App.tsx`, componenti, routing, OAuth cloud, PWA, voce ed export | Restano nel client: sono funzioni del browser o dell'interfaccia. |

Non chiamare dal server il frontend con `fake-indexeddb`, browser headless o finti `navigator.locks`. Non importare `AppSettings` comprensive di cifrati del dispositivo per fingere un vault portabile.

### Porte minime e garanzie

- **`BookStore`**: lettura consistente; commit con revisione attesa di libro, attività, outbox, intenti e deduplicazione nella stessa unità; controllo formato prima di scrivere. Aggiornamenti di soli ACK preservano il contenuto più recente.
- **`SettingsStore` / `SecretStore`**: configurazioni versionate e accesso solo alle credenziali selezionate, non esportazione del vault intero.
- **`WriterGuard`**: esclusività locale dell'host e, per libri GitHub, lease remoto con verifica prima/dopo AI e prima del commit; abort e `failure` come oggi.
- **`ModelTransport` / `GitHubTransport` / `ResearchTransport`**: timeout, dimensioni, cancellazione, validazione e redazione degli errori già esistenti; nessun retry/fallback aggiunto dal cambio host.
- **`ProgressSink` / `TraceStore` / `CheckpointSink`**: testo live separato da dati confermati, policy per ambiente, nessuna promozione di delta al canone.
- **`Clock` / `IdSource` / scheduler**: test deterministici; niente stato di esecuzione dipendente da una finestra React.

Queste porte rappresentano garanzie, non CRUD generico. Il file adapter deve superare gli stessi test di contratto dell'IndexedDB adapter; non si può implementare `saveBookAndActivity` come tre scritture indipendenti.

## 2. Autorità, versioni e commit

Separare:

- `bookId`: identità narrativa stabile;
- `serverId`: identità stabile dell'installazione, legata a una chiave pubblica;
- `authorityEpoch`: identificativo di una concessione di autorità, diverso a ogni trasferimento/recupero;
- `revision`: intero sicuro monotono del contenitore operativo del libro, assegnato dal server;
- `updatedAt`: metadato compatibile del `BookProject`, **non** ordinamento affidabile fra PC;
- `runId`, `activityId`, `commandId`, `operationId`: identità diverse per run, tentativo AI, comando client e pubblicazione GitHub.

L'ETag comprende epoca e revisione. Anche un ACK operativo può avanzare la revisione del contenitore senza falsificare `book.updatedAt`. Un task legge uno snapshot, effettua la rete fuori dalla sezione critica, poi rivalida e committa sullo stato fresco. Le modifiche dell'autore possono arrivare durante AI; non si tiene una mutex del libro per tutta la durata della richiesta.

Usare la stessa distinzione attuale fra cambi narrativi e metadati e gli stessi gate di freschezza specifici. Una risposta scartata mantiene usage e audit, non sovrascrive l'edit dell'autore.

### Contenitore durevole per libro

Campi logici proposti:

```text
schemaVersion, serverId, bookId, authorityEpoch, revision
book, activities, mergeDrafts
runCheckpoint, retrySchedule, githubOutbox, manualPushIntent
commandReceipts, replayWatermarks, publicationReceipts, changeEvents
deletionTombstone?
```

`book.remote` può contenere destinazione e baseline, **mai il PAT**; il riferimento alla credenziale rimane configurazione protetta dell'installazione. L'export narrativo conserva le esclusioni attuali di snapshot GitHub/ZIP.

Scritture serializzate per libro, limite configurato e misurato in UTF-8, controllo spazio prima del commit, temporaneo nello stesso filesystem, validazione schema/digest e sostituzione sincronizzata. Risposta di successo ed evento di commit **solo dopo** la conferma durevole. L'indice globale si può ricostruire dai file e non è una seconda fonte del libro.

Un lock OS per radice dati e un supervisore unico impediscono due processi attivi. Windows e Linux richiedono implementazioni provate: `rename` o un file `.lock` da soli non dimostrano durabilità/esclusione. Sono fuori supporto iniziale NFS/SMB, directory sincronizzate da Dropbox/OneDrive e due host sul medesimo archivio.

Non eliminare automaticamente audit o manoscritti per rientrare nei limiti. Limiti proposti iniziali: **80 MiB per contenitore di libro**, staging limitato anche cumulativamente e quote disco configurabili; esaurimento = errore esplicito prima dell'ACK. Il limite GitHub rimane separatamente 12 MiB. Le copie temporanee e di backup contano nel preventivo di spazio.

## 3. Trasferimento di autorità

### Browser → server

1. Verifica compatibilità/identità, consenso di adozione e credenziali; blocca nuovi task locali, attende fine task/pausa e prende Web Locks writer → outbox.
2. Rilegge libro, attività e bozze con CAS; risolve intenti/push incerti e conflitti. Prepara copia di sicurezza e snapshot coerente senza esportare lo store `meta`.
3. Invia una preparazione con `handoffId`, digest e versione attesa. Il server valida e conserva in staging **senza eseguire**.
4. Per un libro GitHub, il client pubblica il marker di autorità nel libro e ne conferma lo SHA esatto. Nessun server parte se la pubblicazione è incerta. Il vecchio run è fermo e il suo lease rilasciato.
5. Il server verifica la prova GitHub, accetta l'epoca in modo durevole e acquisisce il proprio lease prima di AI. Il client conferma la replica/associazione, disabilita la propria outbox per quel libro e interroga `handoffId` se perde la risposta.
6. Lo stato finale permette un avvio esplicito o la prosecuzione precedentemente scelta dall'autore, mai un secondo run locale.

Per libri senza GitHub si usa la ricevuta durevole dell'handoff fra i due host; non si inventa una protezione contro copie non cooperative su dispositivi sconosciuti. Un trasferimento incompleto resta bloccato e riconciliabile per ID, senza rollback automatico che possa creare due autorità.

### Stato attuale del browser → server

Implementato soltanto per libri **senza GitHub**: il client scrive epoca e marcatore nel libro locale **prima** di ogni rete, il server accetta una sola volta per `handoffId` con ricevuta durevole e un annullamento richiede un rifiuto durevole del server. I libri con `remote`, la ripresa da GitHub e lo stesso protocollo per recupero/rollback restano non implementati; vedere [stato reale](personal-server-development.md).

### Server → browser

Il server ferma/chiude i task, conserva usage incerto, salva la coda e completa o riconcilia i push pendenti prima del trasferimento. Emette una ricevuta durevole di stop e nuova epoca, trasferisce la snapshot finale e rilascia il lease. Per GitHub la nuova autorità deve risultare pubblicata e riletta; il browser prende il suo lease soltanto dopo le conferme.

Il vecchio server rifiuta ulteriori mutazioni con l'epoca precedente. Server irraggiungibile non equivale a server fermo; niente subentro per semplice scadenza della connessione HTTP.

### Compatibilità e recupero

`executionAuthority` è un nuovo dato di significato del libro: serve una migrazione di `BOOK_FORMAT_VERSION`, validazione ZIP/GitHub e preflight delle versioni supportate. Nessun bump di `DB_VERSION` solo per dati del libro. Non cambiare proiezioni Markdown legacy: se cambia l'output documentale, serve il corrispondente nuovo formato Markdown.

Ogni avvio/riavvio remoto verifica autorità e lease correnti, non soltanto un vecchio file locale. Il marker GitHub è controllato anche prima dei passi e al commit delle risposte; perdita di autorità scarta l'output. Questo resta un protocollo cooperativo con GitHub, non un fencing transazionale universale.

Import ZIP come nuova identità/fork revoca l'associazione eseguibile al server, resta in pausa e non eredita token. Download GitHub di un libro che dichiara autorità server crea una replica non avviabile finché l'associazione non è verificata. Un restore server richiede nuova epoca di recupero, gestione dei contatori e arresto dell'originale: niente due installazioni clonate attive con le stesse credenziali.

## 4. API v1 proposta

API pubblica su loopback 24106 dietro HTTPS; pannello 24105 separato. URL di base normalizzata senza userinfo, query o frammenti; HTTP ammesso solo su loopback per prove consapevoli. `credentials:omit`, `redirect:error`, `cache:no-store`, niente autenticazione in query.

| Operazione | Endpoint proposto | Proprietà |
| --- | --- | --- |
| Identità pubblica minima | `GET /api/v1/info` | Identità, versioni API/motore/server, nessuna libreria o token. |
| Pairing | `POST /api/v1/pairings`, lettura esito del tentativo | Codice breve, nonce/segreto del tentativo; approvazione solo nel pannello locale. |
| Sessione/capacità | `GET /api/v1/session` | Token richiesto, scope e compatibilità verificati. |
| Libreria | `GET /api/v1/books?cursor=…` | Paginazione stabile, metadati autorizzati, inclusi marker di rimozione. |
| Snapshot e attività | `GET /api/v1/books/:id/snapshot`, `/activities?cursor=…` | Revisione/epoca, schema e dimensioni verificati; nessun segreto di connessione. |
| Adozione/trasferimento | `POST /api/v1/handoffs`, `GET /api/v1/handoffs/:id` | Protocollo preparazione/conferma, ripetibile per ID, non import eseguibile generico. |
| Payload grandi | `POST /api/v1/books/:id/payloads` | Staging tipizzato, autorizzato e bounded, digest e riferimento opaco; non un percorso di filesystem. |
| Comando | `POST /api/v1/books/:id/commands` | `apikey`, `If-Match`, `commandId`, sequenza e payload validato. |
| Esito comando | `GET /api/v1/books/:id/commands/:commandId`, `POST …/:commandId/resolve` | La lettura recupera l'ACK perso senza ripetere AI. `resolve` non esegue mai: restituisce la ricevuta esistente oppure registra un rifiuto durevole dell'identità e della sequenza esatte, solo su scelta esplicita del client originale. |
| Eventi | `GET /api/v1/events` tramite `fetch` streaming | Header `apikey`, cursore, eventi autorizzati e heartbeat. |
| Impostazioni/credenziali | endpoint dedicati versionati | Scrittura con scope e CAS; chiavi mai restituite nelle normali letture. |
| Versioni/aggiornamento | `GET /api/v1/updates`, `POST /api/v1/updates` | Lettura autenticata; mutazione con scope update e releaseId ufficiale. |
| Esito aggiornamento | `GET /api/v1/updates/:operationId` | Persistente attraverso il riavvio, senza rieseguire l'installazione. |

Catalogo comandi finito e discriminato: creazione/adottabilità, avvio, pausa, stop a fine task, annullamento/ripartenza immediata di un retry programmato, intervento autore, edit strutturato con timbro dell'elemento, review, decisione editoriale, impostazioni, merge, ricerche consensuali, salvataggio ora, trasferimento ed eliminazione confermata. Nessun `eval`, comando OS, percorso file o URL fetch arbitrario nel payload. L'API non accetta una snapshot intera come normale edit.

### Idempotenza e concorrenza

Ogni comando mutante porta `commandId`, `clientId`, sequenza monotona per libro/epoca e revisione attesa. `clientId` è vincolato al token autenticato, non scelto liberamente dal payload. Dopo autenticazione e scope si controlla la deduplicazione, poi il CAS per un comando nuovo: ripetere un comando riuscito non fallisce per la sua vecchia `If-Match`. Il server persiste identità e impronta del payload **prima degli effetti**; stesso ID e stesso payload restituiscono l'esito già noto, stesso ID con payload diverso è un conflitto.

Per avvio AI, accettazione del comando e autorizzazione di un solo run sono atomiche; la successiva Activity `aiRequested:true` si salva prima della rete. Una richiesta abortita dal browser non annulla necessariamente il comando: usare il relativo endpoint di esito.

Nella tranche attuale l'ammissione dei run è serializzata globalmente; accettazione e attivazione/pausa sono ordinate per libro. La ricevuta di avvio completata indica che il runner è registrato e controllabile, **non** che il task sia riuscito. Le chiamate AI e gli effetti GitHub non trattengono il lock di commit: gli edit dell'autore restano possibili. Lo spegnimento blocca nuove ammissioni, interrompe i run e attende gli effetti accettati prima di rilasciare l'archivio. Un effetto esterno non confermato conserva una ricevuta incerta.

La deduplicazione non promette «exactly once» della chiamata provider dopo un crash. Un tentativo durabile con esito ignoto resta incerto e richiede gestione prudente, non replay del comando. I cursori di sequenza sopravvivono alla compattazione delle ricevute: un vecchio comando non si riesegue quando il dettaglio del suo esito non è più consultabile. Richiesta fuori dalla finestra = riconciliazione esplicita.

Errori fissi: autenticazione `401`, scope `403`, epoca/conflitto `409`, revisione obsoleta `412`, limite `413`, formato/consenso invalido `422`, rate limit `429`, manutenzione `503`. Corpo limitato con codice stabile e messaggio italiano, mai stack, body provider, prosa o valori dei segreti. Un errore di protocollo non autorizza un retry AI automatico.

### Streaming e riconnessione

Usare `fetch` con stream SSE perché `EventSource` nativo non consente l'header `apikey`. Non mettere il token nell'URL per aggirare il limite.

Eventi durevoli: revisione confermata, esito comando, stato run, ricevuta GitHub e manutenzione; delta live separati per `bookId/activityId/requestId`. Un delta è provvisorio. Reconnect con cursore; se il server non ha più gli eventi richiesti risponde «snapshot necessaria», non ricostruisce una falsa cronologia.

**Stato attuale:** il server emette `snapshot-required` (con `{all:true}` alla connessione o `{bookId}` a ogni commit), `heartbeat` ogni secondo e `live` (coda di testo), senza cursore né log durevole. Il client usa gli eventi solo come **segnale di rilettura**: snapshot fenced, una per libro ogni 3 s, catch-up leggero per revisione alla riconnessione. Il testo `live` non viene ancora mostrato per i libri del server. Vedere [stato reale](personal-server-development.md).

Persistenza della replica e del suo cursore nella **stessa transazione IndexedDB**; fence su libro, connessione, epoca e generazione del token. Gap o cambio server = snapshot verificata prima di avanzare il cursore. Backpressure e limiti impediscono code illimitate di delta per client lento.

Limiti iniziali proposti: 64 KiB per busta di comando ordinario, 1 MiB per configurazione, 80 MiB per adozione/snapshot di libro e pagine di 100 elementi; limiti di byte effettivi, tempo e spazio anche per stream e upload. Prosa/materiali più grandi della busta usano staging tipizzato e un riferimento con digest, fino al limite del contenitore, mantenendo i validatori di dominio: non si riduce a 64 KiB una scena accettata dal motore locale. Un payload non ancora completo/validato non produce effetti; scadenza e pulizia riguardano solo staging, mai comandi applicati o testi confermati.

Operazioni oltre i limiti falliscono senza troncamento. Testare anche i limiti del proxy Cloudflare; un trasferimento troppo grande non diventa import parziale.

## 5. Sicurezza dell'host e credenziali cloud

Origini browser in allowlist esatta, con `https://ghostwriting.ws` predefinito e origini di sviluppo solo se abilitate dall'amministratore. Consentire `apikey`, `If-Match` e header del protocollo nei preflight; esporre solo ETag/versioni necessari. CORS non è autenticazione: token e scope verificati comunque a ogni richiesta, incluso streaming e client non browser.

API senza cookie; pannello locale con sessione, bootstrap e protezione CSRF propri. Validazione `Host`/`Origin` e rifiuto di route admin sulla porta API anche se qualcuno configura male il tunnel. Prima verifica autenticazione, limiti e autorizzazione sul libro, poi deserializzazione costosa e accesso al filesystem.

Pairing: codice di 5 minuti, monouso, contatori persistiti/limitati, non più di 5 tentativi per finestra prima di invalidare il codice e limiti globali contro enumerazione. Identità pubblica confrontata tramite canale locale; una chiave diversa richiede nuovo consenso. HTTPS e verifica d'identità non rendono il tunnel E2EE né proteggono da host/browser compromessi.

Cloud: schema nuovo con `serverConnections` pubbliche minime e relativi segreti nel vault. Per ritrovare la connessione su più PC, proposta una **credenziale di profilo** con soli scope dati/motore, capace di ottenere token distinti per dispositivo. Revocare il grant di profilo invalida anche i token derivati. Non può attribuire scope update o leggere il vault del server. Il ripristino richiede approvazione della destinazione; non invia il token a un URL appena cambiato nel cloud.

Il registro multi-PAT sostituisce/migra il solo `githubToken` attuale; mapping repository→credentialId esplicito e firma dirty del profilo basata sui cifrati, mai impronte dei segreti in chiaro. Lettori cloud vecchi devono rifiutare la versione nuova senza sovrascriverla. Non ampliare `projectSettings` con consensi di privacy, autorità locali o credenziali.

### Rete in uscita e SSRF

Endpoint selezionabili per ID da configurazione approvata; non chiamare un host arbitrario perché una richiesta autenticata porta una URL. Vietare userinfo, redirect con credenziali, reti link-local/metadati e DNS rebinding; verificare risoluzione e destinazione effettiva anche su Node.

Eccezioni loopback per AI locale ammesse solo con configurazione amministrativa esplicita e invarianti esistenti (`authMode:none` e LM Studio native su host/path permessi). Nessuna estensione implicita a tutta la LAN. GitHub resta solo `api.github.com`, ricerche sui rispettivi host ammessi, updater sulle sorgenti ufficiali con firma. Download asset GitHub senza PAT e con redirect strettamente controllati, non apertura universale di URL.

## 6. Sync GitHub e riavvio

Il server esegue il protocollo condiviso di lease/outbox/push/recovery, non una nuova implementazione semplificata:

- lock locali OS e ordine writer→outbox per operazioni manuali; l'autosync continua durante il run come oggi;
- limiti di rinnovo/letture e tolleranza di ADR 0166 invariati;
- una outbox per libro, accodamento nel commit di task/author edit, distanza 120 s e backoff;
- regolatore delle richieste per credenziale tra libri, includendo heartbeat e scritture; pressione non sostenibile = limite alla concorrenza dei run, non lease ignorato;
- `LocalBookChanged` differito, non conflitto remoto; `blocked` non viene sbloccato da nuovi task;
- intento manuale e operationId durabili prima del primo HTTP, mai secondo PATCH cieco;
- conferma SHA, marker e ACK nello stesso commit locale con outbox/intento; se il file è avanzato, ACK della revisione inviata senza cancellare il checkpoint nuovo.

La replica client non conserva un'intenzione di push attiva per un libro server. Gli ACK server aggiornano la vista, senza generare un ciclo server→IndexedDB→outbox browser→server. Le verifiche GitHub iniziali dei client non sostituiscono il libro operativo del server con una snapshot remota vecchia.

Al riavvio: lock OS, validazione file e versione, riconciliazione dei comandi/push noti e degli stati `running`. Task AI senza esito certo non sono ripetuti automaticamente; usage ignoto resta ignoto. Si riprendono solo checkpoint puliti con run autorizzato, politica di riavvio scelta, budget e lease verificati.

`recoverInterruptedRuns` e l'auto-resume browser ignorano i run delle repliche server: un mount del client non può mettere in pausa un server ancora attivo.

### Attese di retry short-term / long-term

[ADR 0168](../ADR/0168-short-and-long-term-retry.md) aggiunge al motore comune la [politica a due livelli](retry-policy.md): gruppo di tentativi ravvicinati, poi attesa configurabile in minuti e nuovo gruppo sullo stesso task. `retrySchedule` e autorizzazione del run si salvano nel contenitore per libro con generazione/CAS; la replica li mostra ma non li esegue.

La pausa programmata rilascia lock/lease e chiude i look-ahead; il risveglio rivalida tutto e mantiene il **runId logico originario**, senza azzerare il budget per sessione. Stato `claimed` dopo crash richiede riconciliazione prima di nuove POST. Intervalli mancati non si recuperano a raffica e i timer non sostituiscono writer guard, contesto o consensi. Questa politica riguarda i task AI, non i retry specifici di GitHub, lease e updater.

## 7. Distribuzione e aggiornamento

Manifest di release firmato sui byte esatti: repository/releaseId, numero progressivo, versioni server/motore/API/formato dati, OS/arch, asset, dimensioni, digest e compatibilità di migrazione. Chiavi pubbliche fidate nell'installer/updater; rotazione delle chiavi autorizzata dalla catena già fidata o da intervento locale esplicito. Niente prima chiave fidata scaricata dallo stesso manifest non verificato.

Il server accetta solo release ufficiali compatibili e non downgrade; un downgrade di recupero è un'azione amministrativa locale distinta. Non basta che una release sia «latest» e non basta HTTPS. Il client non sceglie URL, directory, argomenti del processo o script.

Supervisore e updater con protocollo locale minimo; privilegi limitati alle directory/servizi BookWriter posseduti. Il runner, pur vedendo PAT e prosa, non deve avere una API per eseguire comandi elevati arbitrari. Bloccare anche sostituzione di file tramite symlink/reparse point e archivi con traversal.

Stati persistiti: `requested → verified → waiting_for_task → checkpointed → installing → restarting → healthy`, oppure `failed/rolled_back`. Un solo aggiornamento per installazione; comando duplicato restituisce lo stesso operationId. Dopo verifica, attesa a fine task e checkpoint, modalità manutenzione rifiuta nuove mutazioni.

Backup pre-migrazione e versioni affiancate; per migrazioni di più file serve un manifest di manutenzione con avanzamento/ripristino dopo crash. Nessun client legge una libreria metà vecchia/metà nuova. Il rollback deve provare coerenza fra versione binaria, tutti i file e revisioni; se non può farlo resta fermo e richiede recupero, senza sovrascrivere dati più recenti.

Health check locale prima di ripresa e accesso mutante. La rete del tunnel può tornare dopo: non confondere il suo tempo di riconnessione con un fallimento del processo. Aggiornamenti di Node e del connettore dedicato hanno provenienza/versione esplicite; nessun cambio dei componenti condivisi dell'host.

## 8. Parità e limiti del progetto

Stesse fixture e risposte simulate devono produrre stessi task, prompt, validazioni, canone, audit e usage nei due adapter, salvo ID/date controllati e metadati host. Verificare separatamente privacy dei ruoli, compiti paralleli, tools JSON, interruzioni e modifiche autore durante AI.

Le copie locali opt-in restano locali. Il `CheckpointSink` del server può creare nuovi checkpoint strutturali dei propri task; non importa quelli del browser né li spaccia per copie testuali. Nessun archivio integrale server pre/post o backfill dei task remoti in `meta` senza progetto e consenso aggiuntivi. I controlli storici dell'interfaccia devono dichiarare questa copertura, non promettere parità di archivio locale.

Questo documento non dimostra fencing perfetto tra GitHub e filesystem, durabilità dopo perdita fisica del disco, sicurezza su host compromesso, zero downtime o assenza di addebiti duplicati dopo un crash provider. I test e i criteri per rendere disponibile la feature sono in F02.
