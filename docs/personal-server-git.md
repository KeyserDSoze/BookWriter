# Git sul server personale: pull, branch e unioni

> **Sperimentale, da sorgente.** Il frontend (0.33.0) ha il pannello; il server si avvia da sorgente e richiede `git` ≥ 2.32 nel `PATH` (Git for Windows su Windows). [ADR 0169](../ADR/0169-server-git-working-copy-branches-and-merge.md) · [F04](../features/F04-server-git-branches-merge.md).

## Come funziona

Per ogni libro collegato a GitHub il server tiene una **cartella di lavoro** `<dati>/git/<proprietario>__<repository>`, un vero clone. Letture e scritture passano da `git` (`fetch`, creazione degli oggetti, `push` senza forzature). Dopo ogni push la cartella mostra i file del ramo. È derivata: non modificarla a mano, le modifiche vengono scartate. Il pannello amministrativo (porta 24105) dice se il server usa `git` o ricade sull'API REST.

Il libro vero resta quello del server (testo, memoria, revisioni). I file Markdown e `.bookwriter/` sono la sua proiezione, come sempre.

## Ramo e pull

- Il ramo predefinito è `main`; si sceglie al collegamento («Ramo GitHub») e si cambia dal pannello **GitHub e branch** della Dashboard.
- **Aggiorna da GitHub (pull)** confronta la testa del ramo con l'ultima versione confermata. Se qui non c'è nulla di nuovo, avanza (fast-forward). Se entrambe le parti sono cambiate, unisce. Il server lo fa da solo anche **prima di «Avvia sul server»**, **prima di «Salva su GitHub dal server»** e **alla fine di ogni corsa**.
- Se il pull trova conflitti il libro si ferma: nulla parte, nulla viene pubblicato, finché non decidi.
- Durante una corsa il server non unisce: un salvataggio automatico che trova il ramo cambiato resta in coda bloccato fino al pull successivo.

## Branch

- **Elenca i branch** legge il repository (i rami `bookwriter-lock/*` del blocco di scrittura non compaiono).
- **Crea il branch**: da quello corrente o da un altro. «Lavora subito sul nuovo branch» passa al nuovo ramo; dal ramo corrente conserva anche le modifiche non ancora salvate (come `git checkout -b`).
- **Passa al branch** sostituisce il testo del libro con quello del ramo e perciò richiede che il libro sia salvato su GitHub. Il libro ha un solo esecutore anche con più rami: il blocco di scrittura e l'autorità sono del libro, non del ramo.

## Unire un branch in quello corrente

1. Scegli il branch e premi **Unisci**.
2. Il server cerca l'antenato comune e confronta le tre versioni per unità: campi del progetto, capitoli, scene, schede e memoria, stato e timeline.
   - Cambiato da un solo lato: si prende da solo.
   - Stessa scena modificata da entrambi in **righe diverse e non adiacenti**: unita per righe, senza AI.
   - Il resto è un **conflitto**.
3. Senza conflitti il server pubblica un commit di merge con due genitori. Con conflitti compare **Unione in corso**: per ciascuno vedi le due versioni e scegli «Tieni» o «Prendi». **Concludi e pubblica** è disponibile quando tutti hanno una decisione. **Annulla l'unione** lascia il libro com'era.
4. I capitoli toccati vengono riaperti: perdono il congelamento e vanno rivisti dall'autopilot nel modo normale.

Mentre un'unione attende: l'avvio normale è rifiutato, il salvataggio su GitHub è bloccato, il libro non può cambiare. Se i rami si muovono prima della conclusione, l'unione va annullata e ripetuta.

### Unione con l'autopilot

Scegli «L'autopilot propone le scene modificate in entrambi» e dai il **consenso a inviare al modello le scene in conflitto e il canone, segreti compresi**: vale solo per quell'unione. L'autopilot propone una scena unita per ogni conflitto di scena, con la versione di partenza comune nel prompt; le scene sono dati non attendibili, non istruzioni. La proposta diventa **bozza** in un capitolo riaperto: non è canone finché la revisione editoriale normale (lettori, specialisti, direttore) non la approva. Gli altri conflitti (campi, schede, memoria, scene presenti in un solo ramo) restano a te e l'autopilot si ferma spiegandolo. Quando tutto è deciso il server pubblica l'unione e lascia il libro in pausa: riprendi l'autopilot per la revisione.

## Libri già su GitHub: affidarli al server e riprenderli

- **Affida «…» al server** (Impostazioni → Server personale, libro attivo con GitHub): il libro deve essere **salvato** su GitHub. Delegando il PAT di questo dispositivo, il libro diventa subito una replica di sola lettura qui; il server **legge la repository con `git`** (il testo non viene inviato), pubblica un commit con il marcatore che lo nomina autorità e da quel momento lavora lui. Se il server non conferma, riprendi l'invio o annulla: nessun secondo esecutore.
- **Riporta il libro sul dispositivo** (Dashboard, libro sul server): il server porta su GitHub tutto, unisce ciò che è arrivato (con conflitti si ferma), toglie il proprio marcatore dalla repository, revoca il PAT delegato e smette di eseguirlo. Poi **Riprendi il libro su questo dispositivo** lo rende di nuovo locale e pulito rispetto alla versione rilasciata. Dettagli: [ADR 0170](../ADR/0170-github-book-adoption-and-release.md).

## Sicurezza

- Il PAT vive solo nell'ambiente del processo `git` (intestazione verso `github.com`), mai in argomenti, URL, configurazione o messaggi di errore. Repository `https://github.com/<proprietario>/<repository>.git` da nomi validati; ambiente costruito da zero, nessun prompt né credential helper, hook e symlink disattivati, redirect disattivati, `fsckObjects` attivo.
- Nessun push forzato; l'ACK conferma lo SHA esatto; un esito incerto si prova con il marker di operazione, come per il REST.
- Un repository pubblico richiede il consenso già dato al collegamento: le unioni lo rispettano.

## Limiti dichiarati

- **Esclusi di proposito:** rebase e cherry-pick (riscrivono la storia: servirebbe un push forzato), tag e pull request (nessuna funzione sul libro).
- L'autopilot propone testi per scene, campi di testo, voci di memoria, stato, timeline e liste; capitoli, struttura dei capitoli e schede narrative restano a te.
- Le schede narrative si uniscono come un'unica unità (decisione o presa insieme). Consensi, budget e instradamenti modello restano quelli del ramo che riceve l'unione.
- Il limite di 12 MiB per push e di 64 KiB per comando restano.
- Provato con repository locali e GitHub simulato, non con GitHub reale (permessi, branch protetti) né con un proxy reale. `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` e le variabili dei certificati (`SSL_CERT_FILE`/`SSL_CERT_DIR`, `GIT_SSL_CAINFO`/`GIT_SSL_CAPATH`) sono inoltrate ai soli comandi di rete di `git`; nient'altro dell'ambiente passa. Windows è provato dalla CI.
