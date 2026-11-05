# Sincronizzazione GitHub del libro

## Stato

Disponibile la **prima integrazione manuale**: ogni libro locale può essere collegato a una repository GitHub distinta, letto da altri browser e sincronizzato in Markdown. Non sono ancora disponibili autosync, lease cross-device, import di repository Narrarium generiche, vault Google/Microsoft e snapshot ZIP automatici su GitHub.

## Per iniziare (senza token nel repository del sito)

1. Su GitHub crea una **repository privata** per ciascun libro e inizializzala con un README o un commit. La Git Data API non può partire da una repository completamente senza branch.
2. Nelle impostazioni GitHub crea un **fine-grained personal access token** con `Contents: read/write`, limitato alle sole repository dei libri. Non usare il secret `PASSWORD` o un PAT con permessi globali.
3. Apri `https://ghostwriting.ws`, vai in **Archivio → GitHub — sincronizzazione del libro**, incolla il PAT e salvalo. È cifrato nel browser via Web Crypto e non incluso nella repository.
4. Seleziona un libro locale, specifica owner, repository e branch; premi **Verifica repository** e **Collega questo libro**.
5. Metti l'autopilot in pausa. Premi **Sincronizza su GitHub**. Vedrai il commit SHA e lo stato; il salvataggio contiene la prosa, la memoria narrativa e lo storico attività, ma nessuna API key o PAT.
6. Su un nuovo dispositivo salva un PAT autorizzato, inserisci owner/repository/branch e premi **Importa un libro remoto**. L'importazione non cancella nessun libro preesistente. Configura nuovamente endpoint e modelli AI prima di riprendere il runner.

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

- Autosync a milestone con outbox durabile e gestione dei retry.
- Lease / single writer distribuito; evita nel frattempo di scrivere lo stesso romanzo contemporaneamente su due browser.
- Risoluzione dei conflitti base/locale/remoto e aggiornamento della baseline.
- ZIP snapshot periodici su GitHub, retenzione e bootstrap incrementale.
- OAuth Google/Microsoft e vault portabile delle credenziali senza richiedere un PAT manuale a ogni browser.
- Evoluzione del canon a schema Narrarium completo con metadata di scena e tracking dei segreti verificabile.

Vedi `docs/sync.md`, `docs/security.md`, `ADR/0003-github-canon-sync.md`, `ADR/0005-github-manual-sync.md`.
