# F02 — Server personale, motore unico e sincronizzazione dei client

- Stato: **prima tranche sperimentale implementata nel sorgente; feature completa non disponibile**.
- [x] Pacchetto npm CLI (`npx setup/start/status/doctor/update`), supervisore, aggiornamento firmato da registry/attestazione, pannello client e workflow OIDC ([ADR 0171](../ADR/0171-npm-server-package-supervised-updates-and-cloudflare-connector.md)). Prima pubblicazione npm non eseguita: serve la relazione Trusted Publisher del proprietario del package.
- [x] Connettore Cloudflare dedicato, gestito dal pannello locale 24105; altri cloudflared/servizi restano invariati. Route/DNS e installazione di cloudflared restano all'autore.
- Data: 2026-11-19.
- [ADR 0167](../ADR/0167-optional-personal-server-and-shared-engine.md) · [Guida progettuale](../docs/personal-server.md) · [Contratto tecnico](../docs/personal-server-protocol.md).
- Nessuna issue o PR aperta da questa attività; nessuna versione, data di rilascio o pubblicazione promessa.

## Obiettivo

Lo stesso motore TypeScript gira nel browser o in un server personale Node su Linux/Windows. Con la modalità server attiva, più client supervisionano una libreria condivisa; il server conserva un file per libro ed esegue AI, lease **e salvataggi GitHub con PAT**, anche senza browser aperti.

## Avanzamento reale dopo la richiesta di implementazione

[Prova da sorgente e matrice dei limiti](../docs/personal-server-development.md). T1 ha l'estrazione fisica in `src/engine`, la porta `HostRuntime` e il contratto condiviso eseguito su entrambi gli host (mancano le fixture di parità sui prompt); T2 ha archivio/vault/lock e runner su file; T3 ha API/admin/pairing e connessione cifrata; T4 ha un catalogo parziale, nuove creazioni e repliche non eseguibili; T5 riutilizza i protocolli GitHub con PAT per libro e test di ACK perso. I gate completi e le prove Windows restano da superare. **T6–T8 non sono implementate**: non segnare come conclusa la feature né attivare «tutte le richieste» come se tutti i comandi fossero disponibili.

I contratti `src/server/test/controller-lifecycle.test.mjs` coprono anche ammissione concorrente, ordine avvio/pausa, revoca prima dell'attivazione, spegnimento con operazioni pendenti, configurazione esclusiva ed edit autore durante AI. Sono prove sintetiche del ciclo operativo, non una certificazione di tutte le tranche.

**Review (0.32.1):** primo push e run GitHub verificati con un provider sintetico e il gate di autorità di produzione; ricevute di origine escluse dalla potatura; confronto revisione della configurazione, delega/revoca separata del PAT, template editoriale e recupero idempotente della creazione. Gli override sono leggibili dal runner ma non ancora modificabili dall'editor remoto. I punti di T6–T8 restano aperti.

## Requisiti tracciati

| ID | Requisito | Tranche |
| --- | --- | --- |
| R01 | Engine unico, nessuna regressione della modalità locale. | T1 |
| R02 | Stato file per libro, atomico con attività/outbox, ripresa e più libri. | T2 |
| R03 | Admin loopback 24105, pairing e più client, token `apikey` rigenerabili. | T3 |
| R04 | Comandi remoti, modalità server e repliche IndexedDB coerenti. | T4 |
| R05 | PAT/chiavi delegati con consenso, lease e push GitHub autonomi sul server. | T5 |
| R06 | Google/Microsoft → GitHub → server, libreria su tutti i client, multi-PAT esplicito. | T6 |
| R07 | Installer Linux/Windows e tunnel facoltativo isolato da quelli esistenti. | T7 |
| R08 | Versioni, distribuzione firmata e aggiornamento/riavvio richiesti dal client. | T8 |
| R09 | Pagina client: connessione prima di download, guida, sicurezza e diagnosi. | T3–T8 |
| R10 | Short-term e long-term retry nello stesso motore, con minuti configurabili, stato durevole e budget sessione conservato. | T1–T2, T4–T5; [F03](F03-two-level-retry.md) |

## Piano incrementale

### T1 — Estrarre il motore senza cambiare il prodotto

- [x] Inventario delle dipendenze host in dominio, runner e casi d'uso, incluse AI autonome, recovery e GitHub.
- [x] Porte di persistenza transazionale, guardia, credenziali, tracce e lock (`HostRuntime`). Rete e orologio/ID restano globali standard (`fetch`, `crypto`), non portate: nessun host ha bisogno di sostituirli.
- [x] Adapter browser e test di contratto sul codice esistente, poi pacchetto `src/engine` (`src/engine/src/testing/host-contract.ts`, 14 casi su browser e server).
- [x] Regola di dipendenze: nessun import React/DOM/IndexedDB/Node concreto nel motore (`tsc` senza DOM nel motore + `tests/engine-boundary.test.mjs`).
- [ ] Fixture di parità per pipeline, contesti per ruolo, budget, tools, merge, modifiche autore e salvataggi.
- [ ] Predisporre le porte necessarie alla politica short-term/long-term di F03; timer host-specifici, senza duplicare classificazione o contatori né attivare nuove ripartenze dal solo refactor.

**Uscita:** modalità locale invariata e suite browser verde. Non aggiungere un interruttore server fittizio o un secondo runner copiato.

### T2 — Host Node e archivio durevole

- [ ] Un contenitore per libro con revisione/CAS, attività, bozze, outbox, intenti, ricevute e checkpoint.
- [ ] Lock OS di radice dati e sezioni critiche per libro; chiamate AI fuori dal lock di commit.
- [ ] Vault separato, quote, file temporanei/sostituzioni, recupero di file incompleti e formato futuro.
- [ ] Scheduler multi-libro con limiti di concorrenza configurati e runID indipendenti.
- [ ] Ripresa dopo arresto/crash: nessun replay di richiesta AI incerta, nessun audit di successo inventato.
- [ ] Attesa long-term persistita nel file con generazione/CAS, runId logico e contatori, stessa semantica dell'adapter browser F03.
- [ ] Contratti degli adapter eseguiti su file reali sia Linux sia Windows.

**Uscita:** host controllabile nei test senza API pubblica; crash interposto non lascia canone senza audit/outbox. Nulla gira su dati reali dell'autore.

### T3 — Connessione sicura e pannello locale

- [ ] Admin solo loopback 24105 e API separata; bootstrap/sessione, Host/Origin/CSRF e rebinding.
- [ ] Pairing monouso/5 minuti/approvazione locale, rate limit e token per client con hash/revoca.
- [ ] Scope separati per dati, motore e aggiornamenti; token mai in URL, log o risposte normali.
- [ ] Handshake identità/versioni, CORS esatto e fetch streaming autenticato.
- [ ] Scheda client con URL/token prima delle guide, token cifrato/fenced in IndexedDB e verifica esplicita.

**Uscita:** connessione verificabile, senza avviare AI o caricare libri automaticamente. La scheda non dichiara disponibili pacchetti che non esistono.

### T4 — Autorità e comandi end-to-end

- [ ] Migrazione del formato libro per autorità/epoca, import/fork sicuri e blocco versioni incompatibili.
- [ ] Handoff idempotente e recuperabile, stop/restituzione al locale e gestione di ACK persi. _Fatto per libri locali senza GitHub (a senso unico) e per libri GitHub con adozione e rilascio ([ADR 0170](../ADR/0170-github-book-adoption-and-release.md)); resta la prova con GitHub reale._
- [ ] Facade locale/remota per **tutti** i comandi, inclusi AI edit/merge, impostazioni, dossier e controlli editoriali.
- [ ] Repliche e cursori commit atomici IndexedDB, scope per libro, fence e nessun auto-resume locale di run server.
- [ ] Modifiche concorrenti e bozze offline separate; rimozione locale distinta da eliminazione condivisa.
- [ ] Matrice UI che dichiara le funzioni storiche solo locali e le eventuali funzioni non ancora supportate in remoto.

**Uscita:** due client sullo stesso host di test vedono gli stessi libri e nessun secondo runner parte in caso di disconnessione. L'interruttore per uso reale resta bloccato finché GitHub/credenziali e installer non superano i gate successivi.

### T5 — Server autonomo anche con GitHub

- [ ] Provisioning esplicito delle chiavi AI/PAT e mapping degli endpoint server-locali.
- [ ] Lease, heartbeat, tolleranze, clock e `force:false` dello stesso protocollo browser.
- [ ] Outbox server, accodamento per compito, 120 s, forza a fine run e regolatore per PAT tra libri.
- [ ] Push/ACK/intento nello stesso contenitore durevole, recovery marker e nessun secondo PATCH dubbio.
- [ ] Per libri server, esclusione dell'outbox browser; «Salva ora» inoltrato al server.
- [ ] Prova a browser chiusi con avanzamento, commit remoto e successiva riconnessione dei client.

**Uscita:** lavoro completo senza client, inclusi salvataggi GitHub. Conservare blocco scene fuse, consenso repo pubbliche, 12 MiB e stop prudente per PAT/lease/usage incerti.

### T6 — Profilo cloud e ordine di riallineamento

- [ ] Schema cloud versionato per connessioni e multi-PAT; migrazione legacy senza perdita del segreto.
- [ ] URL/identità pubbliche e credenziale nel vault; niente token tunnel o aggiornamento amministrativo nel cloud.
- [ ] Credenziale di profilo con token derivati per dispositivo, revoca a cascata e conferma della destinazione.
- [ ] Coordinatore Google/Microsoft → GitHub → server, errori per libro e nessun overwrite da fase precedente.
- [ ] Libri nuovi da due client, server avanti rispetto a GitHub, edit esterno, offline e grant revocato.
- [ ] Nessun payload narrativo nei file Drive/OneDrive, test di privacy e di vecchi writer cloud.

**Uscita:** nuovo browser ritrova connessione e libreria dopo consenso, senza riavviare automaticamente AI né sostituire lavoro non sincronizzato.

### T7 — Installazione e distribuzione iniziale

- [ ] Pacchetti con runtime Node fissato, script guidati, licenze, dipendenze e firme.
- [ ] Servizio Linux/systemd e Windows/SCM con privilegi minimi, percorsi con spazi e riavvio OS.
- [ ] Data root stabile e porte 24105/24106, diagnostica delle collisioni senza terminare processi altrui.
- [ ] Tunnel dedicato facoltativo con token-file e namespace proprio; ingresso manuale su tunnel esistente.
- [ ] Test con altri servizi/tunnel già presenti: install, repair, update e uninstall non li modificano.
- [ ] Uninstall conserva dati per default; eventuale cancellazione richiede decisione separata.
- [ ] GitHub Releases reali e download nella pagina client solo per piattaforme effettivamente collaudate.

**Uscita:** installazione/ripartenza autonoma provata su OS dichiarati. Creazione hostname/DNS Cloudflare spiegata, non dedotta dal token.

### T8 — Aggiornamento remoto e rilascio

- [ ] Manifest firmato, chiavi fidate, anti-downgrade e verifica indipendente dal client.
- [ ] Permesso update locale separato, comando idempotente con releaseId, nessuna shell/URL arbitrari.
- [ ] Manutenzione a fine task, backup coerente, versioni affiancate, supervisore e health check.
- [ ] Migrazioni multi-libro recuperabili dopo crash, rollback coerente e blocco se non dimostrabile.
- [ ] Riconnessione client dopo riavvio con risultato persistito, inclusi fallimento e rollback.
- [ ] Guide client complete, matrice compatibilità, runbook backup/ripristino e modello di minaccia aggiornati.

**Uscita:** solo dopo questa tranche la feature completa soddisfa la richiesta di installazione e auto-update. Rilasci anticipati possono essere soltanto prove esplicitamente sperimentali con limiti, mai descritti come server completo.

## Scenari di accettazione obbligatori

Tutti da provare, nessuno già superato dalla sola documentazione:

1. **Parità:** stesso libro e risposte simulate in locale/server producono gli stessi task, prompt per ruolo, esiti e canone; nessun segreto nuovo ai lettori ciechi.
2. **Browser chiusi:** il server conclude un task, registra usage/outbox e pubblica su GitHub; alla riapertura due client ricevono gli avanzamenti, senza nuove chiamate AI.
3. **Due libri/due client:** A crea X, B crea Y; dopo sync entrambi vedono X/Y. Nessuna deduplicazione per titolo o scambio di attività/stream.
4. **Concorrenza:** due edit con la stessa revisione, un solo commit; la bozza perdente resta disponibile. Edit autore durante AI conserva l'edit e scarta correttamente l'output stale con usage.
5. **Risposta persa:** ripetere lo stesso commandId non avvia un altro run. Timeout di un push applicato si risolve da marker senza secondo PATCH.
6. **Crash/spazio:** interruzioni prima/dopo ogni fase del commit e dell'update, disco pieno e file corrotto non producono successo parziale o libro vuoto.
7. **Esclusività:** due processi sullo stesso archivio non partono insieme; replica browser e server non eseguono insieme un libro affidato; server assente non abilita fallback.
8. **Sicurezza:** pairing scaduto/riusato, brute force, token revocato/ruotato, CORS/Host falsi, traversal, reparse point, SSRF e stream non autorizzati sono respinti senza dati sensibili nei log.
9. **Cloud:** profilo nuovo/legacy, vault passphrase/account, URL cambiata, più PAT e grant revocato; nessuna prosa, token OAuth o token Cloudflare nei file cloud.
10. **Ordine sync:** cloud → GitHub → server rispettato, ma GitHub vecchio non regredisce il server; divergenza esterna preserva copie e chiede scelta.
11. **Installer:** macchina pulita e macchina con tunnel altrui, porte occupate, percorsi con spazi, riavvio OS e uninstall, su Windows e Linux dichiarati.
12. **Update:** release corretta, firma/digest errati, piattaforma sbagliata, downgrade, dati troppo recenti, mancanza permessi, due richieste, riavvio fallito e rollback; nessuna esecuzione di input arbitrario.
13. **UI:** desktop/mobile, tastiera, target 44 px, token mascherato, conferme e stati separati locale/server/GitHub; nessun falso «aggiornato» dopo sola richiesta.
14. **Privacy storica:** opt-in locali non trasferiti; nessun checkpoint testuale remoto inventato, consensi narrativi importati/trasferiti gestiti senza concessioni implicite.
15. **Retry nel tempo:** dopo i retry short-term si attende il numero di minuti configurato; un solo risveglio long-term, cancellabile e con budget/sessione originari, anche dopo riavvio. Client collegati non eseguono un secondo retry.

## Gate di qualità e decisioni da chiudere

- [ ] Ogni tranche: npm/lockfile secondo runbook, typecheck, test dominio/adapter, smoke e build; Playwright desktop/mobile senza skip dei percorsi critici.
- [ ] CI aggiuntiva server Linux e Windows per persistenza, servizi, update e packaging; CI frontend/EPUBCheck/Pages resta obbligatoria e separata.
- [ ] Firmare e verificare artifact reali; una build CI riuscita non dimostra installazione o pubblicazione avvenute.
- [ ] Fissare runtime Node LTS, versioni OS/filesystem supportati, wrapper SCM/lock OS e licenze.
- [ ] Fissare proprietari/rotazione delle chiavi di firma, repository/canale delle release e procedura di emergenza.
- [ ] Validare limiti iniziali di file/API, budget del PAT per più libri, politica delle ricevute e conservazione server delle conversazioni.
- [ ] Confermare con l'autore le assunzioni proposte: server personale singola identità, admin locale separato dall'API e autorizzazione update distinta dal pairing normale.

Nessun commit, push, release o deploy senza richiesta. Se durante lo sviluppo viene assegnata/aperta una issue o PR effettiva, collegarla alla sessione; i riferimenti storici non sono ticket aperti da questa specifica.
