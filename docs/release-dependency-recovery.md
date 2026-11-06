# Recovery deploy e installazioni Tailwind — BookWriter v0.10.7

## Sintomo

La PR #41 (proposte locali di query storiche v0.10.6) ha superato tutti i controlli, ma dopo il merge su `main` due Actions diverse hanno terminato con errore in `Install`:

- [CI main 42241828984](https://github.com/KeyserDSoze/BookWriter/actions/runs/42241828984)
- [Deploy Pages 42241828854](https://github.com/KeyserDSoze/BookWriter/actions/runs/42241828854)

Nei log: `npm error code ETARGET` e `No matching version found for @tailwindcss/oxide@4.3.5`. La versione disponibile del pacchetto `@tailwindcss/oxide` era `4.3.4`. L'app non era stata distribuita da quel workflow e la CI main era fallita, nonostante i test della PR avessero funzionato.

## Correzione

L'hotfix 0.10.7 (PR #42) fissa `@tailwindcss/vite` e `tailwindcss` **entrambi esattamente a `4.3.4`**, senza caret. Lo smoke test impedisce versioni diverse o intervalli per questa coppia. Dopo aver verificato typecheck, test, smoke, build e Chromium mobile/desktop sull'ultimo commit della PR, il merge fa ripartire automaticamente CI, Pages e cleanup; si deve **verificare l'esito completo** di ognuno.

La pulizia ora include anche branch di hotfix `fix/*`, senza eliminare branch non integrati o che abbiano ricevuto commit dopo il merge.

## Controlli operativi e limitazioni

1. In Actions controlla il commit SHA del run: deve coincidere con `main` e con la versione desiderata nel `src/frontend/package.json`.
2. Non confondere `Frontend CI` con `Deploy BookWriter Pages`. La build riuscita, isolata, non implica che Pages abbia completato il deploy.
3. Se install fallisce, consulta l'errore `npm` effettivo prima di ritentare. Non modificare dipendenze casualmente e non usare `--force` per nascondere errori.
4. La conferma del workflow Pages è la prova di distribuzione del bundle, **non** una verifica live del dominio, della cache dei client o della correttezza degli originali storici.
5. Il manifest senza lockfile lascia possibilità di drift transitive. Obiettivo successivo: produrre un lockfile affidabile, controllarlo e usare `npm ci` sui job CI e Pages. Non considerare ancora la build completamente riproducibile.

Riferimenti: [ADR 0030](../ADR/0030-tailwind-reproducible-release-guard.md), [branch cleanup](branch-maintenance.md).
