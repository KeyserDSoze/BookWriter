# ADR 0153 — Profilo cloud su Google Drive e OneDrive, e aggiornamento Git «fast-forward»

- Stato: accettato — attua la parte «Google/Microsoft» dell'[ADR 0002](0002-cloud-identity-and-secrets.md)
- Data: 2026-11-14
- Versione: 0.14.0
- Integra ADR 0005–0008 (GitHub), 0127/0128 (endpoint e modelli). Non modifica canone, freeze, lease, outbox o budget.

## Contesto: cosa esisteva prima

L'audit del 2026-11-14 ha verificato che **nessun adapter Google Drive o OneDrive era implementato**: esistevano solo l'ADR 0002 e le sezioni «target» di `docs/sync.md`. In pratica:

- le impostazioni AI, le chiavi API e il PAT GitHub restavano solo nel browser (cifrate con la chiave del dispositivo) e su un nuovo PC andavano reinserite a mano;
- l'unico modo di ritrovare un libro era digitare owner, repository e branch in «Importa un libro remoto»;
- l'import GitHub era additivo (rifiuta un libro già presente) e **non esisteva un aggiornamento semplice** di un libro già presente quando un altro PC aveva pubblicato: restava solo il confronto manuale per singola unità.

## Vincoli delle piattaforme (verificati a novembre 2026)

- **Google.** Una SPA senza backend non può usare il flusso con codice: il client «Web application» richiede sempre il client secret anche con PKCE. L'unico percorso supportato è il **modello token di Google Identity Services**: solo finestra popup, access token di circa un'ora, **nessun refresh token**. Lo scope `drive.appdata` è non sensibile. Con pubblicazione «Testing» il consenso scade dopo 7 giorni.
- **Microsoft.** Codice di autorizzazione + PKCE da SPA è supportato se il redirect URI ha tipo `spa`; il refresh token di una SPA vale **24 ore**. `Files.ReadWrite.AppFolder` (delegato) non richiede consenso amministratore e crea `Apps/<nome dell'app registration>`. La documentazione Microsoft si contraddice sull'uso con account aziendali: va provato.
- **GitHub.** Il supporto SPA per le GitHub App è sulla roadmap pubblica (#1153) ma **«Paused» dal 2026-08-13**; gli endpoint OAuth di github.com non supportano CORS. Da una SPA resta praticabile **solo il PAT fine-grained**. Una «GitHub App» non può essere salvata né usata e non viene finta.

## Decisione

1. **Tre luoghi, un ruolo ciascuno.** IndexedDB è la copia operativa del dispositivo. **Git** conserva il libro (invariato). **L'app folder dell'account cloud** (Drive `appDataFolder` oppure OneDrive `approot`) conserva il *piano di controllo*: impostazioni AI, credenziali, elenco dei libri con stato e coordinate GitHub. Nessun testo, trama, memoria narrativa, segreto dei personaggi o log di attività entra nel cloud: duplicare il libro creerebbe una seconda fonte di verità.
2. **Due soli file**, `bookwriter-profile.json` e `bookwriter-library.json`, ≤ 1 MiB, schema `strict` con versione, rifiuto di chiavi `__proto__/constructor/prototype`, nomi ammessi da elenco fisso (mai nomi costruiti da dati). Ogni file letto dal cloud è **input ostile**: schema, limiti e le stesse validazioni del salvataggio impostazioni (`verifyEndpointSettings`) prima di scrivere in IndexedDB.
3. **Proiezione delle impostazioni.** Seguono l'autore: endpoint (senza segreto), router, thinking, tag dei modelli, tariffe. **Restano sul dispositivo** il tema, il consenso all'ispezione delle richieste AI e i cataloghi letti dal provider locale.
4. **Vault delle credenziali** (PAT GitHub + chiavi API), scelta dell'autore alla prima creazione: **passphrase** (predefinita; PBKDF2-SHA256 600.000 iterazioni, salt 16 byte, AES-GCM-256, IV nuovo a ogni cifratura, AAD di versione; il fornitore cloud vede solo testo cifrato) oppure **solo account** (leggibile da chi entra nell'account cloud: dichiarato «non E2EE»). Una passphrase errata non si trasforma mai in un re-key silenzioso. Facoltativo: ricordare sul dispositivo la **sola chiave derivata** (non estraibile) per non digitare la passphrase a ogni invio; la passphrase non è mai salvata.
5. **Accesso senza segreti.** Google: token model, access token solo in memoria, `hint` dell'account. Microsoft: PKCE S256, `state` casuale, popup aperto **in modo sincrono nel clic**, redirect a una pagina statica `/oauth/microsoft.html` (messaggio `postMessage` verso la sola origine dell'app e canale `BroadcastChannel`; l'app accetta solo un messaggio con lo `state` generato da quella scheda). Il refresh token Microsoft (24 h) è conservato **cifrato con la chiave del dispositivo** e cancellato al logout. Scope minimi: `drive.appdata` / `Files.ReadWrite.AppFolder`.
6. **Chiamate cloud.** Un solo helper: solo HTTPS e host fissi, `credentials:"omit"`, `redirect:"error"`, `referrerPolicy:"no-referrer"`, timeout 20 s, corpo limitato, body di errore mai letto, messaggi fissi senza URL/token. Il link di download pre-autenticato di OneDrive è l'unica eccezione di host e **non riceve mai** l'Authorization.
7. **Concorrenza onesta.** Né Drive v3 né Graph offrono qui una precondizione atomica portabile: si usa controllo della versione prima della scrittura, **rilettura dopo la scrittura** e Web Lock `bookwriter:cloud-sync` tra schede. Il profilo ha una `revision`: se un altro dispositivo l'ha cambiata, **non si sovrascrive mai in silenzio** (conflitto con scelta esplicita). L'elenco libri si fonde per voce (un dispositivo indietro non fa regredire un libro che un altro ha già avanzato; fino a 3 tentativi). Non è una transazione distribuita.
8. **Rilevamento delle modifiche locali senza impronte dei segreti.** `saveSettings` marca «profilo da inviare» nella *stessa* transazione IndexedDB; l'impronta usa solo il testo cifrato dei segreti (cambia quando l'autore li reinserisce), mai il testo in chiaro.
9. **Aggiornamento Git fast-forward** (`pullBookFastForward`). Solo se il libro locale è identico all'ultimo stato sincronizzato (nessuna modifica locale, nessuna outbox, nessun push manuale sospeso, autopilot fermo) **e** l'HEAD remoto discende dall'ultimo commit sincronizzato (verificato con la lista commit, non con `compare`, che restituirebbe anche tutte le patch). Sotto Web Lock writer+outbox, HEAD riconfermato, CAS `updatedAt` nella transazione. Destinazione e autosync restano quelli del dispositivo; un libro `running` altrove diventa `paused`; la revisione non torna mai indietro; non cancella log locali; non fa mai push. Ogni altro caso rimanda al «Confronto e recupero» esistente.
10. **Libreria multi-PC.** Voci «solo cloud» (scarica da GitHub, con coordinate validate da `validateRemote`), «aggiornamento disponibile» (aggiorna da GitHub), «non collegato» e «senza repository». L'elenco cloud è un **suggerimento**: GitHub viene sempre interrogato di nuovo prima di agire.
11. **Configurazione.** I Client ID sono identificativi pubblici: arrivano al build come **variabili del repository** (`vars.*`, mai `secrets.*`) in `VITE_GOOGLE_CLIENT_ID`, `VITE_MICROSOFT_CLIENT_ID`, `VITE_MICROSOFT_TENANT`, oppure si inseriscono nelle impostazioni avanzate del dispositivo (precedenza locale). Non esiste né si accetta un client secret.
12. **Service worker.** Le pagine `/oauth/*` non sono intercettate e la shell offline si salva solo da `/` (prima ogni navigazione sovrascriveva la cache di `/`).
13. **Script di terze parti.** `https://accounts.google.com/gsi/client` è caricato solo dopo il clic su «Accedi con Google» e gira nell'origine dell'app (senza SRI possibile: lo aggiorna Google). Rischio accettato e dichiarato.

## Conseguenze e limiti

- **Google richiede un clic circa ogni ora** (nessun refresh token): scaduta la sessione la sincronizzazione si ferma con un messaggio e il pulsante «Riconnetti». **Microsoft** rinnova da solo per 24 ore, poi serve una nuova finestra.
- «Solo account» non è E2EE. Con passphrase dimenticata **non esiste recupero**: si reinseriscono PAT e chiavi.
- L'elenco cloud contiene titoli e stato dei libri in chiaro, anche con passphrase: la cifratura copre solo le credenziali.
- Il cloud non sostituisce Git: non è un backup del testo. Cancellare la cartella dell'app dal proprio account elimina profilo e libreria ma non i libri.
- Il browser deve restare aperto: nessun lavoro cloud in background.
- Non verificato su account Microsoft aziendali reali né su provider Google/Microsoft reali (i test usano server finti): la prova fisica resta all'autore con [la guida](../docs/cloud-app-registration-ste100.md).
- Una GitHub App non è supportata (vincolo di GitHub, non di BookWriter).

## Verifiche

Vitest: schema ostile e privacy della proiezione, vault (passphrase errata, manomissione, IV/salt, chiave non estraibile), client Google/Microsoft con server finti (host fissi, niente cookie/redirect/referrer, token mai in errori, vettore RFC 7636, `state`/origine/sorgente dei messaggi, Authorization mai al link di download), flusso tra due «PC» con IndexedDB separati, conflitti, profilo ostile con CAS, fusione concorrente dell'elenco, controller, fast-forward e verifica di discendenza. Playwright desktop e mobile: Google a due dispositivi con download e aggiornamento da GitHub, Microsoft con popup PKCE e ripresa dopo ricarica, assenza di Client ID. Smoke: variabili pubbliche, assenza di client secret, guida allineata al codice.
