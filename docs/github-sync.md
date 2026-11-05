# Sincronizzazione GitHub del libro

## Stato

Disponibili il **primo commit manuale** e l'**autosync opzionale** dei checkpoint. Ogni libro ha la propria repository GitHub, con canon Markdown e snapshot JSON ripristinabile. Non sono ancora disponibili il lease cross-device, la risoluzione visuale dei conflitti, l'import di repository Narrarium generiche, il vault Google/Microsoft e gli ZIP automatici remoti.

## Per iniziare (senza token nel repository del sito)

1. Su GitHub crea una **repository privata** per ciascun libro e inizializzala con un README o un commit. La Git Data API non può partire da una repository completamente senza branch.
2. Nelle impostazioni GitHub crea un **fine-grained personal access token** con `Contents: read/write`, limitato alle sole repository dei libri. Non usare il secret `PASSWORD` o un PAT con permessi globali.
3. Apri `https://ghostwriting.ws`, vai in **Archivio → GitHub — sincronizzazione del libro**, incolla il PAT e salvalo. È cifrato nel browser via Web Crypto e non incluso nella repository.
4. Seleziona un libro locale, specifica owner, repository e branch; premi **Verifica repository** e **Collega questo libro**.
5. Metti l'autopilot in pausa. Premi **Sincronizza su GitHub**. Vedrai il commit SHA e lo stato; il salvataggio contiene la prosa, la memoria narrativa e lo storico attività, ma nessuna API key o PAT.
6. Dopo la prima sincronizzazione riuscita puoi selezionare **Sincronizzazione automatica ai checkpoint**: ogni outline, scena con review, consolidamento o revisione genera una richiesta in IndexedDB, inviata a GitHub mentre la pagina resta aperta. Se una repository è pubblica serve consenso esplicito aggiuntivo.\n7. Su un nuovo dispositivo salva un PAT autorizzato, inserisci owner/repository/branch e premi **Importa un libro remoto**. L'importazione non cancella nessun libro preesistente. Configura nuovamente endpoint e modelli AI prima di riprendere il runner.

## Autosync e monitoraggio

La coda per libro in IndexedDB conserva: operazione, revisione, numero tentativi, prossimo retry e motivo dell'eventuale blocco. Le chiamate sono serializzate tra tab dello stesso browser con Web Locks. I checkpoint successivi vengono accorpati senza perdere il più recente.

L'operazione GitHub salva un marker `.bookwriter/sync.json` e l'identificatore nel messaggio del commit. Se una risposta di rete si perde dopo un commit riuscito, il prossimo tentativo lo riconosce; se `HEAD` corrisponde invece a un commit estraneo, BookWriter blocca senza sovrascrivere.

La UI in Archivio mostra **in attesa**, **invio in corso**, **bloccata**, **retry** e ultimo SHA. Gli errori di rete vengono ritentati con intervalli crescenti fino a sei tentativi, mentre i conflitti non vengono ritentati automaticamente.

**Limite fondamentale:** Web Locks protegge le tab dello *stesso browser*, NON due computer. Non avviare lo stesso libro in autopilot contemporaneamente da due dispositivi finché non ci sarà il lease distribuito. Il browser chiuso/sospeso non continua a inviare; la coda riprende quando si torna sul sito.

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

- Autosync e outbox sono disponibili; manca il lease distribuito e il recupero visuale dei conflitti.
- Lease / single writer distribuito; evita nel frattempo di scrivere lo stesso romanzo contemporaneamente su due browser.
- Risoluzione dei conflitti base/locale/remoto e aggiornamento della baseline.
- ZIP snapshot periodici su GitHub, retenzione e bootstrap incrementale.
- OAuth Google/Microsoft e vault portabile delle credenziali senza richiedere un PAT manuale a ogni browser.
- Evoluzione del canon a schema Narrarium completo con metadata di scena e tracking dei segreti verificabile.

Vedi `docs/sync.md`, `docs/security.md`, `ADR/0003-github-canon-sync.md`, `ADR/0005-github-manual-sync.md`.
