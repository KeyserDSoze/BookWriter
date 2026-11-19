# Server personale — stato reale e prove da sorgente

> **Tranche sperimentale: l'interfaccia è su Pages (0.32.1); il server si avvia da sorgente.** Non sono disponibili installer, servizi gestiti o aggiornamenti remoti firmati. Le correzioni di review descritte qui sono nella 0.32.1 del frontend e nel sorgente del server. Non usare manoscritti o credenziali reali per il primo collaudo.

## Cosa è implementato

- **GitHub con `git` (0.33.0):** cartella di lavoro per repository, pull prima di avviare e di salvare, branch e unioni con conflitti decisi dall'autore o proposti dall'autopilot. Il server ricade sull'API REST se `git` ≥ 2.32 manca. [Guida e limiti](personal-server-git.md).

- Host Node.js 22+, compilato da `src/server`, che esegue **lo stesso `AutopilotRunner`** del browser. Il motore è un pacchetto fisico, [`src/engine`](#il-motore-condiviso-srcengine), che frontend e server importano allo stesso modo: non esistono copie della logica editoriale né un IndexedDB simulato nel server.
- Un file `<UUID>.bookwriter.json` nella radice dati, con revisione, libro, attività, checkpoint **strutturali**, outbox, intento manuale, retry e ricevute di comando. CAS, validazione, temporaneo nello stesso filesystem, fsync e sostituzione; nessun troncamento oltre 80 MiB.
- Lock OS per l'intera radice: `flock` su Linux, mutex globale tramite PowerShell su Windows. Perdere il processo che detiene il lock ferma il servizio; un secondo processo non deve partire sullo stesso archivio.
- Vault separato AES-GCM, chiave privata 0600 su Linux e DPAPI CurrentUser su Windows. Non è E2EE; cambiare identità Windows del processo può rendere la chiave illeggibile. Il codice non rigenera una chiave corrotta.
- Admin su loopback 24105, API su loopback 24106. Host/Origin separati, bootstrap da file privato, sessione locale HttpOnly/SameSite e CSRF. Token client casuali, hash sul server, scope, revoca e rotazione.
- Pairing di cinque minuti, monouso, tentativi limitati e approvazione locale distinta. Il token viene consegnato una volta; se la risposta si perde, revocarlo e ripetere il pairing.
- Identità Ed25519 firmata su nonce. Il browser verifica firma e impronta prima di spedire il token; la prima impronta va confrontata con il pannello locale.
- API finite per nuovi libri, snapshot, comandi con sequenza/ETag/ricevuta, configurazione esplicita, avvio/pausa/stop a fine task, retry, edit scena/memoria, chiusura bloccata, collegamento GitHub e autosync. Un comando accettato non equivale a task concluso.
- Recupero prudente dopo riavvio: tentativi `running` diventano interrotti, usage assente resta ignoto, comandi pendenti diventano incerti. Nessun replay AI automatico di una richiesta incerta.
- Avvio e controlli di pausa ordinati per libro, ammissione globale di massimo due run e registrazione del runner prima della ricevuta di avvio. Una pausa agisce anche mentre si controlla l'autorità; un token revocato fra accettazione e attivazione non avvia il run. Cambi di credenziali/rete sono esclusivi rispetto all'ammissione e all'outbox. Lo spegnimento drena anche gli effetti GitHub accettati; un fallimento esterno rimane `uncertain`, non una conferma di successo.
- PAT **per libro** nel vault server, stesso protocollo GitHub di push, intento, marker, ACK e lease. Autosync mantiene 120 secondi; un solo run GitHub per installazione limita la pressione dei lease. Non è ancora un regolatore completo per credenziale.
- Retry short-term e long-term condivisi, con attesa durevole, claim, annullamento e runId/budget originari.
- Impostazioni → **Server personale**: URL/token, verifica, pairing, cifratura locale del token, sincronizzazione esplicita delle repliche, creazione sul server e delega delle sole chiavi selezionate. Le repliche non avviano runner/outbox/retry locali. Il relativo pannello permette comandi remoti, lettura ed export.

## Il motore condiviso (`src/engine`)

```text
src/engine/src/
  domain/          tipi, schemi (book-schema), regole, prompt, migrazioni, proiezioni — 203 moduli puri
  core/            HostRuntime (la porta), errori condivisi, politica di retry, stato narrativo
  application/     AutopilotRunner, model-call, writer-guard, auto-sync, push manuale, mutazioni dell'autore
  infrastructure/  trasporti AI, protocolli GitHub (lease, sync, markdown), outbox, intenti, retry durevole
  testing/         host-contract: i casi di comportamento che OGNI host deve rispettare
  index.ts         la superficie pubblica usata dal server
```

- **Dipendenze una sola direzione.** Il motore non importa né `frontend` né `server`, né `idb`, `fflate`, `react`, `node:*`. È compilato con `lib: ["ES2022"]` e senza tipi DOM: usare `window`, `indexedDB`, `localStorage` o `navigator.locks` è un errore di compilazione, non una convenzione. `tests/engine-boundary.test.mjs` verifica import e `tsconfig`; la CI esegue `tsc` sul solo motore.
- **Una sola porta, `HostRuntime`** (`core/host.ts`): libri, attività e impostazioni; `transaction(bookId, change, {activities?})` che conferma insieme libro, outbox, intento manuale, attesa di retry e (a richiesta) log o non scrive nulla; lettori per coda/intento/retry; cifratura locale; piccoli record del dispositivo; `tryLock` esclusivo e non bloccante; `withBookScope` (sul server seleziona il PAT di quel libro); `admission` (chi può scrivere il libro e quali altri blocchi servono a un run); `online()` e `traces` facoltativi. Il motore non ha uno storage proprio: senza host installato `host()` fallisce.
- **Browser** (`src/frontend/src/host/browser-host.ts`): IndexedDB (`db.ts`), WebCrypto (`crypto.ts`), Web Locks, store delle conversazioni (`ai-trace-store.ts`). Resta nel frontend ciò che è solo del browser: checkpoint opt-in della prosa/del libro, marcatore del profilo cloud, ZIP, import GitHub in IndexedDB (`github-import.ts`), recupero delle esecuzioni interrotte e tutta l'interfaccia. Una replica di un libro del server è in sola lettura nella `transaction` del browser.
- **Server** (`src/server/src/runtime.ts`): file per libro, vault, blocco in memoria nel processo più lock OS della radice dati, PAT per libro. La guardia di scrittura, il lease GitHub, la coda, gli intenti e il retry sono le **stesse funzioni** del browser.
- **Contratto condiviso.** `testing/host-contract.ts` contiene 14 casi (libro assente, commit atomico di libro+coda+intento+log, rollback, CAS, lock esclusivo, cifratura, coda GitHub con backoff e ACK, intento manuale, retry long-term con claim unico) che eseguono anche codice reale del motore. Girano sul browser (`browser-host.contract.test.ts`, fake IndexedDB) **e** sul server (`test/host-contract.test.mjs`, file reali): se un host si discosta dalla porta, lo stesso caso fallisce. Il contratto è stato verificato con guasti iniettati (scrittura della coda saltata, blocco non esclusivo).
- **Cosa il contratto NON prova:** non confronta sistematicamente tutti i prompt, ruoli, budget o validazioni fra i due host; non esercita Web Locks reali di un browser né il lock OS di Windows. Le suite applicative coprono singoli percorsi reali del runner; il test server di review esercita lettore personalizzato, rotta dedicata e assenza di memoria segreta nel suo prompt.

## Configurazione e libri personalizzati

- **Impostazioni → Server personale:** prima salva le modifiche sul dispositivo. Il pannello confronta la configurazione AI salvata con la parte non segreta di quella sul server. L'invio confermato usa la revisione mostrata: se un altro client l'ha cambiata, prima rileggila. Non c'è sincronizzazione automatica delle impostazioni.
- Passano rotte, endpoint approvati, modelli, capacità, limiti, tariffe, reasoning configurato e retry. Non passano tema, cronologia o preferenze delle conversazioni, catalogo di reasoning rilevato sul browser, token OAuth o Cloudflare. Per le chiavi AI scegli se mantenere, sostituire o rimuovere; cambio di URL o passaggio a nessuna autenticazione non eredita la chiave. Il PAT si delega o si rimuove per il singolo libro, senza cambiare la configurazione AI. La rimozione dal vault server non revoca il PAT presso GitHub.
- **Nuovo libro server:** titolo, idea, stile e pubblico si inseriscono direttamente. Puoi riusare i profili dei lettori/scrittori/direttore, preferenze di redazione, rotte, reasoning e limiti del budget di un libro, con un nuovo periodo di conteggio. Le istruzioni dei profili si copiano come scritte; il template non preleva capitoli, memoria, sinossi, credenziali o consensi. Non avvia l'AI. Una risposta persa lascia la creazione in attesa; «Riprendi creazione sul server» ritenta solo lo stesso identificativo e payload, con lo stesso client verificato.
- **Libro affidato:** conserva le configurazioni nel libro, con revoca dei consensi ereditati. La modifica dei profili e degli override **dopo** la creazione o l'affidamento non è ancora esposta da remoto. Un endpoint o modello citato dal libro deve comunque essere configurato sul server; il confronto non certifica che un modello/chiave funzioni.

## Come provarlo su Linux

Prerequisiti: Node 22, dipendenze di sviluppo del progetto installabili dal lockfile esistente, `flock`, filesystem locale e directory privata. Non usare NFS/SMB o una cartella sincronizzata.

```bash
cd src/frontend
npm ci --no-audit --no-fund
cd ../server
npm run typecheck
npm run build
npm test
node dist/server.mjs --data-root "$HOME/BookWriter-test-data"
```

La radice viene creata privata se assente. Se esiste con permessi aperti, l'avvio fallisce; verificarli personalmente prima di modificarli. Il programma **non** installa servizi e non termina processi che occupano le porte.

1. Aprire `http://127.0.0.1:24105`.
2. Leggere localmente `private/admin-bootstrap.txt` nella radice dati e inserirne il codice. Non pubblicarlo nei log o in una chat.
3. Approvare le basi AI e le origini del client nel pannello. Per Vite locale, aggiungere esplicitamente `http://127.0.0.1:5173`; per Pages è predefinito `https://ghostwriting.ws`.
4. Se si usa un reverse proxy/tunnel HTTPS già predisposto, indicarne l'origine pubblica nel pannello. Inoltrare **solo 24106**, mai 24105.
5. Generare un token o un codice di pairing, confrontare l'impronta e collegare il client.
6. Creare un libro **sintetico** sul server. Delegare la configurazione AI salvata e solo le chiavi scelte. Una base loopback indica il PC server.
7. Per GitHub, delegare il PAT a quel libro; dal pannello del libro collegare una repository privata già inizializzata e senza libro, effettuare il primo salvataggio esplicito, poi attivare autosync. L'autorità deve risultare pubblicata prima delle chiamate AI.
8. Avviare sul server. Chiudere il client non ferma Node. Alla riapertura, con l'aggiornamento automatico attivo, gli eventi notificano al client di rileggere gli snapshot. Si può anche usare «Sincronizza dal server»/«Aggiorna replica». Non è ancora l'orchestrazione automatica cloud → GitHub → server.

Windows può compilare gli stessi sorgenti con Node 22 e PowerShell. Il codice DPAPI/mutex e la matrice CI sono predisposti, ma **in questa sessione non è stato eseguito un sistema Windows**. Non è disponibile un servizio SCM installabile; non usare `sc create` direttamente su Node.

## Rete e sicurezza

L'adapter Node usa destinazioni approvate, rifiuta reti private/link-local/metadati e indirizzi IPv6 di transizione; risolve e fissa l'indirizzo **nella connessione effettiva**, senza affidarsi a un controllo DNS preliminare seguito da `fetch` libero. Loopback è ammesso solo per basi AI approvate. Nessun redirect con credenziali. GitHub resta su `https://api.github.com`, Wikipedia sui due indirizzi HTTPS italiani e inglesi supportati dal motore.

HTTPS, firma dell'identità e CORS non proteggono da amministratore/host/browser compromessi e non rendono il tunnel E2EE. Gli archivi dei libri contengono manoscritti e segreti narrativi in chiaro. Backup off-device, recupero dopo perdita del disco e affidabilità del filesystem richiedono prove separate.

## Cosa manca prima della feature completa F02

| Ambito | Stato |
| --- | --- |
| Tutti i comandi editoriali, merge/AI-edit e dossier remoti | Catalogo parziale; editor locali nascosti nelle repliche, nessun fallback. |
| Libro GitHub esistente: adozione dal server e ritorno al client | Implementati nel sorgente (0.34.0): il server legge la repository con `git`, pubblica il marcatore di autorità e lavora; «Riporta il libro sul dispositivo» salva tutto, toglie il marcatore e restituisce il libro. [ADR 0170](../ADR/0170-github-book-adoption-and-release.md). Non provato con GitHub reale. Nessun subentro per timeout. |
| Adozione di un libro locale **senza** GitHub | Implementata a senso unico, senza ritorno (sezione sotto: il testo viaggia dal browser). Prove sintetiche su file reali e IndexedDB; non provata con grandi manoscritti reali né su Windows. |
| SSE | Avvisi autenticati di aggiornamento e rilettura degli snapshot; non è un log durevole. La UI non mostra ancora il testo in arrivo dei libri server. |
| Upload grandi tipizzati e bozze offline | Non completati; nessuna promessa di editing remoto completo per scene oltre la busta ordinaria di 64 KiB. |
| Profilo Google/Microsoft, connessioni e registro multi-PAT | Non completati. Connessione attuale per dispositivo in `meta`; PAT per libro soltanto nel vault server. |
| Ordine automatico cloud → GitHub → server | Non completato. Non viene presentato come flusso automatico operativo. |
| Installer, runtime incluso, servizi Linux/Windows | Non implementati né pubblicati. |
| Cloudflare guidato | Configurazione manuale; nessun tunnel esistente modificato. |
| Manifest firmato, chiavi fidate, updater/supervisore e rollback | Non implementati. L'API non accetta URL o script di aggiornamento e dichiara non disponibile la release. |
| Prove Windows, servizi, tunnel reali e provider reali | Non eseguite qui. I test usano file reali e risposte sintetiche, non credenziali dell'autore. |

## Adozione di un libro locale senza GitHub

Flusso in tre azioni, tutte esplicite, dalla scheda **Server personale**:

1. **Blocco locale, senza rete.** Sotto Web Lock writer → outbox e in **una** transazione IndexedDB: il libro riceve `executionAuthority` (server verificato + nuova epoca scelta dal client) e il marcatore `personal-server:handoff:v1:<libro>` viene scritto. Da quel momento il libro è una replica di sola lettura su questo dispositivo, anche se rete, pagina o server cadono. Sono rifiutati: libro in esecuzione, tentativi AI aperti, GitHub collegato, code/intenti/attese di retry locali, revisione cambiata. I consensi che viaggerebbero con il libro (ricerca web, condivisioni AI, scelte di verifica) sono revocati con lo stesso criterio dell'import ZIP (`domain/consent-revocation.ts`, condiviso).
2. **Invio idempotente.** `POST /api/v1/handoffs` accetta solo un libro già bloccato con l'epoca indicata, senza GitHub e senza tentativi in corso; non sostituisce mai un libro esistente. La ricevuta durevole (stesso `handoffId`, stessi byte, stesso client) rende l'invio ripetibile senza duplicati; stesso ID con byte diversi o ID libro già presente sono conflitti. Il server applica comunque la revoca dei consensi (difesa in profondità) e non consuma sequenze di comando. Replica, cursore e chiusura del marcatore sono confermati nella stessa transazione IndexedDB.
3. **Recupero.** «Riprendi invio» ripete lo stesso POST; «Verifica ricezione» legge solo la ricevuta e ne confronta l'impronta; «Annulla trasferimento non ricevuto» chiede al server un **rifiuto durevole** di quell'`handoffId` (`POST /api/v1/handoffs/:id/resolve`) e solo dopo la sua risposta `cancelled` sblocca il libro locale. Se il server lo aveva già accettato, vince l'accettazione. Un server irraggiungibile, un registro illeggibile o una connessione diversa lasciano il libro bloccato.

Limiti di questo percorso: a senso unico e solo libri senza GitHub (per quelli su GitHub vale l'adozione tramite repository, con ritorno), nessun trasferimento automatico di copie/consensi locali `meta` o bozze di fusione. Occorre chiudere le bozze in sospeso prima di affidare il libro. Upload unico fino a 80 MiB (nessun upload a pezzi), nessun test su manoscritti reali. Se esiste già il libro server ma la ricevuta non è verificabile, il libro locale resta bloccato, leggibile ed esportabile.

## Comandi remoti: registro durevole e ricevute

- Il client scrive in IndexedDB un **intento** (busta, impronta SHA-256, identità/impronta del server, `clientId`, epoca, ETag) **prima** del POST, con fence su connessione, replica e sequenza. Ricevuta, replica, cursore e rimozione dell'intento si confermano in **una** transazione; una ricevuta incoerente o una connessione cambiata non cancellano nulla.
- Un errore HTTP, anche 4xx, non elimina il payload: la bozza dell'autore resta nel registro. Max 20 intenti; nessuna eliminazione automatica.
- «Verifica esito comando» legge **soltanto** ricevute (`GET`), mai riesegue. Una ricevuta assente (404) non dimostra che la richiesta non arrivi in ritardo: «Annulla richieste non ricevute» è una scelta separata, con conferma, che registra sul server un rifiuto durevole dell'identità esatta (`cancelled_before_acceptance`, sequenza consumata, nessun effetto né modifica narrativa). Un comando già accettato non viene annullato: si usa Pausa.
- Il server non tratta una ricevuta potata come prova di comando mai visto: i cursori di sequenza restano vincolanti e un vecchio comando fuori finestra richiede riconciliazione esplicita.
- Le connessioni salvate prima di questo registro non hanno `clientId`: restano leggibili, ma per inviare comandi vanno ricollegate.
- Timeout di 20 s (120 s per snapshot grandi) vale anche se `fetch` o la lettura del corpo ignorano l'abort; una risposta arrivata dopo la scadenza viene cancellata.

## Verifiche aggiunte al ciclo dei comandi

`src/server/test/controller-lifecycle.test.mjs` usa file reali, barriere esplicite e un provider HTTP sintetico, senza attese fisse per indovinare le corse:

- pausa durante la verifica di autorità, senza POST tardivo né replay di un avvio duplicato;
- tre avvii concorrenti, due soli ammessi e nessuna autorizzazione residua per il terzo;
- revoca prima dell'attivazione e arresto prima dell'ammissione;
- esclusione fra configurazione, nuovi run e outbox;
- modifica autore durante AI: prosa/stato dell'autore preservati, risposta scartata con usage noto e stop a fine task;
- salvataggio GitHub in corso durante lo spegnimento: ricevuta incerta conservata e nessuna seconda richiesta per un duplicato.

Queste prove integrano i contratti di archivio, vault, API, pairing, retry, riavvio e ACK GitHub; non attestano la feature completa, Windows o un provider reale.

Il numero `0.1.0` di `src/server/package.json` è un'etichetta privata del sorgente, **non una release binaria distribuita**. La review non comprende un nuovo bump frontend né un deploy.
