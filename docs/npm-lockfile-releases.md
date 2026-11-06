# Aggiornare dipendenze e pubblicare BookWriter (npm lockfile v0.10.8)

## Scopo

Per evitare che CI e deploy risolvano versioni npm diverse, `src/frontend/package-lock.json` viene committato e letto da **`npm ci`** nei workflow `Frontend CI` e `Deploy BookWriter Pages`. Dopo l'incidente documentato in [ADR 0030](../ADR/0030-tailwind-reproducible-release-guard.md), non si usa più `npm install` nei job di release.

## Aggiornare consapevolmente un pacchetto

1. Crea un branch nuovo da `main` e modifica le dipendenze/versione SemVer nel `src/frontend/package.json`. Tieni allineati `tailwindcss` e `@tailwindcss/vite` a versioni **esattamente uguali e pubblicate**; considera rischio di pacchetti nativi opzionali.
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
5. Committa manifest, lockfile, versioning, changelog e documentazione **insieme**. Apri la PR e attendi la CI completa sulla HEAD esatta, inclusi Playwright desktop/mobile. Dopo merge, verifica gli SHA e i risultati separati di CI `main`, Pages e cleanup. Non equiparare merge e deploy.

## Cosa significa il nuovo controllo

`npm ci` rifiuta lockfile assenti o incompatibili e usa le versioni bloccate senza tentare di aggiornarle. Lo smoke test verifica la coerenza dei pacchetti diretti, la versione root, URL HTTPS e hash `integrity` degli archivi npm pubblici. I binari optional per più architetture sono descritti nel lock, ma **non testati per tutte le piattaforme** dal solo runner Linux.

Un lockfile riduce il drift delle versioni; non certifica automaticamente l'assenza di vulnerabilità, non garantisce che ogni registry resti disponibile e non prova che il contenuto pubblicato sia raggiungibile dal DNS dell'utente. La pubblicazione corretta è attestata dal workflow Pages, con eventuali controlli del dominio da eseguire separatamente.

## Contesto incidente

La PR #41 (v0.10.6) aveva CI verde, ma il primo deploy su `main` fallì per `@tailwindcss/oxide@4.3.5` non disponibile. La PR #42 (v0.10.7) limitò il problema con versioni pinned e Pages tornò verde. La **issue #43** e ADR 0031 completano il passaggio a una singola risoluzione npm registrata.
