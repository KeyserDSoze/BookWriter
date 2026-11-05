# Sincronizzazione GitHub del libro

## Stato

Disponibili il **primo commit manuale** e l'**autosync opzionale** dei checkpoint. Ogni libro ha la propria repository GitHub, con canon Markdown e snapshot JSON ripristinabile. Il lease GitHub per l'autopilot è disponibile (best effort) e la PR #14 aggiunge il confronto visuale dei conflitti. Non sono ancora disponibili l'import di repository Narrarium generiche, il vault Google/Microsoft e gli ZIP automatici remoti.

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
