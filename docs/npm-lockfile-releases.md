# Aggiornare dipendenze e pubblicare BookWriter (npm lockfile v0.10.8)

## Scopo

Per evitare che CI e deploy risolvano versioni npm diverse, `src/frontend/package-lock.json` viene committato e letto da **`npm ci`** nei workflow `Frontend CI` e `Deploy BookWriter Pages`. Dopo l'incidente documentato in [ADR 0030](../ADR/0030-tailwind-reproducible-release-guard.md), non si usa più `npm install` nei job di release.

## Aggiornare consapevolmente un pacchetto

1. Controlla la HEAD aggiornata di `main` e la issue di release. Per le release concordate direttamente su `main`, prepara un commit fast-forward con manifest, lockfile e changelog coerenti; se il registro npm non è raggiungibile nel tuo ambiente, usa un runner GitHub Actions temporaneo **senza permessi di scrittura** per rigenerare i file e verificane la provenienza. Modifica le dipendenze/versione SemVer nel `src/frontend/package.json`. Tieni allineati `tailwindcss` e `@tailwindcss/vite` a versioni **esattamente uguali e pubblicate**; considera rischio di pacchetti nativi opzionali.
2. Da Node 22/npm 10, con accesso al registro npm ufficiale, genera nuovamente il lockfile:
   ```sh
   cd src/frontend
   npm install --package-lock-only --ignore-scripts --no-audit --no-fund
   ```
   Non ricostruire il lockfile a mano, non cancellare `integrity` per far passare la CI, non aggiornare silenziosamente altre versioni senza esaminare il diff.
3. Controlla le modifiche di **entrambi** i file, package e lock. Verifica `resolved` su HTTPS, `integrity`, versioni dirette/transitive, dipendenze native opzionali, licenze/attribuzioni e avvisi di sicurezza usando strumenti appropriati e revisione umana. Le licenze dichiarate dai pacchetti non equivalgono a una revisione legale.
4. Esegui installazioni pulite **due volte** senza rigenerare il lock, poi la suite:
   ```sh
   npm ci --no-audit --no-fund
   npm run typecheck && npm run test && npm run smoke && npm run build
   rm -rf node_modules
   npm ci --no-audit --no-fund
   npm run typecheck && npm run test && npm run smoke && npm run build
   npm run test:e2e
   ```
   Per i test browser occorrono Chromium e le librerie Playwright previste dal progetto.
5. Committa manifest, lockfile, versioning, changelog e documentazione **insieme**, senza modificare il lockfile a mano. Per lo sviluppo diretto su `main` concordato, usa un fast-forward con verifica dell'expected HEAD e senza force; non aprire branch/PR non richiesti. Rimuovi eventuali workflow temporanei **nel commit di release**. Verifica la CI completa sulla HEAD esatta, inclusi Playwright desktop/mobile, EPUBCheck, Pages e cleanup. Non equiparare commit e deploy.

## Cosa significa il nuovo controllo

`npm ci` rifiuta lockfile assenti o incompatibili e usa le versioni bloccate senza tentare di aggiornarle. Lo smoke test verifica la coerenza dei pacchetti diretti, la versione root, URL HTTPS e hash `integrity` degli archivi npm pubblici. I binari optional per più architetture sono descritti nel lock, ma **non testati per tutte le piattaforme** dal solo runner Linux.

Un lockfile riduce il drift delle versioni; non certifica automaticamente l'assenza di vulnerabilità, non garantisce che ogni registry resti disponibile e non prova che il contenuto pubblicato sia raggiungibile dal DNS dell'utente. La pubblicazione corretta è attestata dal workflow Pages, con eventuali controlli del dominio da eseguire separatamente.

## Contesto incidente

La PR #41 (v0.10.6) aveva CI verde, ma il primo deploy su `main` fallì per `@tailwindcss/oxide@4.3.5` non disponibile. La PR #42 (v0.10.7) limitò il problema con versioni pinned e Pages tornò verde. La **issue #43** e ADR 0031 completano il passaggio a una singola risoluzione npm registrata.

## Release 0.11.81 — issue #120

- Versione rigenerata su runner GitHub Actions con Node 22/npm 10 usando `npm version 0.11.81 --no-git-tag-version --ignore-scripts` e `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
- Controllo automatico di tutte le voci del lockfile: **nessuna dipendenza transitiva aggiunta o modificata** rispetto a 0.11.80; modificata solo la versione root da 0.11.80 a 0.11.81. URL `resolved` e checksum `integrity` invariati.
- [Riproduzione npm #43002614967](https://github.com/KeyserDSoze/BookWriter/actions/runs/43002614967): due installazioni `npm ci` pulite e due cicli TypeScript, Vitest, smoke e build. I file provengono dai log del runner con frammenti, quantità e lunghezze convalidate: non sono stati costruiti manualmente.
- La CI di `main` include Playwright Chromium desktop/mobile, EPUBCheck e Pages; i risultati di release definitivi devono essere verificati sulla HEAD del commit, non solo sul runner di preparazione.
- Nessuna nuova dipendenza, backend, mutazione di libri/canone o chiavi API. Changelog 0.11.81: #118, #119, #121 e #122.


## Release 0.11.82 — issue #125

- Le patch #123 (2 MB/60 s per il corpo JSON) e #124 (deadline 60–1800 s sugli header) sono consolidate nella release 0.11.82 con comportamento fail-closed e usage sconosciuto distinto da zero.
- [Riproduzione ufficiale npm #43013350797](https://github.com/KeyserDSoze/BookWriter/actions/runs/43013350797): Node 22/npm 10, registry ufficiale, `npm version 0.11.82 --no-git-tag-version --ignore-scripts`, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`; **235** voci nel lockfile, tree e integrity immutati, versione root aggiornata; due `npm ci` puliti seguiti ciascuno da TypeScript, **772 Vitest**, smoke e build, tutti verdi.
- Il commit diretto su `main` include i **file esatti** emessi dal runner (39 frammenti indicizzati del lock con digest SHA-256 `c5f129d11e99b284dd4e718802e83b7c4a61ca7c6d06e7edeac6c62277bd3418`, manifest SHA-256 `b1c0a77b4c2fa97299fddfe8d0b30b7d5c1952235d1066edff40164999e7b31f`) e rimuove il workflow temporaneo read-only `npm-release-reproduce-125.yml` nello stesso commit. Non sono state modificate manualmente le dipendenze transitive.
- La CI definitiva sulla **HEAD pubblicata** deve superare di nuovo Playwright Chromium desktop/mobile, EPUBCheck sui quattro EPUB sintetici, Pages e pulizia branch prima di chiudere #125. Nessun test con provider AI reali è implicato.
