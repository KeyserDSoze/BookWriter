# Profilo cloud e lavoro su più PC — Google Drive, OneDrive e Git

Dalla **0.14.0** puoi lavorare da un computer all'altro ritrovando impostazioni AI, chiavi, PAT GitHub ed elenco dei libri. Decisione e vincoli: [ADR 0153](../ADR/0153-cloud-profile-sync-google-drive-onedrive.md). Come creare le app Google e Microsoft: [guida STE-100](cloud-app-registration-ste100.md).

## Cosa sta dove

| Cosa | Dove | Note |
| --- | --- | --- |
| **Testo del libro**, trama, memoria narrativa, segreti dei personaggi, log delle attività | **GitHub** (una repository per libro) | Invariato: sincronizzazione manuale/automatica, lease, conflitti. **Mai nel cloud.** |
| **Impostazioni AI**: endpoint, modelli, router, thinking, tag, tariffe | App folder del tuo account Google/Microsoft | Non il tema né il consenso all'ispezione delle richieste. |
| **Credenziali**: PAT GitHub e chiavi API | Stesso profilo, in un **vault** | Con passphrase (cifrato) o solo con il login cloud. |
| **Elenco dei libri**: titolo, stato, avanzamento, repository GitHub | Stesso account | In chiaro, anche con passphrase. |
| Copia di lavoro di tutto | **IndexedDB** di ogni browser | Fonte operativa del dispositivo. |

Il cloud è la **cartella privata dell'app** (Google Drive «appDataFolder», nascosta; OneDrive «Apps/BookWriter»): gli altri programmi e i tuoi altri file non sono toccati. Contiene due soli file: `bookwriter-profile.json` e `bookwriter-library.json`.

> **Una GitHub App non è supportata.** Una pagina web senza server non può ottenere il token di una GitHub App (GitHub ha messo in pausa il supporto SPA ad agosto 2026). Si usa un **PAT fine-grained** limitato alle repository dei libri; il vault conserva quello.

## Primo PC

1. Crea le app registration e imposta i Client ID ([guida](cloud-app-registration-ste100.md)).
2. **Impostazioni → Account cloud → Accedi con Google** (o **Microsoft**).
3. Il nome dell'account compare come «Connesso come …». L'elenco dei libri è creato subito.
4. Scegli come proteggere PAT e chiavi:
   - **Con passphrase (consigliato)**: cifrate nel browser, nemmeno Google o Microsoft le leggono. Almeno 12 caratteri. «Ricorda la passphrase su questo dispositivo» tiene solo la chiave derivata (non estraibile), così non la digiti a ogni invio. **Se la dimentichi non c'è recupero.**
   - **Solo con il login cloud**: nessuna passphrase, ma chi entra nel tuo account può leggere PAT e chiavi. Non è cifratura end-to-end.
5. **Carica impostazioni e chiavi sul cloud**.

## Nuovo PC

1. Apri il sito, **Impostazioni → Account cloud → Accedi** con lo stesso account.
2. Se il profilo è protetto da passphrase, scrivila e premi **Usa il profilo cloud su questo dispositivo**. Arrivano endpoint, modelli, router, tariffe, PAT e chiavi (il tema resta tuo).
3. **Libreria → Dagli altri tuoi dispositivi**: i libri degli altri PC con stato e repository.
4. **Scarica da GitHub**: il testo viene da GitHub con il PAT appena recuperato. Non serve digitare owner e repository.

## Tutti i giorni

- **Impostazioni modificate** (modelli, chiavi, tariffe): con «Sincronizza in automatico» acceso partono da sole, mentre la pagina è aperta e l'accesso è valido. Se il vault ha passphrase e non l'hai ricordata, compare il campo per inserirla.
- **Elenco dei libri**: si aggiorna dopo i checkpoint (stato, avanzamento, ultimo commit sincronizzato).
- **Un altro PC ha lavorato sul libro**: in **Libreria** compare «aggiornamento disponibile da un altro dispositivo» e **Aggiorna da GitHub**. Il cloud è solo un *suggerimento*: l'aggiornamento chiede sempre a GitHub.

### Aggiorna da GitHub (fast-forward)

Parte solo se **tutte** queste condizioni sono vere, altrimenti si ferma senza modificare nulla e rimanda a **Archivio → Confronto e recupero**:

- il libro locale è identico all'ultimo stato sincronizzato (nessuna modifica locale);
- nessuna sincronizzazione in coda, nessun push manuale sospeso, autopilot fermo;
- il branch GitHub discende dall'ultimo commit sincronizzato qui (storia lineare, fino a 1.000 commit).

Cosa fa: sostituisce il libro con la versione di GitHub, tiene la destinazione e le impostazioni di autosync di **questo** dispositivo, mette in pausa un libro lasciato «in esecuzione» altrove, **non cancella** nessun log locale e **non pubblica nulla**.

## Conflitti sul profilo

Il profilo ha una revisione. Se un altro PC l'ha cambiato mentre tu avevi modifiche non inviate, BookWriter **non sovrascrive** niente: mostra chi e quando e chiede di scegliere tra **usare quello del cloud** (perdi le tue modifiche) e **sostituirlo con il tuo** (conferma esplicita). L'invio automatico si ferma finché non scegli.

L'elenco libri non ha conflitti da risolvere: si fonde per libro, e un PC rimasto indietro non fa regredire un libro che un altro ha già avanzato. Se il file fosse illeggibile, **Ricrea l'elenco libri cloud** (con conferma) lo ricostruisce dai libri di questo PC; i libri su GitHub non sono toccati.

## Durata dell'accesso

| Provider | Durata | Dopo |
| --- | --- | --- |
| Google | circa 1 ora (nessun refresh token possibile senza server) | **Riconnetti** (di solito un clic, senza password) |
| Microsoft | rinnovo automatico per 24 ore | nuova finestra di accesso |

Con l'accesso scaduto la sincronizzazione cloud si ferma con un messaggio; il lavoro locale e la sincronizzazione GitHub continuano. BookWriter lavora solo a pagina aperta.

## Sicurezza in sintesi

- Token d'accesso **solo in memoria**. Solo il refresh token Microsoft (24 h) è conservato, **cifrato con la chiave del dispositivo**, e cancellato allo scollegamento.
- Scope minimi: `drive.appdata` (Google) e `Files.ReadWrite.AppFolder` (Microsoft). Nessun client secret esiste.
- Le richieste cloud vanno solo agli host dei provider, senza cookie, redirect o referrer; gli errori non riportano URL, token o risposte.
- Ogni file letto dal cloud è trattato come input ostile (schema, limiti, stesse validazioni del salvataggio impostazioni); un endpoint HTTP non locale o senza autenticazione su host remoto viene rifiutato e le impostazioni locali restano intatte.
- Lo script di Google Identity Services si carica **solo** dopo il clic su «Accedi con Google» e gira nell'origine dell'app.
- L'elenco dei libri contiene titoli e stato in chiaro (anche con passphrase): la cifratura copre solo le credenziali.

## Limiti dichiarati

- Né Drive né Graph offrono qui un controllo di concorrenza atomico: si controlla la versione, si rilegge dopo la scrittura e si usa un Web Lock tra schede. È **una difesa, non una transazione distribuita**; il caso di due PC che scrivono nello stesso istante è rilevato dalla rilettura, non escluso.
- Non verificato su account Microsoft aziendali né su provider reali (i test usano server finti). La documentazione Microsoft è contraddittoria sull'app folder per account aziendali: prova con il tuo account.
- Il cloud non è un backup del testo: per quello restano GitHub e gli ZIP.
- Scollegare un dispositivo **non** cancella i file nel cloud (servono agli altri PC); si cancellano dall'account (vedi la guida).

## Risoluzione dei problemi

| Messaggio | Cosa fare |
| --- | --- |
| «Client ID … non valido» | Controlla il valore in Impostazioni avanzate, o la variabile del repository, e ripubblica. |
| «Il browser ha bloccato la finestra di accesso» | Consenti i popup per il sito e ripremi il pulsante. |
| «Sessione cloud scaduta: riconnetti l'account» | **Riconnetti**. |
| «Passphrase errata oppure vault alterato» | Riprova. Se l'hai dimenticata, sostituisci il profilo cloud con quello di un PC che ha ancora le chiavi. |
| «Una sincronizzazione cloud è già in corso in un'altra scheda» | Attendi qualche secondo. |
| «Il profilo cloud non segue lo schema» | File alterato o di una versione più nuova: aggiorna BookWriter, o sostituisci il profilo con quello di questo PC. |
| «Serve il PAT GitHub su questo dispositivo» | Applica il profilo cloud, oppure salva un PAT in Archivio. |
| «Il branch GitHub non discende dall'ultima versione sincronizzata qui» | Usa Archivio → Confronto e recupero. |

## Per chi pubblica il sito

I Client ID sono identificativi **pubblici**: si passano al build come **variabili** del repository (`GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, facoltativa `MICROSOFT_TENANT`) lette dal workflow Pages, mai come *secret*. I fork e le prove locali possono usare i campi di Impostazioni avanzate. La pagina `public/oauth/microsoft.html` (redirect Microsoft) deve restare raggiungibile a `/oauth/microsoft.html`.
