# Server personale BookWriter — progetto

> **Feature completa non ancora disponibile.** Esiste una prima tranche sperimentale di runtime, API e interfaccia: [stato reale e prova da sorgente](personal-server-development.md). Il resto di questo documento resta il progetto completo, non un elenco di capacità già rilasciate. Nessun installer o aggiornamento firmato è pubblicato. [ADR 0167](../ADR/0167-optional-personal-server-and-shared-engine.md) · [F02](../features/F02-personal-server.md) · [protocollo](personal-server-protocol.md).

## 1. Cosa deve permettere

Installi BookWriter Server su un tuo PC Linux o Windows. Colleghi telefono, portatile e altri browser tramite URL e token. Puoi continuare a usare BookWriter soltanto nel browser, come oggi, oppure affidare i libri al server.

Quando un libro è affidato al server:

- ideazione, piano, scrittura, turni della redazione, correzioni, memoria, review e ricerche autorizzate girano sul server;
- modifiche dell'autore e impostazioni sono comandi confermati dal server, non modifiche indipendenti della replica;
- il server conserva stato, attività e coda di salvataggio e usa **anche il PAT per salvare su GitHub**, come richiesto dall'autore nel chiarimento finale;
- ogni client riceve la stessa libreria e gli avanzamenti; IndexedDB permette lettura offline e conserva separatamente le bozze non inviate;
- chiudere i browser non interrompe il lavoro: devono però restare accesi server, rete e servizi necessari. Sospensione o spegnimento del PC fermano anche il server.

La connessione non è un comando «Avvia tutti i libri». L'avvio resta esplicito, con budget e modello controllati. Un server personale può servire più client dello stesso autore, non utenti estranei con biblioteche separate.

## 2. Schermata client: prima connessione, poi spiegazioni

Nuova scheda proposta **Impostazioni → Server personale**, indirizzo `/impostazioni?tab=server` coerente con il routing esistente. Il nome tecnico della scheda va aggiunto a `SETTINGS_TABS` e alla gestione dell'indirizzo, non simulato con un link a una pagina inesistente.

Ordine dei contenuti:

1. **Connessione**: URL HTTPS, token mascherato, Mostra/Nascondi su clic, «Verifica connessione», «Collega», «Scollega questo dispositivo»; alternativa «Abbina con un codice».
2. **Stato e compatibilità**: nome/identità del server, raggiungibilità, ultima connessione, versione installata, API e formato compatibili, versione disponibile e «Aggiorna server» se autorizzato.
3. **Esecuzione**: casella **«Invia tutte le richieste al server»**, spenta di default, e riepilogo dei libri affidati/locali/in conflitto. Spiegazione visibile dell'ambito.
4. **Installazione e download**: scelta Linux/Windows, architettura, release verificata, requisiti e guida passo passo. Finché una piattaforma non ha un asset pubblicato, mostrare «Non disponibile», non un link inventato.
5. **Cloudflare e sicurezza**: spiegazione di token tunnel, hostname, tunnel esistenti, credenziali sul server, backup, revoca e recupero. Il token tunnel si inserisce nell'installer/pannello locale, non nella SPA pubblica.

«Tutte le richieste» significa i comandi del motore e le chiamate AI dei libri affidati, comprese AI autonome di editing/merge, inventario modelli e ricerche autorizzate. **Non** significa inoltrare OAuth Google/Microsoft, scaricare installer dal server personale, spostare automaticamente tutti gli altri libri, o inviare tutte le operazioni di sistema al server. Login cloud, interfaccia, lettura ad alta voce del browser ed esportazioni locali restano nel client. La ricerca semantica mantiene il gesto esplicito e indica se l'endpoint locale è quello del server.

L'attivazione apre un riepilogo: libri da trasferire, repository, impostazioni, chiavi AI e PAT necessari, dati privati inclusi, costo potenziale e politica delle conversazioni. Conferma separata prima dell'invio. I nuovi libri creati con la modalità attiva nascono sul server; quelli locali preesistenti richiedono adozione esplicita.

Il default di instradamento è per dispositivo e non parte automaticamente su un nuovo PC dal profilo cloud. L'autorità già assegnata a un libro, invece, vincola **tutti** i client compatibili: una casella spenta altrove non concede un secondo runner.

## 3. Installazione prevista

### Piattaforme e pacchetti

Obiettivo iniziale: Linux x64 con systemd e filesystem locale supportato, Windows x64 con servizio e NTFS. Distribuzioni/versioni OS esatte e supporto ARM64 vanno dichiarati solo dopo la matrice di prova. Non promettere qualunque Linux, Alpine, NAS o versione Windows.

GitHub Releases dovrà contenere:

- pacchetto Linux e pacchetto/installer Windows con runtime Node fissato incluso;
- installer guidato e script Bash/PowerShell versionati, senza richiedere Node/npm già installati;
- manifest firmato, firme, dimensioni e SHA-256 degli asset;
- versioni server/motore/API/dati, requisiti OS, note e istruzioni di ripristino;
- licenze, distinta delle dipendenze e provenienza di runtime, wrapper e `cloudflared`.

Sorgenti in TypeScript; pacchetti di esecuzione già compilati. Non eseguire `npm install` da Internet sulla macchina dell'autore a ogni avvio. Il formato iniziale proposto è archivio con runtime privato; un singolo eseguibile Node SEA è un'alternativa da provare, non un requisito né una capacità già verificata per BookWriter.

### Passi dell'installer

1. Verifica OS, architettura, spazio, firma e versione del pacchetto.
2. Mostra directory di programma e dati, account del servizio, porte e servizi già presenti. Nessuna modifica prima della conferma.
3. Crea servizio e directory con permessi minimi. L'elevazione serve all'installazione; il runner non deve girare come root/Administrator.
4. Chiede se configurare un tunnel dedicato, usare un tunnel già gestito dall'autore oppure non usare Cloudflare.
5. Se richiesto, riceve il token tunnel tramite campo nascosto/prompt protetto. Mai includerlo nel comando da copiare, nella cronologia della shell, negli argomenti visibili del processo o nei log.
6. Avvia i componenti posseduti dall'installazione, verifica salute locale e mostra `http://127.0.0.1:24105`.
7. Mostra il risultato reale di ogni passaggio. Un tunnel non raggiungibile non è «installazione completata e connessa».

Su macchina senza interfaccia grafica si usa un inoltro SSH verso la porta amministrativa locale. Non aprire 24105 su Internet per raggiungerla dal telefono.

### File e directory

Esempio di layout, **non ancora generato**:

```text
directory-programma/
  versions/<serverVersion>/    # codice e runtime, sostituibili
  updater/                    # supervisore limitato
radice-dati/                   # WorkingDirectory esplicita del servizio
  <bookId-A>.bookwriter.json   # tutto lo stato operativo del libro A
  <bookId-B>.bookwriter.json   # tutto lo stato operativo del libro B
  installation.json           # identità pubblica, configurazione e indice ricostruibile
  private/                    # vault, identità privata, registro autorizzazioni
  backups/                    # copie esplicite e pre-migrazione
  staging/                    # trasferimenti e sostituzioni non ancora confermate
```

Il file per libro resta nella **radice da cui il servizio lavora**, ma non dentro la versione del programma che l'updater sostituisce. Percorsi proposti: dati in `/var/lib/bookwriter` su Linux e `%ProgramData%\BookWriter\data` su Windows, modificabili nell'installer.

Nomi dei file derivati da ID validati, mai da titolo, URL o percorso ricevuto dal client. Il file comprende bozze, memoria privata e log: è sensibile, non necessariamente cifrato. Anche backup e file temporanei richiedono protezione. Disco pieno o file corrotto fermano il commit, non autorizzano a troncare o ripartire da un libro vuoto.

## 4. Cloudflare senza disturbare altri tunnel

Tre modalità:

| Modalità | Responsabilità di BookWriter |
| --- | --- |
| Tunnel dedicato | Proprio eseguibile/versione, token-file protetto, servizio con nome distinto e identificativo installazione. |
| Tunnel esistente | Mostra l'ingresso da aggiungere verso `http://127.0.0.1:24106`; l'autore configura il tunnel, BookWriter non lo modifica né riavvia. |
| Nessun tunnel | API dietro reverse proxy HTTPS amministrato dall'autore; accesso HTTP loopback solo per prove consapevoli e con limiti del browser dichiarati. |

Il pannello **24105 non viene inoltrato**. La porta API proposta è **24106**, su loopback; il tunnel espone solo questa. Collisioni sulle porte bloccano l'installazione o richiedono una scelta esplicita, senza terminarne il processo proprietario.

Non eseguire alla cieca `cloudflared service install/uninstall`: i servizi predefiniti sono condivisibili con altre applicazioni. Non toccare `~/.cloudflared`, il servizio `cloudflared`, configurazioni, registro o binari di altre installazioni. Il servizio dedicato Windows richiede un wrapper con supporto SCM verificato, non basta chiamare `sc create` su un processo Node qualunque.

Un token di tunnel permette di eseguire un connettore: **non assegna da solo hostname e DNS**. Dominio, tunnel e route pubblica devono essere predisposti nel proprio account Cloudflare; la guida deve spiegare questi passaggi. Non richiedere un token amministrativo Cloudflare generale per comodità.

Usare `--token-file` con una versione compatibile di `cloudflared`; il file è leggibile solo dal servizio competente. Non attivare log `debug` del tunnel: possono contenere tutti gli header. Rotazione del token tunnel e aggiornamento del connettore sono azioni distinte dalla rotazione del token BookWriter e dall'aggiornamento del motore.

Cloudflare Access può essere una protezione aggiuntiva gestita dall'autore, ma non sostituisce `apikey`; la compatibilità con login Access/CORS non è garantita senza prove specifiche. Nessuna impostazione automatica che esponga tutta la LAN.

## 5. Pairing, token e permessi

Il pannello locale è protetto da un bootstrap accessibile al solo amministratore della macchina. Essere su loopback **non basta**: verifica `Host`/`Origin`, protezione CSRF e contro DNS rebinding, sessione locale e nessuna apertura indiscriminata CORS.

Flusso proposto:

1. L'amministratore apre il pannello e richiede «Abbina un client».
2. Il server genera un codice monouso, valido **5 minuti**. Non appare nella pagina API pubblica o nei log.
3. Nel client si inseriscono URL e codice; si confronta l'impronta dell'identità con il pannello locale.
4. Il pannello mostra la richiesta pendente e i permessi. L'amministratore approva; il codice da solo non autorizza l'aggiornamento del software.
5. Il client riceve il token una volta, lo cifra in IndexedDB e lo usa soltanto nell'header **`apikey`**. Si può anche incollare un token emesso dal pannello.

Token con almeno 256 bit casuali, hash sul server, confronto a tempo costante, revoca/rigenerazione per client e revoca generale. Il server mostra metadati e data d'uso, non il segreto già rilasciato. Una rigenerazione invalida il vecchio token e chiude gli stream autorizzati da quello: non c'è un token universale immutabile.

Permessi proposti: lettura libreria, modifiche dei libri, avvio/pausa del motore e, **separatamente**, gestione degli aggiornamenti. Quest'ultimo richiede approvazione amministrativa locale e non segue il profilo cloud.

Più client possono supervisionare lo stesso libro; le mutazioni concorrenti sono controllate per revisione. «Client multipli» non significa che ogni client possa sostituire una snapshot intera o rimuovere libri agli altri.

## 6. Credenziali e impostazioni

Tre segreti distinti, mai intercambiabili:

| Segreto | Uso | Dove |
| --- | --- | --- |
| Token BookWriter | Accesso client → server | IndexedDB cifrato; vault cloud se scelto; hash nel registro server. |
| Chiavi AI e PAT GitHub | Server → provider e GitHub | Vault server separato dai libri, inviati con consenso e destinazioni riepilogate. |
| Token Cloudflare | Connettore → Cloudflare | Solo macchina server, file protetto; mai libro, profilo cloud o bundle Pages. |

Il vault del server usa cifratura autenticata e una chiave d'installazione protetta dal sistema operativo: DPAPI/identità del servizio su Windows; credenziale del servizio o chiave in file con permessi stretti su Linux. Un avvio non presidiato implica un segreto recuperabile dalla macchina: **non è E2EE** e non protegge da un amministratore/host compromesso.

Se si sceglie uno sblocco manuale con passphrase, dopo un riavvio il motore attende lo sblocco. Non promettere contemporaneamente passphrase mai conservata e riavvio autonomo già sbloccato. Mai passare la passphrase cloud al server per sbloccare tutto il profilo.

Si delegano soltanto credenziali necessarie ai libri selezionati. Il server non riceve access/refresh token Google o Microsoft: il cloud resta gestito dal browser. Revocare un client non cancella da solo chiavi AI/PAT già delegati né ferma un runner autorizzato; sono azioni amministrative distinte e visibili.

Il server conserva una versione delle impostazioni attive. Cambi da un altro client richiedono CAS e regole correnti sul libro fermo, senza sovrascritture di configurazioni da una vecchia copia del cloud. Tariffe e policy usate da un task vengono fotografate come oggi.

**Attenzione a `localhost`:** in esecuzione remota indica il PC server, non il portatile o telefono. Ogni endpoint loopback richiede riconferma/mappatura amministrativa; non rimappare automaticamente né dedurre capacità dal nome del modello.

## 7. Sincronizzazione nell'ordine richiesto

### All'apertura di un client

1. **Google/Microsoft, se collegato:** recupera e sblocca profilo/vault; acquisisce connessioni server e destinazioni GitHub consentite. Nessun manoscritto viaggia in Drive/OneDrive.
2. **GitHub:** verifica le repository associate con la credenziale corrispondente; applica import/fast-forward sicuri ai libri locali. Per i libri già affidati al server raccoglie le informazioni remote in staging, senza sovrascrivere la replica attiva.
3. **Server, se collegato:** verifica identità/versioni e confronta inventario, autorità, revisione e baseline. Invia i nuovi libri adottati e scarica quelli mancanti; aggiorna le repliche con gli avanzamenti del server.
4. Si sottoscrive agli eventi autorizzati del server. Le successive pubblicazioni GitHub dei libri affidati sono responsabilità della sua outbox.

Non serve Google per usare un server, né GitHub per un libro senza repository. Le fasi assenti si saltano. Un errore in una repository blocca **quel** riallineamento, non nasconde gli altri libri; nessuna divergenza irrisolta viene trasferita al server come sostituzione autorizzata.

### Se GitHub e server sono diversi

L'ordine di sincronizzazione **non è un ordine di precedenza dei contenuti**:

- server avanti rispetto al proprio ultimo commit: si prende lo stato server; il server pubblica la propria outbox;
- GitHub avanti con un commit riconosciuto come ACK del server: si riallineano ricevute e repliche, senza duplicare il task;
- modifica esterna o lavoro locale non riconciliato: confronto a tre vie e scelta esplicita, conservando entrambe le copie; niente merge per data o «vince quello che scarico per ultimo»;
- ID del libro uguale con origini non riconosciute: conflitto, non deduplicazione per titolo;
- libro nuovo sul client A e altro libro nuovo sul client B: dopo adozione/sync entrambi compaiono su A, B e server, anche senza GitHub.

Le ricevute distinte indicano: **salvato nella replica**, **confermato sul server**, **pubblicato su GitHub** con revisione/SHA. «Connesso» non significa «tutto salvato».

### Più PAT e repository

Oggi il profilo contiene un solo `githubToken`; più repository sono già possibili, più PAT nominati no. Il progetto comprende un registro versionato di credenziali con riferimenti espliciti per repository, migrazione del PAT legacy e scelta in caso di più credenziali utilizzabili. Mai dedurre repository dal contenuto del token o usare il primo PAT che risponde.

La discovery resta limitata, validata e senza autoselezione da un elenco incompleto. Aggiungere un PAT non autorizza a importare tutte le repository né a condividerle tutte con il server.

### Offline, cancellazioni e ritorno al locale

- Offline: si legge l'ultima replica; le modifiche diventano **bozze non confermate** con revisione di partenza. Non toccano la copia confermata o una outbox GitHub locale del libro server.
- Alla riconnessione i comandi sono riconciliati/idempotenti; un conflitto conserva la bozza. Mai avvio AI offline per «aiutare» il server.
- «Rimuovi da questo dispositivo» non elimina il libro sul server. Eliminazione dalla libreria condivisa richiede un comando confermato e un marcatore durevole che impedisca la resurrezione da client vecchi.
- Scollegare il server non riprende localmente i libri affidati. Serve «Riporta questo libro sul dispositivo»: pausa e conferma durevole del server, snapshot aggiornata, rilascio dell'autorità e del lease.
- Server non raggiungibile: nessun subentro sicuro dedotto da timeout. Recupero amministrativo dopo arresto dell'originale, oppure copia con **nuovo ID**, dichiarata indipendente e non sincronizzata sulla stessa repository.

## 8. Salvataggi GitHub sul server

Il server assume le stesse responsabilità del client: PAT scoped, repository private raccomandate, consenso per pubbliche, `force:false`, outbox durabile, SHA esatta e marker per esiti incerti.

Ogni compito riuscito accoda il libro completo anche se non congelato. Gli invii automatici mantengono la distanza attuale di due minuti per libro e i limiti condivisi del PAT; «Salva ora» e fine corsa richiedono l'invio immediato consentito dal protocollo. Non rimuovere queste protezioni per interpretare «ogni turno» come scrittura remota per ogni risposta.

Una scena fusa non ancora confermata resta l'unico blocco editoriale alla pubblicazione. Il limite di **12 MiB** per push resta: spostare sul server non lo risolve. In caso di GitHub indisponibile, lease e rinnovi rispettano ADR 0166, senza dichiarare libero il blocco o conservare indefinitamente un rinnovo presunto.

Il server pubblica anche senza client connessi. I browser non eseguono in parallelo la propria outbox per quei libri; il pannello Archivio invia comandi al server e mostra il suo ACK.

## 9. Aggiornamento dal client

1. Il client mostra versione installata e release ufficiale compatibile disponibile, con note e possibili interruzioni.
2. «Aggiorna server» richiede permesso amministrativo e conferma. Invia l'identificativo della release, **non un URL eseguibile, un comando shell o un pacchetto fornito dal browser**.
3. Il server controlla autonomamente manifest firmato, provenienza, digest, spazio, piattaforma, versione minima e compatibilità dei dati prima di disturbare il runner.
4. Pianifica manutenzione a fine task. L'autore può annullare l'attesa; un arresto immediato è una scelta separata con possibile costo AI.
5. Sospende nuovi comandi mutanti, salva runner/outbox/intenti e backup pre-migrazione; installa in un percorso affiancato.
6. Il supervisore avvia la nuova versione, completa/valida migrazioni e verifica salute locale, identità e archivio prima di riabilitare lavoro e tunnel API.
7. Il client si ricollega allo stesso server e mostra l'esito persistito. Una disconnessione durante il riavvio non è né successo né fallimento dimostrato.

Un aggiornamento non applica un risultato AI incompleto e non ripete una chiamata con addebito incerto. Riprende un run precedentemente autorizzato solo se il checkpoint è pulito, impostazioni/budget/lease ancora validi e la scelta di ripresa dopo manutenzione era esplicita.

Firma invalida: resta in funzione la versione corrente. Nuova versione che non parte: rollback del binario e, solo se necessario e coerente, dei dati pre-migrazione; nessun rollback sopra modifiche successive. Nessuna cancellazione automatica dei manoscritti o dei backup per liberare spazio. Il connettore Cloudflare altrui non viene aggiornato insieme a BookWriter.

## 10. Retry del lavoro: short-term e long-term

Il motore, sia locale sia server, prevederà **short-term retry** (tentativi ravvicinati) e **long-term retry** (dopo l'esaurimento, pausa di minuti configurabili e nuovo gruppo sullo stesso compito). Il numero dei cicli differiti è impostabile; illimitato solo con scelta esplicita. In attesa si vedono scadenza, contatori e annullamento.

Il server può riprovare anche senza browser; il client locale solo quando la pagina è attiva. Il budget della sessione e i tentativi non si azzerano alla ripartenza. Attese, consensi e timer appartengono all'autorità del libro: i client non duplicano il retry server. Lease/lock si rilasciano durante l'attesa e si ricontrollano prima di AI, insieme a libro, consensi e budget. La politica non ritenta da sola blocchi di sicurezza o aggiornamenti/installazioni.

**Runtime locale in preparazione:** [specifica completa](retry-policy.md), [ADR 0168](../ADR/0168-short-and-long-term-retry.md), [F03](../features/F03-two-level-retry.md) e [stato effettivo del server](personal-server-development.md).

## 11. Cosa non si trasferisce implicitamente

- Copie locali pre/post di prosa o libro, consensi e ledger dello store `meta`, bozze del pannello bloccato, stato del tema/menu, auto-resume e chiavi del dispositivo.
- Prompt e conversazioni conservate nel browser: il server ha una politica propria. Testo live autenticato visibile come oggi; conservazione delle conversazioni sul server solo con scelta dedicata, e invio a GitHub con un'ulteriore scelta.
- Permessi narrativi sensibili importati: import ZIP/GitHub non li rende consensi autenticati. L'adozione autenticata di un libro è distinta da un import; il riepilogo richiede di riconfermare le concessioni ai ruoli, altrimenti si revocano.

Gli strumenti storici locali non possono presentare l'aggiornamento di una replica come checkpoint esatto di tutti i task svolti a browser chiuso. Nessun backfill inventato; un eventuale archivio testuale server richiederà consenso e limiti specifici prima di essere sviluppato.

## 12. Limiti e verifiche ancora necessarie

Nessun server, installer o aggiornamento è stato provato da questa progettazione. Prima della disponibilità servono test reali di servizi e ripristino su Windows/Linux, crash e spazio esaurito, due client e due processi, tunnel già installati, revoca, incompatibilità e distribuzione firmata. I test simulati non certificano Cloudflare, provider AI o filesystem dopo perdita di alimentazione.

Un server unico è un punto di guasto e una copia sensibile in più, non un backup garantito. Prevedere esportazione content-only e backup separato del vault/identità protetto da un segreto indipendente. Copiare soltanto il JSON del libro non recupera le credenziali; copiare a caldo la directory non garantisce uno stato coerente. Ripristino o trasloco richiedono arresto dell'originale e nuova verifica delle autorità.

### Riferimenti esterni consultati il 2026-11-19

- [Cloudflare: permessi e rotazione dei token tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/) — il token esegue il tunnel, non crea il routing.
- [Cloudflare: parametri di esecuzione](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/) — `--token-file` da 2025.4.0, log `debug` sensibili, aggiornamenti diversi su Windows.
- [Servizio Windows](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/) e [Linux](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/) — i servizi predefiniti non sono un namespace esclusivo di BookWriter.
- [Node: single executable applications](https://nodejs.org/api/single-executable-applications.html) — possibilità di distribuire il runtime, non prova del packaging BookWriter.
