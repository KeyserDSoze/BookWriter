# ADR 0171 — Pacchetto npm del server, supervisore aggiornamenti e connettore Cloudflare dedicato

- Stato: **implementato nel sorgente; prima pubblicazione npm non ancora eseguita**.
- Data: 2026-11-20.
- Integra ADR 0167 (server), 0169 (Git sul server) e le regole di firma degli aggiornamenti.
- [Runbook npm](../docs/personal-server-npm-cli.md) · [Guida utente](../docs/personal-server-development.md).

## Richiesta

Il server non deve richiedere al primo uso il clone GitHub e la catena `npm ci → typecheck → build`. L'autore chiede installazione e avvio con `npx`, un aggiornamento verificato richiedibile dal client, e supporto Cloudflare che non spenga né modifichi un tunnel già presente.

## Decisioni

1. **Pacchetto pubblico `bookwriter-personal-server`.** Il pacchetto contiene solo `dist/cli.mjs`, `dist/server.mjs`, le sourcemap e il README. Nessuna dipendenza runtime, sorgente, test, credenziale o dato autore. Il binario npm è `bookwriter-server`. Node.js minimo 22.14. La catena di pubblicazione è GitHub Actions → OIDC trusted publishing → npm, con provenance; nessun `NPM_TOKEN` nel workflow.
2. **`npx` è il supervisore, non il server.** `setup` prepara una directory dati e installa una versione esatta sotto `<dati>/private/npm-runtime`; `start` avvia come figlio il solo server scelto e resta in primo piano. `update` è locale/esplicito, oppure una richiesta remota stretta del client. Il supervisore gestisce solo il proprio figlio e inoltra SIGINT/SIGTERM: non termina processi di terzi.
3. **Installazione senza lifecycle script e aggiornamento firmato.** Ogni versione viene installata in staging con `npm install --ignore-scripts`, poi verificata con `npm audit signatures` (firme del registry + attestazione di provenienza) prima di attivarla. Stato e runtime sono versionati; fallimento lascia l'esatta versione precedente. Versione semver esatta, nome pacchetto costante, registry ufficiale fisso; mai URL/script/comando ricevuto dal browser.
4. **Aggiornamento dal client.** `GET /api/v1/updates` legge il solo packument del pacchetto e offre una versione soltanto se più recente e firmata/attestata; `POST /api/v1/updates` richiede token con scope `update`, versione installata esatta, versione prescelta e conferma. Il server non aggiorna se ha libri in esecuzione/effetti GitHub attivi. Il controller passa in manutenzione, scrive `private/update-request.json` (chiavi strettissime), il supervisore arresta ordinatamente il proprio figlio, installa/verifica/attiva e riparte. Massimo tre richieste/ora. Solo questo flusso può diventare il pulsante di aggiornamento del client.
5. **Nessuna richiesta di aggiornamento da URL arbitrario.** Un server avviato direttamente con `node dist/server.mjs` mostra la versione ma `canRequest:false`; serve `npx bookwriter-personal-server start` e `BOOKWRITER_SUPERVISED=1`. Il browser non esegue npm, shell, URL o script.
6. **Cloudflare è aggiuntivo e separato.** Il token si inserisce solo nel pannello amministrativo loopback 24105. Il server gestisce **un solo connettore figlio dedicato**, con `cloudflared tunnel run --no-autoupdate --token-file`. Il token resta in `<dati>/private/cloudflare-tunnel-token` (0600 su POSIX), mai negli argomenti né nelle risposte. Un altro `cloudflared`, servizio o configurazione sotto `~/.cloudflared` viene solo rilevato: non viene fermato, modificato né disinstallato. Il connector BookWriter è separato. Hostname, route e DNS devono già esistere nel proprio account Cloudflare; il token autorizza il connettore, non assegna il routing.
7. **Nessuna installazione automatica di `cloudflared`.** Il server rileva una versione ≥2025.4.0 e mostra link/errore altrimenti. Il token-file e il pannello locale sono disponibili; pacchetti, servizi Windows/Linux e gestione remota Cloudflare non sono simulati.

## Limiti e prerequisiti della prima release

- La prima pubblicazione del nome npm non può essere completata senza una configurazione del Trusted Publisher nel profilo del proprietario del pacchetto su npmjs.com. I workflow non contengono token npm e la sola CI non crea quella relazione.
- Il tag `server-vX.Y.Z` deve coincidere con `src/server/package.json`; l'azione pubblica con provenance. Non fare il primo release con un token salvato nel repository.
- npm `audit signatures` verifica firme/attestazioni installate: è una prova della provenienza pubblicata, non un certificato che il codice sia innocuo. Una policy di sicurezza aggiuntiva e una release firmata del server restano necessarie se in futuro si distribuiscono binari firmati.
- Nessuna prova con registry/npm proxy reale o Cloudflare reale in questa tranche; l'API resta sperimentale, il pannello admin loopback.
