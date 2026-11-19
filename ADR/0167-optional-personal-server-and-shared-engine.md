# ADR 0167 — Server personale opzionale e motore editoriale condiviso

- Stato: **architettura richiesta; implementazione sperimentale parziale iniziata**, non rilasciata.
- Data: 2026-11-19.
- Nessuna versione applicativa o release server assegnata.
- Integra ADR 0005–0009 (GitHub, outbox, lease, conflitti, merge), 0125 (commit CAS), 0153–0154 (cloud e conversazioni), 0162–0164 (editing, formato, ripresa) e 0165–0166 (salvataggio continuo e rinnovo del lease).
- Specifica operativa: [Server personale](../docs/personal-server.md).
- Contratto tecnico: [Motore e protocollo](../docs/personal-server-protocol.md).
- Piano e accettazione: [F02](../features/F02-personal-server.md).
- Dopo la richiesta «Implementare tutto quanto»: [stato reale del sorgente e limiti](../docs/personal-server-development.md). Questa ADR resta il contratto completo, non la dichiarazione che tutte le tranche siano concluse.

## Contesto e requisiti confermati

Il browser non può garantire lavoro a pagina chiusa (ADR 0164). L'autore richiede un server personale installabile su Linux o Windows che esegua la stessa redazione, continui senza browser e riallinei più client.

La scelta finale è **Node.js/TypeScript, non .NET 10**, per riutilizzare il codice editoriale. La modalità locale deve restare utilizzabile senza server, account cloud o tunnel.

Requisiti:

1. Amministrazione locale sulla porta **24105**, codice di pairing, più client collegabili e token rigenerabili.
2. API raggiungibile con URL HTTPS, anche tramite Cloudflare Tunnel opzionale; credenziale nell'header `apikey`.
3. Installer e pacchetti su GitHub Releases, istruzioni nella pagina client, rispetto di altri tunnel già installati.
4. Aggiornamento richiesto dal client, scaricato e verificato dal server, installazione e riavvio automatici.
5. Un solo motore per turni, prompt, revisori, direttore, impostazioni, controlli e applicazione delle risposte.
6. Modalità «Invia tutte le richieste al server»: il server è l'archivio operativo dei libri affidati; IndexedDB ne conserva una replica supervisionabile.
7. Un file operativo per libro nella radice dati del server, più file per più libri; riallineamento al collegamento e durante il lavoro.
8. Scoperta e sincronizzazione nell'ordine **profilo Google/Microsoft → GitHub → server**, senza far regredire il lavoro più recente del server.
9. Connessione in IndexedDB e, se scelto, nel profilo Drive/OneDrive, con credenziale nel vault.
10. **Chiarimento successivo dell'autore:** il server riceve anche il PAT e salva su GitHub come il client, dopo i compiti, senza dipendere da browser aperti. Questo sostituisce l'ipotesi iniziale «GitHub sempre dal client».

La progettazione non autorizza ancora trasferimenti di libri o credenziali, installazioni, pubblicazioni o aggiornamenti reali.

## Decisioni proposte

### 1. Motore unico, due ambienti di esecuzione

Estrarre dominio e orchestrazione in `src/engine/`, senza React, DOM, IndexedDB, `navigator`, filesystem o vault concreti. Client e server dipendono dallo **stesso pacchetto**, non da copie di `autopilot.ts`.

Le dipendenze diventano porte: persistenza transazionale, writer guard, credenziali, trasporto AI/GitHub/ricerca, osservabilità, checkpoint e servizi di sistema. Le implementazioni browser conservano Web Locks, IndexedDB e Web Crypto; quelle Node usano file, esclusione del processo e vault del server.

Non basta spostare `fetch` sul server: deve spostarsi l'intera sequenza selezione del lavoro → preflight → chiamata → validazione sul libro fresco → commit con audit e outbox. Anche editing, review manuali, merge e impostazioni devono passare dalla stessa autorità.

### 2. Una sola autorità per libro

Distinguere **connessione al server**, **replica dei libri** ed **esecuzione sul server**. Collegarsi non avvia AI né trasferisce automaticamente tutti i contenuti locali.

Un libro è affidato al browser oppure a un server identificato e a un'epoca di autorità. In modalità server:

- il server gestisce modifiche confermate, runner, budget, lease e outbox GitHub;
- i client inviano comandi con revisione attesa e ricevono snapshot/eventi;
- non avviano runner, AI autonome o push GitHub concorrenti per quel libro;
- una disconnessione non comporta mai un ritorno automatico all'esecuzione locale.

Il passaggio di autorità richiede pausa, checkpoint coerente, consenso, protocollo idempotente e conferma durevole. Un marker nel formato del libro permette ai client compatibili di riconoscere l'autorità anche scaricando da GitHub. Il lease GitHub resta necessario: il marker **non lo sostituisce**.

Non è possibile rendere cooperativi client vecchi o programmi esterni che ignorano il protocollo. Il formato nuovo deve bloccare le scritture delle versioni BookWriter che già verificano `formatVersion`; gli altri casi restano un limite dichiarato.

### 3. GitHub autonomo anche sul server

Il PAT fine-grained e le chiavi AI sono forniti al server con un consenso esplicito distinto dal pairing. Il PAT ha `Contents: read/write` sulle sole repository scelte: GitHub non lo limita al ramo del lease.

Riutilizzare la stessa implementazione dei protocolli, con adapter di persistenza/credenziali:

- lease prima e dopo AI, heartbeat, margini e controlli di ADR 0166;
- accodamento **dopo ogni compito riuscito** e modifica confermata;
- distanza automatica attuale di **2 minuti per libro**, invio forzato a fine corsa e su «Salva ora», senza sbloccare code `blocked`;
- SHA attesa, `force:false`, intenzione durevole, marker e rilettura esatta prima dell'ACK;
- ACK atomico sul file del libro con outbox e intento, senza perdere una revisione più recente.

«Dopo ogni compito» non promette un commit remoto immediato per ogni chiamata veloce. Il limite di 12 MiB e il limite di scritture GitHub restano visibili; più libri condividono anche un regolatore per credenziale.

I client continuano il normale GitHub sync per i libri **locali**. Per quelli del server «Salva ora» è un comando al server, non un secondo publisher.

### 4. File per libro, credenziali separate

La radice richiesta è una **directory dati esplicita**, anche `WorkingDirectory` del servizio; non la directory dei binari aggiornabili. Ogni `<bookId>.bookwriter.json` contiene libro, attività, bozze pertinenti, stato del runner, revisione, outbox e intenti dello stesso libro.

Confronto della revisione e sostituzione del file devono costituire un solo commit locale: serializzazione, file temporaneo sullo stesso volume, verifica, sincronizzazione e sostituzione secondo il filesystem supportato. Non usare file separati per libro, audit e outbox, che introdurrebbero commit parziali.

Un lock reale del sistema operativo impedisce due processi sullo stesso archivio. Niente sola mutex in memoria o file PID scaduto. Filesystem di rete e repliche attive della directory su due host non sono supportati nella prima versione.

Vault, identità, token e configurazione dell'installazione sono separati. I dati narrativi su disco non sono dichiarati cifrati/E2EE; il servizio li deve leggere per lavorare.

### 5. Pairing e amministrazione

L'amministrazione ascolta solo su loopback alla porta 24105. Una seconda porta proposta, **24106**, espone soltanto l'API e viene inoltrata dal tunnel. Mai pubblicare il pannello amministrativo o il codice di pairing attraverso il tunnel.

Codice breve monouso, scadenza, limiti ai tentativi, approvazione locale e verifica dell'identità del server precedono il rilascio di un token casuale per client. `apikey` non appare in URL, cookie, log o snapshot. Token revocabili e rigenerabili; permesso di aggiornamento separato, non concesso a ogni client.

Più client dello stesso autore condividono la libreria autorizzata. Non si progetta un servizio pubblico multi-tenant. Nessun limite commerciale al numero di client; restano limiti tecnici espliciti e protezioni contro abusi.

### 6. Profilo cloud: solo piano di controllo

URL, identità del server e riferimento alla credenziale possono seguire l'autore nel profilo cloud; la credenziale segue la politica del vault esistente. «Solo account» rimane **non E2EE**.

Non copiare in Drive/OneDrive manoscritti, attività, file del server, token Cloudflare o chiavi private dell'installazione. Nuovo dispositivo o URL/identità cambiati richiedono verifica prima di inviare segreti o contenuti. Non trasferire il potere di installare software tramite il normale profilo cloud.

Gli schemi cloud attuali sono strict e hanno un solo `githubToken`: connessioni server e più PAT richiedono uno schema versionato e migrazioni, non campi aggiunti di nascosto.

### 7. Installazione e tunnel isolati

Pacchetti con runtime Node incluso e versione fissata, servizio dedicato Linux/systemd o Windows, account a privilegi ridotti e percorsi separati per dati, configurazione e versioni del programma.

Il tunnel è facoltativo. Il suo token autorizza un connettore, **non crea automaticamente dominio, hostname o regole di routing**. La guida accompagna la configurazione Cloudflare.

L'installer rileva i servizi esistenti senza leggerne/divulgarne i segreti; non modifica `cloudflared.service`, il servizio Windows `cloudflared` o le configurazioni altrui. Offre tunnel dedicato con servizio distinto oppure configurazione manuale di un ingresso su un tunnel esistente. Aggiorna/disinstalla soltanto ciò che appartiene alla propria installazione.

### 8. Aggiornamenti verificati, non esecuzione di comandi remoti

Il client segnala una **release ufficiale**, mai un URL o uno script arbitrario. Il server verifica un manifest firmato con chiave pubblica già fidata, digest, piattaforma, versione e compatibilità. Il solo checksum scaricato insieme al binario non è una radice di fiducia.

Un supervisore/updater separato applica l'aggiornamento a fine task, con checkpoint, backup pre-migrazione, versioni affiancate e health check. Riavvia anche su Windows, senza tentare di sovrascrivere il processo in esecuzione. Fallimenti conservano dati e vecchia versione; rollback dei dati solo se coerente e senza scritture successive.

Versioni applicazione, server, motore, API e dati sono distinte. Una incompatibilità blocca le mutazioni; non abilita fallback locale o migrazioni distruttive.

### 9. Retry ravvicinati e differiti nello stesso motore

Integrazione richiesta dall'autore: il retry esistente si chiamerà **short-term**; esauriti i suoi tentativi, il **long-term retry** opzionale attenderà un numero configurabile di minuti e aprirà un nuovo gruppo sullo stesso compito. Contatori e limite dei cicli distinti, attesa durevole, annullamento e stessa sessione economica, senza doppio scheduler client/server. [ADR 0168](0168-short-and-long-term-retry.md), [specifica](../docs/retry-policy.md) e [F03](../features/F03-two-level-retry.md) valgono anche nel browser senza server. Nessun retry di blocchi di sicurezza, takeover o effetti remoti incerti.

## Privacy e invarianti non derogabili

- Il server vede manoscritto, memoria privata e credenziali necessarie. Il collegamento è una nuova scelta di fiducia, non una semplice preferenza grafica.
- Cloudflare termina TLS: il tunnel **non è E2EE del manoscritto** rispetto a Cloudflare. Non registrare header sensibili neppure nei log del connettore.
- Consensi di ricerca, indipendenza dei revisori, lettori ciechi, ancore, giudice, limiti di contesto e budget rimangono nel motore condiviso.
- Le preferenze e copie locali nello store `meta` non vengono esportate per ottenere «tutto il client sul server». Conservazione server delle conversazioni richiede una politica separata, esplicita; gli opt-in locali non la autorizzano.
- Assenza di ACK non prova assenza di effetti. Nessun retry cieco di AI, comandi, pubblicazioni o aggiornamenti.
- Server non raggiungibile: lettura della replica e bozze locali, mai falsa conferma di un salvataggio o avvio locale implicito.

## Conseguenze e alternative

Il primo backend custom è **opzionale e installato dall'autore**, non un backend di GitHub Pages. Aumentano superficie di attacco, copie sensibili, responsabilità di backup, firme delle release e verifiche Windows/Linux.

Scartati: riscrittura .NET del motore, copia divergente del runner, server come semplice proxy AI, worker browser come processo persistente, doppio writer browser/server, merge per timestamp e installer che riutilizza alla cieca il servizio Cloudflare globale.

La consegna attuale è solo questo progetto. F02 definisce le tranche e i test obbligatori prima di rendere disponibile l'interruttore; nessun installer, download operativo o auto-update è ancora disponibile.
