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
- **PR #8**: sincronizzazione GitHub manuale, PAT cifrato, proiezione Markdown Narrarium, commit multi-file, import sicuro.
- **PR #9**: autosync opt-in a checkpoint con outbox transazionale, Web Locks tra tab, retry/backoff e recovery dei commit senza risposta.
- **PR #12**: GitHub writer lease per libri collegati, acquisizione prima dell'AI, heartbeat, verifiche pre/post generazione, recupero manuale di lock scaduti. Consulta ADR 0007.
- **PR #14**: confronto visuale base/locale/GitHub e recupero di scene/entità con doppio backup IndexedDB, controllo SHA e pause autosync. Consulta ADR 0008.
- **PR #16**: diff parole/paragrafi, modello `merge` configurabile per libro, proposte AI opzionali con lease, bozze in IndexedDB v2 e nello ZIP, approvazione solo a doppio backup. Consulta ADR 0009 e `docs/scene-merge.md`.
- **PR #18**: pannello di consumi token input/output per libro, modello ed endpoint, distinguendo usage completo/parziale/mancante, senza saldo crediti inventato. ADR 0010 e `docs/ai-usage.md`.
- **PR #19**: board editoriale per capitolo (7 specialisti, 5 lettori, giudice critico, remediation, re-review e freeze). Segmenti completi con contesti separati, sinossi progressive, stop dopo tre round, riapertura capitoli e verifica dei successori. ADR 0011 e `docs/editorial-board.md`.
- **PR #27 (v0.9.2)**: citazioni storiche legate uno-a-uno alle fonti attive con `sourceEvidence`, rifiuto di citazioni cumulative ingannevoli, controllo di revisioni duplicate, UI e direttore con quote per fonte. ADR 0015; non sostituisce fonti primarie.
- **PR #25 (v0.9.1, merged)**: `domain/bibliography.ts`, adapter read-only `infrastructure/crossref.ts`, lookup consensuale con Web Locks, `BibliographyPanel`, contesti separati per storico/giudice e test su DOI/metadata ≠ evidenza. ADR 0014 e `docs/crossref-bibliography.md`. E2E storico include Crossref mockato senza crediti reali.
- **PR #24**: dossier storico del capitolo, ricerca Wikipedia IT esplicitamente approvata dall'autore, report storico con prova estratto/source IDs e giudice editoriale che verifica le fonti, ripristino conservativo del freeze e regressioni Playwright. ADR 0013, `docs/historical-sources.md`, issue #23.
- **PR #21**: protezione budget per libro (tariffe globali per endpoint/modello, stop prima dei task della redazione e fusione AI, persistenza di aiRequested prima della rete). Include tariffe full ZIP, ADR 0012, `docs/ai-budget.md` e test Vitest/Playwright desktop-mobile. Ripresa retroattiva attraverso `domain/editorial-summary.ts`, test per legacy senza snapshot e fencing contro modifiche locali concorrenti. Playwright è fissato a 1.64.1 per installazioni CI riproducibili.

- **PR #28 (v0.9.3)**: adapter read-only Library of Congress e pannello «Archivi istituzionali», consenso esplicito per 1–3 query pubbliche, record di catalogo storicizzati distinti dalle citazioni; privacy dei lettori, rewind dei capitoli e test network. ADR 0016 e `docs/institutional-archives.md`. La funzionalità non certifica fonti primarie e potrebbe incontrare blocchi CORS.

- **PR #29 (v0.9.4)**: estratti originali trascritti dall'autore da schede LoC attive, locatore e diritti dichiarati, `locex:...` citabile nella trascrizione con status non autenticato, versioni immutabili, restauro da backup, rewind e separazione dei ruoli; ADR 0017 e `docs/archival-excerpts.md`. Nessuna verifica indipendente dell'originale.

- **v0.9.7 (PR #32)**: riverifica opt-in di una fonte Wikisource contro l'esatta revisione online, confronto hash/digest/offset e quarantena con secondo consenso, Web Locks e rewind; nessuna fonte viene autenticata automaticamente (ADR 0020, `docs/wikisource-reverification.md`).
- **v0.9.6 (PR #31)**: Wikisource due fasi search + exact `revids`, sottostringa letterale da wikitext, SHA-256/offset, disattivazione delle fonti legacy v0.9.5 nelle nuove review e test fail-closed su revisioni incoerenti. ADR 0019, `docs/wikisource-transcriptions.md`.
- **v0.9.5 (PR #30)**: consultazione consensuale di estratti Wikisource con ID revisione, limiti GET/browser e privacy, ruoli storico/giudice soltanto, quote validate contro il testo recuperato, conservazione versioni/backup e diritti non automaticamente verificati (ADR 0018, `docs/wikisource-transcriptions.md`).

## Come provare GitHub

Vedi `docs/github-sync.md`. Serve una repository GitHub con un commit iniziale (può contenere README), un PAT fine-grained con permesso `Contents: read/write` limitato a quella repository e un libro locale.

In **Archivio**, salva il PAT, verifica repository e branch, collega il libro e premi **Sincronizza su GitHub** (primo commit manuale con autopilot in pausa). Successivamente puoi attivare **Sincronizzazione automatica ai checkpoint**. I progressi vengono accodati in IndexedDB e inviati mentre il tab rimane attivo. Il PAT e le API key non vengono committati.

Per aprire da altro browser, inserisci manualmente il PAT autorizzato, configura il repository in Archivio e importa il libro. L'import rifiuta gli ID locali già presenti per prevenire sovrascritture.

## Limiti e sviluppi in coda

- Login Google/Microsoft e vault credenziali multi-dispositivo non ancora attivi; nessun login fittizio.
- Autosync e lease GitHub per il runner AI sono implementati ma il fencing tra dispositivi non è transazionale perfetto. Il confronto dei conflitti è disponibile dalla PR #14, mentre diff parola-per-parola, merge automatico e ZIP remoti periodici restano da sviluppare.
- Supporto a repository Narrarium preesistenti non gestite da BookWriter da sviluppare; ora si importa uno snapshot `.bookwriter/project.json`.
- Manca l'applicazione rigorosa delle soglie di rivelazione dei segreti, ricerca fattuale verificata con fonti, copertine e impaginazione editoriale avanzata.
- Budget/tariffe modello, test Safari iOS/Chrome Android reali e integrazione con provider AI a crediti reali da completare.
- L'autopilot non continua con la scheda/browser chiusi. I checkpoint lo rendono riprendibile, non sempre in esecuzione.
- Un modulo JS sullo stesso origin può usare le API key: il Web Crypto locale non è E2EE.

Non considerare la sola cache IndexedDB un backup garantito. Scarica periodicamente lo ZIP e/o esegui una sincronizzazione GitHub dopo i checkpoint importanti.

## Riferimenti

`README.md`, `AGENTS.md`, `ADR/0005-github-manual-sync.md`, `docs/github-sync.md`, `docs/security.md`, `docs/deployment.md` e `features/F01-autopilot-sync.md`.
