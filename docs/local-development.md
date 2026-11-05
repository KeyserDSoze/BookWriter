# Sviluppo locale e pubblicazione

## Requisiti

Node.js 22+, npm, browser con IndexedDB/Web Crypto e connessione Internet per i provider AI o GitHub. I manoscritti inediti devono preferibilmente risiedere in repository GitHub private.

```sh
cd src/frontend
npm install
npm run dev
npm run typecheck
npm run test
npm run smoke
npm run build
npx playwright install chromium
npm run test:e2e
```

L'app è una SPA statica Vite/React. La CI esegue controlli TypeScript, Vitest, smoke e Playwright desktop/mobile.

## Dominio e deploy

La base Vite è **`/`**, perché `https://ghostwriting.ws` è il dominio personalizzato GitHub Pages. In **Settings → Pages** impostare la sorgente GitHub Actions; ogni merge su `main` avvia il workflow `Deploy BookWriter Pages`. Non mettere PAT, API key o segreti nel workflow/build.

## Funzionalità sviluppate

- UI responsive, navigazione mobile sticky, tema chiaro/scuro.
- Libri da brief libero, endpoint OpenAI-compatible multipli e routing modelli.
- Orchestrazione autonoma nel browser: idee long/mid/short, validazione, 5 reader personas, adversarial review, outline, generazione scene, review, consolidamento.
- Checkpoint IndexedDB, log per attività, pause/resume e revisioni dall'autore.
- Archivio ZIP content-only e full; quello full può essere cifrato con passphrase AES-GCM. La copia non cancella i libri esistenti.
- Export EPUB, DOCX, PDF delle scene canoniche, senza servizi esterni.
- **PR #8**: sincronizzazione GitHub **manuale** per repository per libro, PAT fine-grained cifrato localmente, proiezione Markdown Narrarium, commit multi-file con SHA, import non distruttivo e blocco dei conflitti.

## Come provare GitHub

Vedi `docs/github-sync.md`. Serve una repository GitHub con un commit iniziale (può contenere README), un PAT fine-grained con permesso `Contents: read/write` limitato a quella repository e un libro locale.

In **Archivio**, salva il PAT, verifica repository e branch, collega il libro e premi **Sincronizza su GitHub**. La sincronizzazione non parte automaticamente: metti in pausa l'autopilot prima di effettuare il push. Il PAT e le API key non vengono committati.

Per aprire da altro browser, inserisci manualmente il PAT autorizzato, configura il repository in Archivio e importa il libro. L'import rifiuta gli ID locali già presenti per prevenire sovrascritture.

## Limiti e sviluppi in coda

- Login Google/Microsoft e vault credenziali multi-dispositivo non ancora attivi; nessun login fittizio.
- Nessuna outbox GitHub durabile, autosync, lease tra browser, conflitti con risoluzione visuale o ZIP remoti periodici.
- Supporto a repository Narrarium preesistenti non gestite da BookWriter da sviluppare; ora si importa uno snapshot `.bookwriter/project.json`.
- Manca l'applicazione rigorosa delle soglie di rivelazione dei segreti, ricerca fattuale verificata con fonti, copertine e impaginazione editoriale avanzata.
- Budget/tariffe modello, test Safari iOS/Chrome Android reali e integrazione con provider AI a crediti reali da completare.
- L'autopilot non continua con la scheda/browser chiusi. I checkpoint lo rendono riprendibile, non sempre in esecuzione.
- Un modulo JS sullo stesso origin può usare le API key: il Web Crypto locale non è E2EE.

Non considerare la sola cache IndexedDB un backup garantito. Scarica periodicamente lo ZIP e/o esegui una sincronizzazione GitHub dopo i checkpoint importanti.

## Riferimenti

`README.md`, `AGENTS.md`, `ADR/0005-github-manual-sync.md`, `docs/github-sync.md`, `docs/security.md`, `docs/deployment.md` e `features/F01-autopilot-sync.md`.
