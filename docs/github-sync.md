# Sincronizzazione GitHub del libro

## Stato

Disponibili il **primo commit manuale** e l'**autosync opzionale** dei checkpoint. Ogni libro ha la propria repository GitHub, con canon Markdown e snapshot JSON ripristinabile. Il lease GitHub per l'autopilot è disponibile (best effort) e la PR #14 aggiunge il confronto visuale dei conflitti. Non sono ancora disponibili l'import di repository Narrarium generiche, il vault Google/Microsoft e gli ZIP automatici remoti.

## DOI e sincronizzazione (v0.9.1)

Il libro può includere identificativi DOI e metadati bibliografici Crossref nel dossier di un capitolo. Queste informazioni vengono sincronizzate con il resto del progetto e **sono visibili in una repository GitHub pubblica**. Non contengono automaticamente prosa o segreti, ma gli stessi identificativi scelti dall'autore possono suggerire aspetti della trama. Una nuova consultazione DOI disabilita autosync, invalida capitoli congelati dipendenti e richiede una nuova review. Metadati bibliografici ≠ prove storiche, vedi ADR 0014.

## Fonti storiche e riservatezza (v0.9.0)

Il dossier storico di ciascun capitolo viene salvato con il progetto locale e incluso nei backup e nei futuri snapshot GitHub autorizzati. Gli argomenti pubblici e gli estratti ricercati non contengono automaticamente il romanzo ma possono rivelare dettagli narrativi se li inserisci come query; **non usare segreti inediti** come termini da inviare a Wikipedia. Un aggiornamento del dossier invalida il freeze del capitolo interessato e dei successivi, disabilita autosync e cancella l'outbox obsoleta; completa di nuovo la redazione prima del push. Per dettagli: `docs/historical-sources.md` e ADR 0013.

## Per iniziare (senza token nel repository del sito)

1. Su GitHub crea una **repository privata** per ciascun libro e inizializzala con un README o un commit. La Git Data API non può partire da una repository completamente senza branch.
2. Nelle impostazioni GitHub crea un **fine-grained personal access token** con `Contents: read/write`, limitato alle sole repository dei libri. Non usare il secret `PASSWORD` o un PAT con permessi globali.
3. Apri `https://ghostwriting.ws`, vai in **Archivio → GitHub — sincronizzazione del libro**, incolla il PAT e salvalo. È cifrato nel browser via Web Crypto e non incluso nella repository.
4. Seleziona un libro locale, specifica owner, repository e branch; premi **Verifica repository** e **Collega questo libro**.
5. Metti l'autopilot in pausa. Premi **Sincronizza su GitHub**. Vedrai il commit SHA e lo stato; il salvataggio contiene la prosa, la memoria narrativa e lo storico attività, ma nessuna API key o PAT.
6. Dopo la prima sincronizzazione riuscita puoi selezionare **Sincronizzazione automatica ai checkpoint**: ogni outline, scena con review, consolidamento o revisione genera una richiesta in IndexedDB, inviata a GitHub mentre la pagina resta aperta. Se una repository è pubblica serve consenso esplicito aggiuntivo.
7. Su un nuovo dispositivo salva un PAT autorizzato, inserisci owner/repository/branch e premi **Importa un libro remoto**. L'importazione non cancella nessun libro preesistente. Configura nuovamente endpoint e modelli AI prima di riprendere il runner.

## Lease di scrittura AI tra dispositivi (v0.5.0)

Se il libro è collegato a GitHub, prima di avviare l'autopilot BookWriter crea un lease nel ramo dedicato `bookwriter-lock/<bookId>`. Ogni chiamata AI richiede che la sessione abbia ancora il lock: viene rinnovato ogni 25 secondi e scade dopo 120 secondi se la pagina non può comunicare con GitHub. Un secondo browser non può avviare l'AI sullo stesso libro quando il lock è attivo.

Il lock è liberato alla fine di una sessione o quando premi Pausa; se il browser si arresta bruscamente, resta visibile in Archivio fino alla scadenza. Il recupero è **manuale**, disponibile soltanto dopo un ulteriore margine di 60 secondi e una conferma esplicita. Non usare takeover prima di verificare che l'altro dispositivo non stia ancora lavorando.

Se GitHub non risponde o il lease cambia, la chiamata AI viene interrotta quando possibile e il risultato non viene canonizzato. Questo non significa che eventuali token già consumati dall'API vengano rimborsati.

**Importante:** il lease non è ancora un blocco transazionale perfetto per le modifiche manuali, e l'orologio locale può differire fra dispositivi. Il canon Git continua a usare controllo SHA e `force:false` per impedire sovrascritture; le divergenze non sono fuse automaticamente.

## Autosync e monitoraggio

La coda per libro in IndexedDB conserva: operazione, revisione, numero tentativi, prossimo retry e motivo dell'eventuale blocco. Le chiamate sono serializzate tra tab dello stesso browser con Web Locks. I checkpoint successivi vengono accorpati senza perdere il più recente.

L'operazione GitHub salva un marker `.bookwriter/sync.json` e l'identificatore nel messaggio del commit. Se una risposta di rete si perde dopo un commit riuscito, il prossimo tentativo lo riconosce; se `HEAD` corrisponde invece a un commit estraneo, BookWriter blocca senza sovrascrivere.

La UI in Archivio mostra **in attesa**, **invio in corso**, **bloccata**, **retry** e ultimo SHA. Gli errori di rete vengono ritentati con intervalli crescenti fino a sei tentativi, mentre i conflitti non vengono ritentati automaticamente.

**Limite fondamentale:** Web Locks protegge le tab dello *stesso browser*. Il lease GitHub v0.5.0 prova a coordinare anche due dispositivi per la scrittura AI, ma non è un blocco transazionale perfetto. Il browser chiuso/sospeso non continua a inviare; la coda riprende quando si torna sul sito.

## Confronto e recupero dei conflitti (v0.6.0)

In **Archivio → Confronto e recupero delle versioni** puoi leggere il commit remoto e la baseline dell'ultimo salvataggio (quando disponibile), confrontare singole scene, capitoli, segreti, personaggi, timeline e brief, quindi scegliere esplicitamente la versione locale o GitHub. Le differenze partono sempre dalla scelta locale.

**Salva GitHub come copia separata** recupera il remoto senza modificare l'originale. **Applica scelte con doppio backup** conserva **due copie di sicurezza** in IndexedDB prima di aggiornare il libro originale. Controlla che HEAD GitHub e revisione locale non siano cambiati e **non pubblica nulla** sul server. Dopo il recupero l'autosync è disabilitato: devi rileggere e poi fare un push manuale.

Guida: `docs/conflict-recovery.md`. Decisione: `ADR/0008-conflict-review-and-recovery.md`. Esporta anche uno ZIP esterno: le due copie restano nello stesso browser.

## Proposte editoriali per scene divergenti (v0.7.0)

Dopo un confronto di versioni con la PR #14, ogni scena divergente può essere analizzata con diff parola per parola. Nel laboratorio (PR #16) scegli se scrivere una fusione manuale oppure chiedere al modello `merge` una bozza. Nessuna proposta, anche se generata correttamente, viene canonizzata o inviata su GitHub senza consenso. Per applicarla scegli esplicitamente la bozza e poi conferma il doppio backup; la scena finale resta draft e l'autosync disabilitato.

Vedi `docs/scene-merge.md` e ADR 0009. Le bozze locali sono esportabili negli ZIP di contenuti (contengono prosa e segreti in chiaro).

## Proiezione remota

```text
book.md
context.md
ghostwriters/default.md
guidelines/writing-style.md
ideas.md
story-design.md
plot.md
chapters/001-slug/chapter.md
chapters/001-slug/001-scena.md
characters/*.md
locations/*.md
factions/*.md
items/*.md
secrets/*.md
timelines/main.md
state/current.md
evaluations/total.md
.bookwriter/project.json
.bookwriter/activities.json
.bookwriter/manifest.json
.bookwriter/sync.json
```

Il JSON è necessario per recuperare senza perdita tutte le strutture del workspace, il progresso dell'autopilot, le idee e le operazioni. Il Markdown/frontmatter serve agli editor e reader Narrarium. Il file `manifest.json` identifica i path gestiti da BookWriter; nessun file esterno a quel manifest viene eliminato o modificato dal sincronizzatore.

## Sicurezza

- Il PAT viene spedito unicamente a `https://api.github.com` con header Bearer e `redirect: error`, mai come querystring o salvato nel canon.
- Il libro e i segreti narrativi sono **in chiaro nella repository GitHub**. La scelta migliore per un romanzo inedito è una repository privata.
- Un'esecuzione JavaScript malevola nello stesso origin può comunque usare i segreti presenti nel browser: la cifratura dello storage non è un'autorizzazione server-side né E2EE.
- Import/sync richiedono permessi, token valido, manifest schema 1 e SHA coerenti. Il programma rifiuta di modificare un altro libro presente nella repository.
- Il server API GitHub supporta CORS dai browser, ma possono intervenire rate limit e restrizioni sui token.
- Mai eseguire `force push`; un branch cambiato produce un **conflitto**, che blocca il sync, non cancella gli aggiornamenti locali.

## Cosa manca

- Autosync, outbox e lease AI best effort sono disponibili; la PR #14 aggiunge confronto e recupero visuale esplicito. Manca il merge semantico automatico per la prosa.
- Il lease AI tra dispositivi è conservativo; serve ancora hardening del fencing transazionale e gestione delle modifiche manuali concorrenti.
- Il recupero seleziona scene ed entità per versione e aggiorna la baseline locale; manca il diff testuale fine e la riconciliazione automatica.
- ZIP snapshot periodici su GitHub, retenzione e bootstrap incrementale.
- OAuth Google/Microsoft e vault portabile delle credenziali senza richiedere un PAT manuale a ogni browser.
- Evoluzione del canon a schema Narrarium completo con metadata di scena e tracking dei segreti verificabile.

Vedi `docs/sync.md`, `docs/security.md`, `ADR/0003-github-canon-sync.md`, `ADR/0005-github-manual-sync.md`.

## v0.11.42 — controllo conservativo dello scarto dell'orologio (ADR 0075)

Il lease `bookwriter-lock/<bookId>` continua a usare il TTL di **120 secondi**, il rinnovo ogni **25 secondi**, il grace period di **60 secondi** e i commit `force:false`. La data e l'ora locali continuano a determinare la scadenza nel payload della versione 1: **GitHub Pages non dispone di un orologio server attendibile esposto al browser con precisione al secondo**. In particolare, l'header HTTP `Date` di GitHub non è CORS-safelisted e GitHub non lo elenca fra gli header esposti dalla sua REST API. **Non** va usato come requisito o come sorgente di sincronizzazione in una SPA.

La v0.11.42 introduce quindi un **controllo fail-closed di scarto macroscopico** prima di utilizzare una risposta GitHub valida per acquisizione, verifica, rinnovo, rilascio e recupero di un lease. GitHub espone via CORS l'header `X-RateLimit-Reset` (epoch seconds); per il rate limit primario la scadenza cade nella finestra di circa **un'ora**. BookWriter verifica che `Date.now()` cada entro **[reset−60 minuti−5 minuti, reset+5 minuti]**. Se l'header manca, è malformato oppure l'orologio è fuori da questa finestra, **rifiuta la decisione**: nessuna nuova chiamata AI, takeover o commit di lease. Errori API diversi continuano a riportare il loro codice HTTP. Anche i **404** di branch assente devono superare il controllo temporale dell'header esposto prima di essere considerati assenza verificata; prima di creare una nuova branch è inoltre richiesta una risposta valida dell'HEAD canonico.

**Limite:** la finestra è volutamente larga, e **non rileva scarti moderati**. Il valore rate-limit non è una prova del tempo esatto del server né un fencing transazionale. Il recupero di un lease scaduto rimane sempre manuale, riverificato e senza force push. Non rivendicare l'eliminazione del clock skew o il coordinamento degli editor manuali: rimangono nell'[issue #10](https://github.com/KeyserDSoze/BookWriter/issues/10). L'utente dovrebbe mantenere data/ora automatiche sul dispositivo. Nessun token viene inviato ad altri host, nessun nuovo endpoint, consenso o chiamata di rete per la misura temporale. [ADR 0075](../ADR/0075-github-lease-coarse-clock-skew-guard.md), [issue #78](https://github.com/KeyserDSoze/BookWriter/issues/78).

## v0.11.43 — 404 verificato e stato di lease non obsoleto (issue #79)

In Archivio, «Nessun lock remoto attivo» significa ora che **GitHub ha effettivamente risposto** `404` con un header `X-RateLimit-Reset` CORS-esposto e un orologio locale plausibile. Se il `404` non contiene un header leggibile, lo contiene malformato oppure il dispositivo è manifestamente fuori orario, BookWriter **non presume che il libro sia libero**: mostra l'errore, senza pulsanti di recupero basati su una precedente lettura. Durante il controllo compare uno stato di verifica; le risposte arrivate in ritardo non sovrascrivono un controllo più recente. Nessun GET extra.

La creazione di un lease da zero conserva il secondo controllo sull'HEAD di `main`, le verifiche di ownership e `force:false`. Il messaggio non identifica un guasto specifico (rete, CORS, header o clock) senza prove: attendere una verifica affidabile prima di avviare l'autopilot. Questa è una salvaguardia visiva e di controllo, non un orologio server certo né la soluzione dei conflitti manuali distribuiti. [Issue #79](https://github.com/KeyserDSoze/BookWriter/issues/79), [ADR 0075](../ADR/0075-github-lease-coarse-clock-skew-guard.md).

## v0.11.44 — conferma esatta del rinnovo del lease (ADR 0076)

Il lease viene rinnovato con un commit discendente e un `PATCH force:false`. Se GitHub rifiuta il PATCH con un conflitto (409/422) oppure la richiesta non arriva, la **vecchia scadenza ancora valida non dimostra che il rinnovo sia stato accettato**: BookWriter rilegge il riferimento e accetta il rinnovo solo se la branch punta allo SHA **esatto** del nuovo commit, il proprietario coincide ed è ancora attivo. In mancanza di prova, la generazione si arresta quando possibile: il costo di una richiesta AI già eseguita non viene azzerato.

Se invece GitHub ha già aggiornato il riferimento e si è persa soltanto la risposta, il rinnovo viene confermato senza eseguire un nuovo PATCH. La verifica riutilizza i GET già necessari prima di proseguire, senza retry automatico né force push. Resta la finestra non atomica fra GitHub e IndexedDB; un lease non protegge le modifiche manuali di altri dispositivi. Vedi [ADR 0076](../ADR/0076-exact-github-lease-renewal-ack.md), [issue #80](https://github.com/KeyserDSoze/BookWriter/issues/80), epic [#10](https://github.com/KeyserDSoze/BookWriter/issues/10).

## v0.11.45 — ripresa dello startup consapevole dei lock tra tab

Lo stato `running` di IndexedDB non va interpretato automaticamente come un crash da una seconda tab: la scrittura locale da autopilot è protetta da `bookwriter:writer:<bookId>`, e il recovery ora usa lo stesso Web Lock, con richiesta non bloccante. Se un writer lo detiene, i suoi checkpoint e le attività rimangono intatti; quando il writer è realmente terminato, un successivo startup può riportarli in pausa. Il recovery ricontrolla i record sotto una transazione locale e non modifica GitHub, la branch del lease, l'outbox o lo SHA del canon. Non è una risoluzione di conflitti fra dispositivi; restano in [#10](https://github.com/KeyserDSoze/BookWriter/issues/10). [ADR 0077](../ADR/0077-lock-aware-recover-interrupted-runs.md), [issue #81](https://github.com/KeyserDSoze/BookWriter/issues/81).

## v0.11.46 — controllo della revisione per gli override manuali di modello

La configurazione `modelRoutes[task]` specifica per libro non viene più salvata da uno snapshot React arbitrariamente vecchio. Il cambio tenta il Web Lock esclusivo del libro, poi rilegge il record e usa `expectedUpdatedAt` nella stessa transazione IndexedDB che aggiorna il libro e l'eventuale outbox: un conflitto locale causa un errore senza nuovi checkpoint remoti o perdita di dati. L'autore deve ricaricare/riprovare sulla revisione corrente; la UI ricarica dopo l'errore. Questa misura **non modifica i lease GitHub**, né protegge ogni altro edit manuale o risolve automaticamente le divergenze tra dispositivi. [ADR 0078](../ADR/0078-manual-book-model-route-local-fencing.md), [issue #82](https://github.com/KeyserDSoze/BookWriter/issues/82), epic [#10](https://github.com/KeyserDSoze/BookWriter/issues/10).

## v0.11.47 — blocco locale dei feedback manuali obsoleti

L'autore non può avviare una revisione usando uno snapshot vecchio della Dashboard per sovrascrivere altri checkpoint del libro. La modifica manuale prende il Web Lock del writer e salva con il controllo `expectedUpdatedAt` nella transazione `books+outbox`; sul conflitto conserva il libro, l'outbox e il testo del feedback da confermare nuovamente. La nuova fase `revision` continua a non generare da sola un commit GitHub. Il lease GitHub, l'outbox, `force:false` e gli snapshot narrativi non cambiano: è un fencing **locale del singolo percorso feedback**, non una transazione atomica cross-device. [ADR 0079](../ADR/0079-author-revision-local-fencing.md), [issue #83](https://github.com/KeyserDSoze/BookWriter/issues/83), [epic #10](https://github.com/KeyserDSoze/BookWriter/issues/10).

## v0.11.49 — collegamento e opt-in/out autosync senza snapshot obsoleti

Quando colleghi un libro a una repository GitHub o attivi/disattivi la sincronizzazione automatica, la UI usa la versione `updatedAt` che hai realmente visualizzato **prima** di eseguire gli eventuali controlli di rete. Per salvare deve ottenere, senza mettersi in coda, **due Web Locks**: `bookwriter:writer:<bookId>` e `bookwriter:github-outbox`. Questo evita di cambiare la policy mentre il writer AI conserva un checkpoint o mentre un invio GitHub è ancora in corso. Se manca Web Locks, il libro è in scrittura o un altro tab detiene uno dei lock, la modifica viene rifiutata e puoi riprovare dopo aver verificato lo stato.

Il programma rilegge il libro sotto i lock, confronta `updatedAt` **anche nella transazione IndexedDB books+outbox**, e ripete i controlli di sicurezza per l'attivazione: scene fuse da confermare, redazione capitolo attiva, capitoli non congelati e primo commit manuale mancante. Una scheda vecchia **non può** riabilitare autosync su un libro divenuto non idoneo, né modificare senza migrazione la destinazione di un libro già sincronizzato. Su errore la UI ricarica i dati attuali e mostra la causa in italiano, senza retry automatici. Disabilitare autosync lascia intatte le richieste già accodate; un push iniziato non può essere revocato retroattivamente.

Rimangono le conferme per repository pubbliche e i permessi GitHub; non è stata modificata la logica di lease, `force:false`, outbox o credenziali. Questa protezione è **locale al browser**: non dà atomicità cross-device a GitHub/IndexedDB e non copre tutti gli editor. [ADR 0081](../ADR/0081-local-github-settings-writer-outbox-cas.md), [issue #85](https://github.com/KeyserDSoze/BookWriter/issues/85), epic #10/#3/#6.

## v0.11.50 — ACK di GitHub e coda confermati insieme

Quando GitHub risponde a una sincronizzazione con un commit SHA valido, BookWriter deve salvare la nuova baseline nel browser. Prima eseguiva una lettura e una riscrittura separate del libro; una scheda concorrente poteva aggiornare testo/canon nel mezzo e l'ACK sovrascriverli con uno snapshot vecchio. Ora l'ACK legge il record corrente **dentro un'unica transazione IndexedDB `books+outbox`**, aggiorna soltanto `remote.lastSyncedCommit`, `lastSyncAt` e `lastSyncedLocalUpdatedAt` e, nello stesso commit locale, decide se cancellare o conservare la richiesta di sincronizzazione.

Se il libro ha la stessa revisione `updatedAt` del contenuto pubblicato, la coda può essere svuotata. Se l'autore o l'autopilot hanno modificato il libro mentre GitHub riceveva il commit, i nuovi contenuti vengono **conservati** e una richiesta ritentabile rimane in outbox; il dashboard non deve indicare che quel testo più recente è già su GitHub. Conflitti `blocked` non sono sbloccati automaticamente. Se un'altra scheda ha cambiato destinazione o registrato un commit più recente, la conferma locale vecchia viene rifiutata senza riscrivere la baseline.

Non c'è più una seconda chiamata `acknowledgeOutbox` da parte della UI o del worker dopo `pushGitHubBook`: così ACK e pulizia coda non restano separati da una finestra di crash locale. **La richiesta HTTP a GitHub rimane fuori da IndexedDB**; in caso di risposta persa prima dell'ACK locale, continua il recupero read-only tramite il marker `.bookwriter/sync.json` e l'`operationId`, senza un nuovo `PATCH` per una conferma già riconosciuta. Il protocollo `force:false`, il writer lease e la gestione delle credenziali non cambiano. [ADR 0082](../ADR/0082-github-ack-atomic-local-checkpoint.md), [issue #86](https://github.com/KeyserDSoze/BookWriter/issues/86), epic #10/#3/#6.

## v0.11.51 — conferma della HEAD esatta dopo il push

Dopo la creazione di un commit del romanzo su GitHub, BookWriter aggiorna il riferimento del branch con `PATCH force:false`. **Un codice HTTP 2xx non basta:** il browser controlla che il payload di risposta dichiari lo SHA appena creato e rilegge il ref GitHub per verificare che **la HEAD punti davvero a quello stesso SHA** prima di scrivere `lastSyncedCommit` o confermare la coda di sincronizzazione locale.

Se la risposta del PATCH è incoerente o incompleta, il branch è rimasto indietro, un'altra scrittura ha spostato la HEAD o la rilettura non riesce, l'app **non segnala falsamente un push riuscito** e non elimina l'outbox. Un errore di rete resta ambiguo: un successivo tentativo automatico può riconoscere soltanto in lettura il commit tramite lo SHA e il marker `.bookwriter/sync.json`/operationId, senza inviare nuovamente la stessa modifica se la HEAD la attesta. Il push manuale richiede un nuovo intervento esplicito.

L'ACK locale dopo la verifica usa ancora l'unica transazione IndexedDB `books+outbox` della v0.11.50, per proteggere i nuovi capitoli o vincoli creati durante l'invio. I controlli sui segreti, sul consenso alle repository pubbliche e il lease AI non cambiano. La HEAD può comunque spostarsi **dopo** il readback: questa misura non fornisce una transazione distribuita GitHub/IndexedDB né risolve i conflitti fra dispositivi. [ADR 0083](../ADR/0083-github-push-exact-head-ack.md), [issue #87](https://github.com/KeyserDSoze/BookWriter/issues/87), epic #10/#3/#6.

## v0.11.52 — recupero del commit GitHub se la risposta al PATCH si perde

Se GitHub ha già applicato il `PATCH force:false` ma il browser non riceve la risposta (oppure GitHub restituisce un 5xx dopo aver aggiornato il branch), BookWriter può recuperare **durante la stessa richiesta di sincronizzazione**, anche se è un push manuale. Non ritenta il PATCH: rilegge la HEAD esatta, verifica il messaggio del commit Git e il marker `.bookwriter/sync.json` allo SHA pubblicato. Devono coincidere `operationId`, `bookId` e `sourceRevision`. Soltanto allora registra l'ACK e lo stato della coda nella **medesima transazione IndexedDB** della v0.11.50.

Se la HEAD è rimasta indietro o è diversa, il marker non coincide o il controllo non è raggiungibile, il push viene **lasciato incerto e non dichiarato riuscito**. Il libro e l'outbox non vengono falsamente aggiornati e non viene fatto un secondo PATCH; eventuali retry successivi conservano i controlli remoti e i conflitti. Risposte 2xx con SHA/HEAD incoerenti e rifiuti 409/422 continuano a essere bloccati come da v0.11.51.

Questa correzione riduce l'ambiguità quando la scheda è ancora aperta, ma **non** risolve un crash totale della scheda durante il push manuale: l'operationId manuale non è persistito per quel caso. GitHub e IndexedDB restano non atomici tra loro, così come il fencing fra dispositivi. [ADR 0084](../ADR/0084-lost-patch-response-read-only-recovery.md), [issue #88](https://github.com/KeyserDSoze/BookWriter/issues/88), epic #10/#3/#6.

## v0.11.53 — push manuali recuperabili dopo crash o riapertura della pagina

Il pulsante **Sincronizza su GitHub** ora registra in IndexedDB (store `meta`) un identificatore permanente per il tentativo manuale **prima di qualunque richiesta di rete**, insieme al libro, repository/branch, baseline GitHub e revisione iniziale. Il record non contiene credenziali. Il percorso prende i Web Locks del writer e dell'outbox senza aspettare operazioni già in corso; l'outbox autosync resta **separata** e non viene cancellata alla preparazione.

Se GitHub ha aggiornato il branch e la pagina si è chiusa prima di ricevere la risposta, un nuovo clic dopo reload **riusa lo stesso `operationId`**, controlla la HEAD, il messaggio `bookwriter: sync <operationId>` e il marker `.bookwriter/sync.json` al medesimo SHA e registra l'ACK **senza generare un nuovo POST o PATCH**. Il recupero resta conservativo e preserva le modifiche locali eventualmente scritte nel frattempo da un'altra scheda. In caso di successo, la conferma del commit, la decisione sulla coda e la rimozione dell'intento manuale avvengono **insieme** nella transazione `books+outbox+meta`.

Se repository, branch o baseline hanno subito una modifica non riconciliata, la UI rifiuta il retry e conserva l'identificatore: non esiste un pulsante per cancellarlo alla cieca o forzare un nuovo commit. Se la HEAD/marker non dimostrano la pubblicazione, la richiesta rimane non confermata. La soluzione **non** sincronizza gli identificatori fra dispositivi diversi e non è una transazione distribuita fra GitHub e IndexedDB. [ADR 0085](../ADR/0085-durable-manual-github-push-intent.md), [issue #89](https://github.com/KeyserDSoze/BookWriter/issues/89), epic #10/#3/#6.
