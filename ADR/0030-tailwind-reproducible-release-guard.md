# ADR 0030 — Pin delle dipendenze Tailwind dopo un deploy bloccato

- **Stato:** Accettato per hotfix v0.10.7 (PR #42)
- **Data:** 2026-11-06
- **Predecessori:** ADR 0029; policy di rilascio `AGENTS.md`

## Contesto e incidente verificato

Il commit `ad341d897766974c197ae45957d0ccdc38867a63` della v0.10.6 ha superato l'intera CI della PR #41 (`42241408229`) ed è stato integrato in `main`. Le workflow run `42241828984` (CI main) e `42241828854` (Pages) hanno poi fallito entrambe il passo `npm install --no-audit --no-fund` con `ETARGET: No matching version found for @tailwindcss/oxide@4.3.5`. Nessun test o build è partito su `main`. Il progetto non aveva un lockfile, e le dipendenze dirette `tailwindcss` e `@tailwindcss/vite` erano entrambe in intervallo `^4.1.0`.

Al momento della verifica, la versione disponibile nel registro pubblico npm per `@tailwindcss/oxide` è **4.3.4**. L'installazione su commit diversi non era risolvibile in modo identico: il merge da solo non prova che il sito sia aggiornato.

## Decisione

1. Per l'hotfix fissiamo **esattamente `4.3.4`** in `src/frontend/package.json` sia per `tailwindcss` sia per `@tailwindcss/vite`. Non aggiungiamo un override puntato a un binario inesistente, né ignoriamo il fallimento del job. Le dipendenze transitive pubblicate dalla stessa release devono risolversi coerentemente.
2. Uno smoke test legge il manifest e richiede che le due versioni coincidano e siano numeri SemVer **senza range**. È una misura limitata: non blocca tutte le altre dipendenze indirette.
3. L'hotfix usa un branch `fix/*`. Il workflow di pulizia ammette questa famiglia mantenendo le protezioni precedenti: `merged_at != null`, stesso repository, nessuna PR aperta, ref valido e immutato rispetto alla HEAD della PR unita; nessuna cancellazione di `main` o force push. Documentazione e test di regresso allineati.
4. La v0.10.7 deve superare install, typecheck, Vitest, smoke, Vite build e Playwright desktop/mobile sull'HEAD finale della PR prima del merge, **e di nuovo CI main e deploy Pages dopo il merge**. Nessuna dichiarazione di release online prima della riuscita del workflow Pages.

## Debito tecnico aperto

Una vera risoluzione riproducibile necessita di un `package-lock.json` controllato e committato, più `npm ci` al posto di `npm install` in entrambi i workflow. Non lo simuliamo con un lockfile incompleto o generato a mano: richiede una generazione valida da registro, controllo sicurezza e test. È un intervento successivo, non una capacità della v0.10.7.

La v0.10.6 ha cambiato il comportamento della ricerca storica solo localmente; questo hotfix non tocca romanzo, storico, IndexedDB, rete AI o fonti.
