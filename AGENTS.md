# BookWriter — istruzioni per agenti e sviluppatori

Queste regole valgono per **tutta** la repository. Leggi README, documentazione, ADR e feature prima di modificare codice. Interfaccia, documentazione, ADR e messaggi destinati all'autore sono in **italiano**; identificatori del codice in inglese.

## Obiettivo

Una SPA React/TypeScript, responsive e local-first, che gestisce autonomamente ideazione, pianificazione, scrittura e revisione di un libro sotto supervisione dell'autore. Deploy statico su GitHub Pages. Non introdurre un backend senza motivazione e relativo ADR.

## Struttura obbligatoria

- `src/frontend/`: React + TypeScript + Vite, shadcn/ui e Tailwind, temi chiaro/scuro, accessibilità e UX mobile.
- `src/frontend/src/domain/`: tipi, schemi e regole pure per canon, job, revisione, sincronizzazione.
- `src/frontend/src/application/`: orchestrazione, routing dei modelli, state machine e use case.
- `src/frontend/src/infrastructure/`: adapter IndexedDB, API OpenAI-compatible, GitHub, Google Drive, Microsoft Graph, Web Crypto.
- `src/frontend/src/components/`, `pages/`: UI e navigazione, senza logica di dominio o token nel rendering.
- `tests/`: unit test e test e2e. `docs/`: contratti, UX, runbook. `ADR/`: decisioni irreversibili o architetturali. `features/`: requisiti e criteri di accettazione.
- `.github/workflows/`: CI e Pages; proteggere main.

## Invarianti di sicurezza

1. GitHub Pages **non è un backend**. Il bundle è pubblico; mai trasferire `PASSWORD`, PAT, chiavi AI, client secret o altre credenziali tramite variabili `VITE_*`, build, file Git o log.
2. Google/Microsoft autorizzano l'accesso alle rispettive API e file cloud, non oscurano l'app. Usare OAuth pubblico SPA con PKCE quando supportato, nessun client secret. Access token in memoria per quanto possibile.
3. PAT GitHub sempre **fine-grained**, limitato alle sole repository dei libri con Contents read/write. Credenziali separate dai documenti canonici; non sincronizzarle nella repository del libro né in snapshot di contenuti.
4. Vault cloud senza passphrase: comodità, **non E2EE**. Esplicitare il trade-off. E2EE solo con segreto indipendente dall'account cloud (es. passphrase di recupero), con gestione sicura di salt/nonce e AES-GCM Web Crypto.
5. Sanitizzare errori, redigere header, URL contenenti token e payload sensibili, evitare invio di segreti ai modelli non necessario; limitare endpoint a HTTPS e impedire redirect per chiamate con Authorization.
6. ZIP importato è dato ostile: limiti dimensione e numero file, schema validato, niente path traversal, preview, migrazione reversibile e backup prima del replace.

## Invarianti narrative

1. Lo standard canonico segue Narrarium / Book.Jesus: `chapters/NNN-slug/chapter.md` e `NNN-scene-slug.md`; un “paragrafo” è una **scena narrativa**, non un paragrafo tipografico. ID stabili.
2. Prima di scrivere: caricare `book.md`, stile/ghostwriter, pianificazione, capitoli precedenti pertinenti, stato corrente, timeline, entità, segreti e research verificata.
3. La memoria include characters, locations, factions, items, secrets, timelines, ideas long/mid/short, plot, resumes, state e evaluations. Mai considerare un riassunto LLM l'unica fonte di verità.
4. Ogni segreto ha detentori, false convinzioni del lettore, indizi consentiti e soglie `hint_from`, `partial_reveal_from`, `reveal_in`. Impedire spoiler non intenzionali.
5. Distinguere fatto verificato, canon consolidato, ipotesi e invenzione. Non spacciare per fatti ricerche non verificate. Nessuna imitazione di autori viventi.
6. Scrittura -> review stilistica, fattuale quando pertinente, continuità, pacing, dialoghi, segreti -> proposta di correzione -> revisione canonica -> refresh stato e riassunti.
7. Le indicazioni esplicite dell'autore prevalgono sui suggerimenti IA. Non riscrivere un contenuto senza registrare il motivo, lo stato precedente e gli elementi dipendenti.

## Autopilot

- State machine persistita: `idle / planning / running / pause-requested / paused / needs-author / error / completed`.
- **Ogni attività** ha ID stabile, phase, target, rationale, `nextStep`, model/endpoint, input references, timestamp, stato, summary, output references, token/costo quando comunicati. Persisti prima/dopo gli effetti.
- Pause/cancel tramite AbortController, checkpoint; nessun doppio commit dopo restart. Identificare chiaramente ciò che è stato fatto e ciò che è solo proposto.
- Su errore API/auth/network/quota/schema: fermare e mostrare causa leggibile, risposta HTTP redatta e pulsante riprova. Non occultare retry infiniti.
- Autopilot potenzialmente lungo, **ma solo finché il browser è attivo**; mobile può sospendere la scheda. Resume esatto da checkpoint, senza presumere lavoro in background.
- Intervento utente: `feedback -> impact analysis -> revision plan -> preview -> apply -> dependent review -> consolidate`; traccia revert e audit.
- Routing multi-endpoint per libro e per attività; modelli mai hardcodati. Inventario modelli via `GET /models` se possibile, più inserimento manuale.
- Permettere limiti di spesa/token personalizzabili, avviso e arresto. Eventuale assenza di tariffe precise va indicata.

## GitHub Sync — regole del codice

- Fonte: `ADR/0005-github-manual-sync.md`, `docs/github-sync.md`, issue #3. `src/frontend/src/domain/narrarium.ts` costruisce proiezioni Markdown senza credenziali; `infrastructure/github-sync.ts` implementa Git Data REST.
- Tutte le chiamate con PAT devono restare su `https://api.github.com`; mai token negli URL, log, tree, commit, ZIP narrativi o errori.
- Una repository per libro; mai `force push`. Prima scrittura conservativa (nessun book.md preesistente estraneo); update di branch solo con parent SHA originale e `force:false`.
- Eliminare solo file elencati in manifest precedente; path derivati da slug sicuri, no traversal. Se remote HEAD cambia, bloccare e conservare i dati locali.
- Snapshot `.bookwriter/project.json` e `.bookwriter/activities.json` devono essere lossless per il recupero ma NON contenere token, chiavi API, `remote.lastSyncedCommit` o chiavi di cifratura.
- Importazione remote o ZIP è additiva; mai sovrascrivere un book ID esistente in silenzio.
- Non presentare il pulsante manuale come autosync. Outbox e lease vanno implementati con un nuovo ADR prima di abilitarli.
- Test `narrarium.test.ts` e `github-sync.test.ts` devono coprire sicurezza, conflitti, path e push non-forzato.

## Persistenza e sincronizzazione

- IndexedDB è fonte operativa sul dispositivo; commit canonici GitHub su cambi significativi, ZIP snapshot versionati per bootstrap/ripristino, non per ogni singola attività.
- Non includere le credenziali nel repo del libro. Cloud bootstrap (Google appDataFolder / Microsoft OneDrive approot) distinto dai contenuti.
- Sync con expected remote SHA/base revision, verifica conflitti e controllo lease tra dispositivi. Mai last-write-wins silenzioso. Non distruggere modifiche locali non sincronizzate.
- Testare sempre import/export, rollback, interruzioni di rete, riprese e conflitti.
- GitHub repository **privata** raccomandata per libri inediti; mostrare avviso se pubblica.

## Dominio e deploy

- Il dominio pubblico canonico di Pages è `https://ghostwriting.ws`; per questa installazione Vite deve usare `base: "/"`, non `/BookWriter/`.
- La sorgente GitHub Pages è GitHub Actions. Il CNAME è informativo nel build Actions; la mappatura reale è nelle impostazioni della repository.
- Non cambiare asset base, redirect OAuth o service worker senza test su dominio personalizzato.
- Il bundle distribuito è pubblico: **non** codificare credenziali o aggiungere route che pretendano di proteggerlo con sole verifiche JavaScript.

## Writer lease v0.5.0 — invarianti

- Per un libro con `remote`, l'AI può partire solo dopo acquisizione del lease nel ramo `bookwriter-lock/<bookId>` (ADR 0007). Non avviare `callModel` se GitHub è irraggiungibile, manca il PAT o il lock è in mano a un altro writer.
- La branch di lease è separata dal canon e contiene solo ID sessione/libro e date, mai credenziali, prosa o metadati personali.
- La sequenza Git **deve** usare commit discendenti e aggiornamenti `force:false`; vietato cancellare o forzare la branch per recuperare un lock.
- Ownership GitHub verificata prima e dopo l'AI e prima di salvare i risultati; heartbeat periodico e arresto quando rete/ownership sono incerti. Un token AI già consumato non è recuperabile.
- L'altro dispositivo non può subentrare automaticamente a un lock attivo; recupero solo esplicito dopo scadenza + grace. Release best effort in `finally`.
- Le tab dello stesso browser sono coordinate anche da Web Locks. Se assenti e libro collegato, non avviare AI senza protezione.
- Non confondere il lease **AI** con il merge di modifiche manuali: conflitti su canon Git e checkout locali vanno ancora gestiti esplicitamente.
- Testare corsa fra due sessioni, perdita lock a metà risposta, rilascio, recovery e assenza di PAT nel payload.

## Autosync v0.4.0 — regole obbligatorie

- L'outbox è **durabile e transazionale** con lo stato narrativo: `saveBookAndActivity` accoda solo fasi canoniche significative; ogni libro ha un operationId stabile fino all'ACK.
- `autoSync` è opt-in e richiede il primo commit manuale. Il PAT resta fuori da canon, log e outbox.
- L'ACK remoto valida in una transazione `books + outbox` la revisione realmente inviata, non elimina checkpoint nuovi.
- Il worker usa Web Locks tra tab; se non disponibile, **non autosincronizzare**. Il tab deve restare aperto.
- Un commit che sembra riuscito ma ha perso la risposta può essere confermato solo se `HEAD` ha lo STESSO `operationId` e il marker `.bookwriter/sync.json` lo conferma. Se il branch cambia per altri motivi: conflitto, nessun force push.
- Retry limitati e backoff, blocco immediato su conflitti e autorizzazioni. Non resettare lo stato blocked a causa di nuove scene.
- **Multi-device writer NON sicuro** fino al lease distribuito: non dichiarare supporto a due sessioni autopilot simultanee. Vedi ADR 0006 e issue #3.

## Rilasci e changelog

- Ogni modifica utente pubblicata su `main` aumenta `src/frontend/package.json` con SemVer e aggiunge una nota corrispondente in `docs/CHANGELOG.md` con PR, funzionalità e limitazioni.
- Lo smoke test `tests/release.test.mjs` fallisce se una versione non compare nel changelog.
- Prima di fare merge, verificare typecheck, Vitest, smoke, build e Playwright mobile/desktop sulla **HEAD** della PR, non su un commit precedente.
- Dopo il merge verificare deploy GitHub Pages e non confondere CI verde con disponibilità del dominio; documentare errori o blocchi.

## Qualità

- TypeScript strict, schemi runtime per JSON da AI/API/import, moduli piccoli, funzioni pure testabili.
- Su ogni modifica eseguire `npm ci`, `npm run typecheck`, `npm run test`, `npm run build` e `npm run test:e2e` con Playwright desktop/mobile dove disponibili; non dichiarare test riusciti se non eseguiti.
- Aggiornare ADR, `docs/`, `features/` e README quando cambiano comportamento o sicurezza.
- UI mobile-first: breakpoint reali, sidebar a sheet, controlli touch di almeno 44 px, focus visibile, aria live sugli stati, accessibilità WCAG, riduzione movimento, tema chiaro/scuro.
- Scrivere messaggi di audit utili al lettore: "cosa ho fatto", "cosa farò", "cosa è cambiato", "come intervenire".
