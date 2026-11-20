# Server personale con npm: installazione e aggiornamento verificato

> **Sperimentale.** Il pacchetto npm e il workflow sono preparati nel sorgente. La prima pubblicazione resta bloccata finché il proprietario configura su npmjs.com il Trusted Publisher per `publish-server-npm.yml`. La UI non nasconde questo limite.

## Utente

Requisiti: Node.js **22.14+**, npm recente, Git **2.32+** per le repository del libro e, su Linux, `flock` (`util-linux`). Windows usa PowerShell per il lock. macOS non avvia il server in questa tranche.

Scegli prima due percorsi distinti:

- **cartella di esecuzione** `$HOME/BookWriter-server` (Linux) o `$HOME\BookWriter-server` (Windows): è solo la directory del terminale e può contenere eventuali shortcut/script;
- **cartella dati** `$HOME/BookWriter-server-data` (Linux) o `$HOME\BookWriter-server-data` (Windows): contiene libri, vault, token, log e runtime npm. È questa la parte che devi conservare e proteggere.

Linux/macOS shell:

```bash
mkdir -p "$HOME/BookWriter-server"
cd "$HOME/BookWriter-server"
npx --yes bookwriter-personal-server setup --autostart --data-root "$HOME/BookWriter-server-data"
npx --yes bookwriter-personal-server doctor --data-root "$HOME/BookWriter-server-data"
npx --yes bookwriter-personal-server start --data-root "$HOME/BookWriter-server-data"
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\BookWriter-server" | Out-Null
Set-Location "$HOME\BookWriter-server"
npx --yes bookwriter-personal-server setup --data-root "$HOME\BookWriter-server-data"
npx --yes bookwriter-personal-server doctor --data-root "$HOME\BookWriter-server-data"
npx --yes bookwriter-personal-server start --data-root "$HOME\BookWriter-server-data"
```

Puoi eseguire `npx` da qualunque cartella: il pacchetto va nella cache npm. **Book e segreti non seguono quella cartella corrente**: seguono sempre il valore esplicito di `--data-root`. Usa lo stesso valore a ogni setup/start/update. Il programma non legge da `--data-root` solo perché coincide con la directory corrente.

Su Linux, aggiungere `--autostart` a `setup` crea il servizio utente `bookwriter-personal-server.service`, lo abilita e lo avvia. Per ripartire dopo il reboot anche senza un login dell'utente può essere necessario `sudo loginctl enable-linger <utente>`; il comando lo segnala. Su Windows un servizio automatico non è ancora incluso e `setup --autostart` rifiuta esplicitamente.

`setup` non chiede PAT/API key/tunnel token. Installa una versione esatta del pacchetto in `<dati>/private/npm-runtime/versions/<version>`, senza lifecycle script (`--ignore-scripts`), e richiede `npm audit signatures` prima di attivarla. Non clona BookWriter, non esegue `npm ci` sul frontend e non compila il progetto.

Il comando `start` è il supervisore: resta in primo piano e avvia **solo il proprio server figlio**. Se vuoi il servizio a ogni avvio del sistema, usa una policy locale dell'OS al momento: il pacchetto non installa ancora servizi Windows/systemd e non modifica installazioni di terzi.

### Aggiornare da terminale

```bash
npx --yes bookwriter-personal-server update --data-root "$HOME/BookWriter-server-data"
# oppure una release esatta verificata:
npx --yes bookwriter-personal-server update --data-root "$HOME/BookWriter-server-data" --to 0.1.0
```

L'operazione installa e verifica la nuova versione, ma non arresta un processo già attivo. La nuova versione viene usata al prossimo `start`. Per fermare il processo usa Ctrl+C; per l'aggiornamento coordinato dal client, usa il pannello Versione e aggiornamenti.

### Aggiornare dal client

Il pannello **Impostazioni → Server personale → Versione e aggiornamenti del server** mostra:

- versione installata;
- ultima release npm;
- stato della firma npm e dell'attestazione di provenienza;
- esito dell'ultimo aggiornamento.

L'aggiornamento è disponibile solo se:

1. il server è stato avviato da `npx bookwriter-personal-server start` (ha `BOOKWRITER_SUPERVISED=1`);
2. il token del client contiene lo scope separato `update`;
3. non ci sono libri in esecuzione né effetti GitHub attivi;
4. l'ultima versione è più recente, firmata dal registro e attestata;
5. l'autore conferma la versione esatta.

Il client non invia URL, script, pacchetto o comando: invia solo la versione esatta. Il server scrive `private/update-request.json`, entra in manutenzione e il supervisore:

1. arresta ordinatamente il proprio figlio;
2. scarica il pacchetto fisso `bookwriter-personal-server@version` da `registry.npmjs.org` con script disattivati;
3. esegue `npm audit signatures`;
4. attiva il nuovo runtime e riavvia;
5. conserva la versione precedente e scrive un risultato controllato se qualcosa fallisce.

Massimo tre riavvii per ora. Nessun fallback a URL arbitrari o esecuzione di shell dal browser.

## Cloudflare: già pronto oppure da attivare

### Se hai già configurato Cloudflare

Se nel tuo account esistono già **tunnel, hostname e route/DNS** che puntano a `http://127.0.0.1:24106`, non modificare nulla nel tunnel. Apri `http://127.0.0.1:24105`, completa il pairing e usa solo il pannello BookWriter. In questa macchina possono essere già presenti altri `cloudflared`: BookWriter li rileva e **non li modifica, riavvia, aggiorna o disinstalla**.

### Se il tunnel non esiste ancora

1. Installa `cloudflared`: per Cloudflare serve la versione documentata del connettore, almeno `cloudflared 2025.4.0` (Git 2.32 è un requisito diverso di BookWriter).
2. Nella console Cloudflare crea un **tunnel remoto**, hostname, route e DNS verso `http://127.0.0.1:24106`.
3. Copia il token del connettore.
4. Apri `http://127.0.0.1:24105`, accedi e inserisci il token nel pannello **Cloudflare**. Il token viene salvato in `<data-root>/private/cloudflare-tunnel-token`, non nel client, negli argomenti shell, nel repository GitHub o in ZIP.
5. Premi «Salva e avvia il connettore dedicato». BookWriter esegue solo il suo connettore figlio con `--token-file` e inoltra esclusivamente l'API 24106.

Non esporre mai la porta admin **24105**. Se il tunnel esiste già ma il token è gestito dal tuo servizio di sistema, non inserirlo o ricrearlo in BookWriter: usa il connettore esistente e continua con pairing/API. Il token non crea da solo route/DNS o hostname. [Guida Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/).

## Pubblicazione npm per il maintainer

Per il bootstrap una tantum, dal checkout verificato e con 2FA del tuo account npm:

```bash
cd src/frontend
npm ci --no-audit --no-fund
cd ../server
npm run typecheck
npm run build
npm test
npm login
npm publish --access public
```

Non aggiungere `--ignore-scripts` al publish del maintainer: qui deve eseguire `prepack` (build + test) su questo checkout. Il primo 0.1.0 riceve la firma del registry; l'avvio bootstrap la accetta soltanto perché quella versione è proprio il pacchetto invocato. Le versioni successive, distribuite dall'action, richiedono attestazione di provenienza.

Il workflow [`publish-server-npm.yml`](../.github/workflows/publish-server-npm.yml) pubblica `bookwriter-personal-server` sui tag `server-vX.Y.Z` con OIDC e provenance, senza `NPM_TOKEN`. Prima del primo tag occorre una sola configurazione su npmjs.com:

- package: `bookwriter-personal-server`;
- owner/repository: `KeyserDSoze/BookWriter`;
- workflow filename: `publish-server-npm.yml`;
- environment: `npm-publish` (se lo si mantiene configurato);
- consentire `npm publish` e scegliere, dopo il primo test, di disabilitare i token tradizionali.

Il workflow richiede che la versione nel tag coincida con `src/server/package.json`. Per la prima pubblicazione npm non permette a questo codice di creare la relazione Trusted Publisher se il proprietario non l'ha configurata: è un prerequisito dell'account, non un segreto da aggiungere al repository. Dopo l'attivazione, ogni release è firmata/attestata dal registry e GitHub Actions.

## Limiti

- Pacchetto e supervisore sperimentali, non installer di sistema né updater di un singolo eseguibile.
- Nessuna prova con un proxy npm reale o con Cloudflare reale. Il client e il server sono testati con registry/tunnel simulati e i test reali di file/Windows.
- Se il server non è avviato dal supervisore, l'aggiornamento remoto è mostrato ma rifiutato. Il download non è eseguito dal browser.
