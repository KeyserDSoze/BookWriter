# Aggiornare dipendenze e pubblicare BookWriter (lockfile npm riproducibile)

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


## Release 0.11.83 — issue #127

- La [#126](https://github.com/KeyserDSoze/BookWriter/issues/126) consolida il ledger CSV di token osservati, prezzi manuali per tentativo e costo stimato distinto dalle fatture non disponibili. Versione generata su Node 22/npm 10 con registro ufficiale usando `npm version 0.11.83 --no-git-tag-version --ignore-scripts` e `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`.
- [Riproduzione npm read-only #43018025471](https://github.com/KeyserDSoze/BookWriter/actions/runs/43018025471), `completed/success`: **235 voci** nel lock, tree completo, URL `resolved` HTTPS e hash `integrity` invariati; soltanto la versione root cambia da 0.11.82 a 0.11.83. **Due `npm ci` puliti** e due cicli TypeScript, **779 Vitest (127 file)**, smoke e build superati. Hash del lock invariato durante entrambe le installazioni.
- Manifest npm generato SHA-256 `2d59440f1ae1b887b8e0e27d976c295f58066b79685b3cd69019c0066ae94582`; lockfile npm generato SHA-256 `a4230c9b239b949114e402ac7997934e88cc964b3b8cefa60b70d4a00326bb2a`, recuperato da **39 frammenti indicizzati** con lunghezza verificata e confrontato integralmente con il precedente. Nessun edit manuale del lockfile, nuova dipendenza o migrazione ZIP.
- Il workflow temporaneo read-only `npm-release-reproduce-127.yml` è cancellato **nello stesso commit di release**. Verificare e riportare su [#127](https://github.com/KeyserDSoze/BookWriter/issues/127) esiti CI (inclusi 2 progetti Playwright ed EPUBCheck su 4 EPUB), Pages e cleanup `completed/success` sulla **HEAD definitiva** prima di chiudere. Le tariffe e le fatture reali dei provider non sono state verificate.


## Release 0.11.84 — issue #129

- Inclusa la vista **storico costi per task AI** già sviluppata e verificata nella [#128](https://github.com/KeyserDSoze/BookWriter/issues/128). Il patch bump è stato prodotto da **Node 22/npm 10 e registry npm ufficiale** con `npm version 0.11.84 --no-git-tag-version --ignore-scripts` e `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`.
- [Runner temporaneo read-only #43025978874](https://github.com/KeyserDSoze/BookWriter/actions/runs/43025978874), **`completed/success`**: manifest e lockfile v3 root `0.11.84`, **235 voci** del dependency tree preservate, `resolved` HTTPS e `integrity` delle voci transitive invariati. Il diff npm contiene solo il bump versione root.
- **Due installazioni `npm ci` completamente pulite**, ciascuna con typecheck, **783 test Vitest (128 file)**, smoke e build superati. L'hash del lockfile generato da npm è rimasto invariato durante entrambe le installazioni.
- Manifest npm generato SHA-256 `1c8d458cb4e3627cd2db040d7bafc14b63b1f7c3d023f942180bad1d18d3d7f5` (1 chunk), lockfile npm SHA-256 `24c9c83e3652cd3718534d362ca6d243a40886b2d624bc6281b0c0a4317222d7` (**39 chunk indicizzati**), entrambi prelevati dai log del runner con lunghezze e versioni controllate contro i file base. Nessuna modifica manuale a lockfile o hash.
- Nel commit atomico di release il workflow `.github/workflows/npm-release-reproduce-129.yml` viene eliminato; rimangono solo CI, Pages e cleanup. **Prima di chiudere #129**, verificare sulla stessa HEAD definitiva Frontend CI (incl. Playwright Chromium desktop/mobile e EPUBCheck su quattro EPUB), Pages e cleanup tutti `completed/success`, annotando commit/run nell'issue.
- Nessuna nuova dipendenza, migrazione ZIP, aggiornamento delle tariffe reali o accesso a fatture del provider. Le epic #17 e #6 rimangono aperte per la contabilità avanzata.


## Release 0.11.85 — issue #131

- La [#130](https://github.com/KeyserDSoze/BookWriter/issues/130) ha completato il limite di budget stimato per sessione `runId` (autopilot e AI merge) insieme al guard globale per libro, backup ZIP validato e test desktop/mobile. La versione npm consolidata è **0.11.85**.
- [Runner npm temporaneo e read-only #43031306218](https://github.com/KeyserDSoze/BookWriter/actions/runs/43031306218), **`completed/success`**, Node 22/npm 10 con registro `https://registry.npmjs.org`: `npm version 0.11.85 --no-git-tag-version --ignore-scripts`, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`. `lockfileVersion=3`, **235 voci** del dependency tree, URL `resolved` HTTPS e hash `integrity` invariati: la sola differenza npm sono i campi di versione root da 0.11.84 a 0.11.85.
- **Due `npm ci` puliti** seguiti ognuno da TypeScript, **790 Vitest (128 file)**, smoke e build tutti superati. Lockfile invariato durante entrambe le installazioni. Manifest npm prodotto SHA-256 `d4caf88e717e3c7fe487ea9593028a83f6d40107b22e406f11d8ef5ff81df60a` (**1 frammento indicizzato**); lockfile npm prodotto SHA-256 `65c4963cce0d74b7c7f21369f10825664cd4fe35d8ea7364874d3dd799cdd820` (**39 frammenti indicizzati**), ricomposti con lunghezze controllate e confronto byte per byte della sola differenza di versione. Nessun edit manuale del lockfile.
- Il workflow `.github/workflows/npm-release-reproduce-131.yml` deve essere rimosso **nello stesso commit atomico di release**. La #131 si chiude solo dopo la verifica `completed/success` sulla stessa HEAD definitiva di **Frontend CI con Playwright desktop/mobile ed EPUBCheck 5.4.0 su quattro EPUB**, **Pages** e **cleanup**; citare nella issue run e commit conclusivi.
- Le cifre del budget restano stime manuali locali, non prove di addebito o plafond del provider; il limite per sessione non è prenotato fra dispositivi. Nessun nuovo provider/dipendenza/canone o migrazione ZIP previsti.


## CI Chromium headless sul runner GitHub-hosted — issue #134

I workflow `Frontend CI` installano **Chromium headless reale** coerente con il package-lock tramite `npx playwright install --only-shell chromium` e verificano entrambi i progetti desktop/mobile. Questo evita il passo aggiuntivo di `apt` richiesto da `--with-deps` che sul runner Ubuntu 26.04 ha fallito a causa del DNS degli archivi `archive.ubuntu.com` / `security.ubuntu.com`. Non rappresenta uno skip: se le librerie runtime del runner sono assenti, il test browser fallisce. Su macchine locali/self-hosted con dipendenze mancanti usare le istruzioni Playwright per il proprio OS e un archivio pacchetti funzionante. Il normale processo npm/lockfile e la doppia installazione pulita non cambiano. [Dettagli e prove](ci-playwright-headless-shell.md) · [#134](https://github.com/KeyserDSoze/BookWriter/issues/134).


## Release 0.11.86 — issue #133

- Gli [avvisi preventivi #132](https://github.com/KeyserDSoze/BookWriter/issues/132) per il budget stimato, separati fra libro e ultima sessione, e il [workaround Chromium headless #134](https://github.com/KeyserDSoze/BookWriter/issues/134) sono stati completati su `main` prima del bump. La release numerica li consolida in **0.11.86** senza cambiare la logica del preflight, le tariffe o lo schema backup.
- [Runner temporaneo read-only npm #43039532403](https://github.com/KeyserDSoze/BookWriter/actions/runs/43039532403), **`completed/success`**, Node 22/npm 10, registry `https://registry.npmjs.org`: `npm version 0.11.86 --no-git-tag-version --ignore-scripts`, poi `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`. Verificati manifest/lockfile root `0.11.86`, versione lockfile 3, **235 pacchetti** e dependency tree invariato con `resolved` HTTPS e hash `integrity` preservati; il diff npm è limitato al bump dei campi di versione root.
- **Due installazioni `npm ci` pulite**, entrambe seguite da TypeScript, **795 Vitest (129 file)**, smoke e build tutti superati; SHA del lockfile invariato in entrambi i giri. File manifesto originale prodotto da npm SHA-256 `b0a0ba4cb2b4111c8cb6fcca4cc5b633cf9a7ee9271129fc803a0597b8192ed1` (**1 frammento indicizzato**), lockfile originale SHA-256 `a0605ec2b7f873d60dca7145453461aaddea074a510997ac0ce295276e1fc1da` (**39 frammenti indicizzati**). Sono stati ricostruiti dai log, controllati per lunghezza e confrontati per intero con i precedenti file 0.11.85 per assicurarsi che il solo cambio sia il numero di versione; nessuna modifica manuale.
- Il runner temporaneo `.github/workflows/npm-release-reproduce-133.yml` viene **rimosso nel commit atomico della release** assieme a manifest/lockfile/README/AGENTS/ADR/changelog e guide. La [#133](https://github.com/KeyserDSoze/BookWriter/issues/133) va chiusa soltanto dopo **Frontend CI con i test Playwright Chromium desktop/mobile reali (installazione `--only-shell`) ed EPUBCheck sui quattro EPUB**, **Pages** e **cleanup** tutti `completed/success` sulla medesima SHA definitiva.
- Nessuna nuova dipendenza, mutazione di canone o schema ZIP, addebito o credito reale del provider o prenotazione distribuita. Le epic #17 e #6 restano aperte per ulteriori controlli e verifiche su dispositivi/provider reali.

## Release 0.11.87 — issue #136

- Sono consolidati #135/#137/#138/#139: limite output Chat Completions, messaggi HTTP prudenziali, cleanup e deadline totale dei provider AI.
- [Runner npm #43060633990](https://github.com/KeyserDSoze/BookWriter/actions/runs/43060633990) `completed/success`: Node 22/npm 10, registry `https://registry.npmjs.org`, `npm version 0.11.87 --no-git-tag-version --ignore-scripts`, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Lockfile v3, **235** voci del dependency tree, transitive, `resolved` e `integrity` invariati; solo root version modificata.
- **Due `npm ci` puliti**, ciascuno con TypeScript, **818 Vitest su 131 file**, smoke e build superati. SHA-256 del manifest e lock invariati durante gli install; artifact npm e frammenti indicizzati ricostruiti, confrontati byte-per-byte: `package.json` SHA-256 `9ef5f00d0ec1d6e303e11e263712718253c62a088284309c74ab28407e3ca5c3` (Git blob `d0d18ba0b378fd41c3fc28f430bb0d15f096bd4d`); `package-lock.json` SHA-256 `9a2ce508319ca1d08a44f1a482a623856d058d6fc8a879bcc87b789197c7ee2b` (Git blob `57c0ef1d5427cbadde62040f75785788dde24681`). Mai editare manualmente il lockfile.
- Workflow temporaneo npm #136 eliminato nello stesso commit atomico di manifest, lock e documenti su `main`. Per chiudere #136 serve Frontend CI completa (Playwright Chromium desktop/mobile, EPUBCheck 5.4.0 su 4 EPUB), Pages e cleanup `completed/success` sulla SHA finale. Nessun supporto API native o saldo/fatture reali impliciti.

## Release 0.11.88 — issue #141

- Include la riconciliazione canonica protetta #140 ([ADR 0124](../ADR/0124-editorial-reconcile-checkpoint-fence.md)). La tranche funzionale è stata verificata con [CI #43066383932](https://github.com/KeyserDSoze/BookWriter/actions/runs/43066383932), Pages e cleanup sulla SHA `bd1be3c6` prima del bump.
- [Runner npm ufficiale #43068203147](https://github.com/KeyserDSoze/BookWriter/actions/runs/43068203147) `completed/success`: Node 22/npm 10, registry `https://registry.npmjs.org`, `npm version 0.11.88 --no-git-tag-version --ignore-scripts`, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Lockfile npm v3 con **235 voci**, dipendenze, `resolved` e `integrity` invariati (soltanto root version 0.11.87→0.11.88).
- **Due `npm ci` puliti**, ciascuno con typecheck, **825 Vitest in 132 file**, 9 smoke e build superati. Integrità manifest e lock controllata dopo ogni installazione. File npm originali dall'artifact GitHub e dai log indicizzati: `package.json` SHA-256 `8c30a3d964f3c733e81d1c844661966f8f19fe3a47c14d8b22c5a37bd0aa909f` (Git blob `4a038897ce2d47388bb6c08f20e87a0bc9ceb066`), `package-lock.json` SHA-256 `1c2084acd378eb5570c4b727ed7dbd609fd08e7d2476ff157ee5c82d2a9d74d0` (Git blob `fafd56c86fdb424fcd29b871db1a1f54dc007790`), verificati byte per byte. Nessun editing manuale del lockfile.
- Manifest, lockfile, changelog, README, AGENTS, ADR e guida entrano in **un solo commit** direttamente su `main`, che rimuove anche `.github/workflows/npm-release-reproduce-141.yml`. La chiusura #141 richiede Frontend CI (Playwright desktop/mobile ed EPUBCheck 5.4.0 su 4 EPUB), Pages e cleanup `completed/success` sulla HEAD finale, da verificare dopo il commit. Nessun addebito/provider reale attestato.
