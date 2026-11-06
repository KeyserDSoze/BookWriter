# ADR 0031 — Lockfile npm verificato e installazioni deterministiche in CI e Pages

- **Stato:** Accettato per v0.10.8 (PR #44)
- **Data:** 2026-11-06
- **Issue:** [#43](https://github.com/KeyserDSoze/BookWriter/issues/43)
- **Predecessore:** ADR 0030 (incidente ETARGET v0.10.6, mitigato da v0.10.7)

## Contesto

La SPA veniva compilata con `npm install` su ogni job CI/Pages e non committava un lockfile. Il merge v0.10.6 aveva la CI PR verde, ma nuove risoluzioni dello stesso manifest su `main` avevano richiesto un binario npm temporaneamente/non pubblicato (`@tailwindcss/oxide@4.3.5`). I job si fermarono prima di build/deploy. Il pin congiunto di Tailwind a `4.3.4` nella v0.10.7 risolse l'incidente ma non bloccò il resto dell'albero.

## Decisione

1. Manteniamo **`src/frontend/package-lock.json` npm v3**, generato da npm 10 con Node 22 sul **registro pubblico reale** e verificato con due installazioni pulite distinte tramite `npm ci` sul runner GitHub Actions. Nessun lock scritto a mano, simulato o derivato da metadati incompleti. Il bootstrap temporaneo per generarlo esiste esclusivamente nel branch di preparazione e viene eliminato **prima** della PR definitiva.
2. Allineiamo `package.json` (inclusa versione `0.10.8`) e lockfile nello stesso ciclo di commit. Il lock registra le versioni transitive, gli URL `https://registry.npmjs.org/`, hash `integrity`, dipendenze opzionali per piattaforme supportate e informazioni di licenza fornite dai package.
3. Entrambi i workflow `.github/workflows/ci.yml` e `.github/workflows/pages.yml` sostituiscono `npm install` con `npm ci --no-audit --no-fund`. `npm ci` verifica il manifest e il lock e fallisce senza correggere automaticamente versioni in conflitto. Una verifica `git diff --exit-code -- package-lock.json` proibisce modifiche silenziose al lock.
4. Lo smoke test verifica forma e completezza del lock, versione/root, corrispondenza esatta delle dipendenze dirette, versioni esatte di Tailwind/Vite, URL HTTPS/integrità degli archivi npm e comandi di entrambi i workflow. Qualsiasi modifica alle dipendenze deve aggiornare manifest+lock insieme e superare nuovamente tutte le prove.
5. L'installazione usa solo dipendenze pubbliche. Il lockfile non contiene segreti AI/GitHub, dati dei libri né prosa; nessun nuovo provider, backend o mutamento del canone. Mantenere i controlli ordinari di sicurezza (revisione delle licenze, CVE, CI, policy PAT).

## Accettazione e verifica

- Due `npm ci` puliti su Node 22/npm 10, senza intervenire tra loro sul lockfile, e typecheck/Vitest/smoke/build verdi. Verificare la presenza nel lock degli optional Linux/macOS/Windows di pacchetti nativi, senza dedurre da ciò l'esecuzione di test su tutti i sistemi operativi.
- Eseguire la suite browser Playwright desktop/mobile sull'HEAD finale della PR. Dopo merge, controllare separatamente CI `main`, Pages e branch cleanup sullo SHA del merge.
- Aggiornare runbook e issue #43 solo con risultati effettivamente ottenuti.

## Limiti residui

Un lockfile **non** rende le build bit-per-bit riproducibili, non protegge da compromissioni del registry, non garantisce tariffe/licenze/assenza CVE e non stabilizza piattaforme native, npm, runner, fusi orari e browser esterni. Gli hash npm verificano il download rispetto all'artefatto dichiarato nel lock, non l'affidabilità dell'autore del pacchetto. La disponibilità del sito dipende anche dall'effettivo deploy e dal DNS/cache del client.
