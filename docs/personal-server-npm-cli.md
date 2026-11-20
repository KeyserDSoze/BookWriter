# Server personale con npm: installazione e aggiornamento verificato

> **Sperimentale.** Il pacchetto npm e il workflow sono preparati nel sorgente. La prima pubblicazione resta bloccata finché il proprietario configura su npmjs.com il Trusted Publisher per `publish-server-npm.yml`. La UI non nasconde questo limite.

## Utente

Requisiti: Node.js **22.14+**, npm recente, Git **2.32+** per le repository del libro e, su Linux, `flock` (`util-linux`). Windows usa PowerShell per il lock. macOS non avvia il server in questa tranche.

```bash
npx --yes bookwriter-personal-server setup --data-root "$HOME/BookWriter-server-data"
npx --yes bookwriter-personal-server doctor --data-root "$HOME/BookWriter-server-data"
npx --yes bookwriter-personal-server start --data-root "$HOME/BookWriter-server-data"
```

Windows PowerShell usa lo stesso comando con il percorso `$HOME\BookWriter-server-data`.

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

## Cloudflare: aggiungere, non sostituire

Nel pannello amministrativo **http://127.0.0.1:24105**, nella sezione Cloudflare:

1. instilla un `cloudflared` compatibile (minimo 2025.4.0) sul server;
2. prepara nel tuo account Cloudflare il tunnel remoto, hostname, route e DNS verso `http://127.0.0.1:24106`;
3. inserisci il token del connettore nel campo nascosto e avvia il **connettore dedicato BookWriter**.

Il token resta nel file privato `<dati>/private/cloudflare-tunnel-token`; non entra nel client, nei comandi, negli argomenti visibili, in ZIP/GitHub o nei log. Il server avvia solo `cloudflared tunnel run --no-autoupdate --token-file <file>` e arresta esclusivamente quel figlio.

Se `cloudflared` o un servizio esistente sono già attivi, BookWriter li rileva e mostra l'avviso: **non li ferma, aggiorna, disinstalla, modifica o riavvia**. Il connettore dedicato è separato; una modifica a un tunnel altrui richiede il pannello Cloudflare o un'azione dell'amministratore, mai BookWriter. Il pannello 24105 non deve essere inoltrato.

Il token non crea da solo route/DNS: [guida Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/).

## Pubblicazione npm per il maintainer

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
