# BookWriter Personal Server

Pacchetto npm pubblico **sperimentale** di BookWriter Personal Server. Non è un installer di servizi e non crea un servizio Windows/systemd. `start` resta in primo piano ma supervisiona il proprio processo server: aggiorna soltanto dopo una richiesta esplicita, con un pacchetto npm firmato e verificato.

## Requisiti

- Node.js 22.14 o successivo;
- npm;
- Git 2.32 o successivo;
- Linux con `flock`, oppure Windows con PowerShell.

macOS non è supportato per l'esecuzione del server.

## Comandi

```bash
npx bookwriter-personal-server setup
npx bookwriter-personal-server start
npx bookwriter-personal-server status
npx bookwriter-personal-server update
npx bookwriter-personal-server update --to 0.1.0
npx bookwriter-personal-server doctor
```

È possibile scegliere la directory dati con `--data-root DIRECTORY` per `setup`, `start` e `update`:

```bash
npx bookwriter-personal-server setup --data-root /percorso/bookwriter
npx bookwriter-personal-server start --data-root /percorso/bookwriter
```

La directory predefinita è `BOOKWRITER_DATA_ROOT`, se impostata; altrimenti:

- Windows: `%APPDATA%\BookWriter\data`;
- Linux: `$XDG_DATA_HOME/bookwriter`, o `~/.local/share/bookwriter`;
- macOS è indicato per completezza come `~/Library/Application Support/BookWriter`, ma l'avvio è rifiutato.

`setup` crea una directory privata e installa una versione verificata del runtime npm in `<data-root>/private/npm-runtime`. Le richieste di installazione e aggiornamento usano soltanto il pacchetto fisso `bookwriter-personal-server`, versioni semver esatte, installazioni senza script e `npm audit signatures`. Token e credenziali non sono memorizzati nello stato npm.

`start` supervisiona esclusivamente il processo server figlio che avvia. Resta in primo piano e inoltra `SIGINT`/`SIGTERM`. Se il server scrive una richiesta valida in `private/update-request.json` e si arresta ordinatamente, il supervisore installa quella versione esatta, ne verifica il pacchetto e le firme npm, la attiva e riavvia il server. Sono ammessi al massimo tre riavvii di aggiornamento all'ora. Un aggiornamento non valido o non verificato lascia attiva la versione precedente; il risultato privo di dettagli sensibili viene scritto in `private/update-result.json`.

Il comando `update` è sempre un'azione locale esplicita e non arresta né modifica un processo già in esecuzione. La nuova versione verrà usata al prossimo avvio supervisionato.

## Rete e sicurezza

- amministrazione: solo loopback su `http://127.0.0.1:24105`;
- API: solo porta 24106; l'eventuale tunnel deve inoltrare esclusivamente questa porta;
- il pannello amministrativo non va esposto su Internet;
- il token Cloudflare si inserisce nel pannello amministrativo loopback, mai negli argomenti della shell o del client SPA;
- il server gestisce un connettore `cloudflared` dedicato con token-file; non installa il binario e non modifica, arresta o aggiorna tunnel/servizi già presenti.

I manoscritti e i file operativi del server sono sensibili e non sono cifrati da questo pacchetto. Il pacchetto e il flusso di aggiornamento sono sperimentali: non sono un installer firmato né una release completa del server personale.

## Stato di controllo e aggiornamenti richiesti dal client

Il contratto del file `private/update-request.json` è intenzionalmente stretto:

```json
{
  "schemaVersion": 1,
  "packageName": "bookwriter-personal-server",
  "version": "0.1.0",
  "requestedAt": "2026-11-20T00:00:00.000Z",
  "requestId": "00000000-0000-0000-0000-000000000000",
  "source": "client"
}
```

Il file è limitato in dimensione, con chiavi esatte, una versione semver esatta, timestamp ISO e UUID. Non accetta URL, script, comandi o nomi di pacchetto alternativi. Il supervisore elimina soltanto la richiesta corrispondente dopo attivazione riuscita; in caso di errore la richiesta resta disponibile per diagnosi controllata.
