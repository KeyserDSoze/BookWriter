# ADR 0131 — CI Playwright obbligatoria distribuita in quattro shard

- Stato: accettato
- Data: 2026-11-12
- Issue: #152; correlate #147, #148, #151
- Ambito: workflow `.github/workflows/ci.yml` esclusivamente

## Problema

La suite di BookWriter contiene almeno 63 file E2E, eseguiti su Chromium desktop e mobile. L'esecuzione seriale di tutti i file nello stesso job prolunga la conferma di rilasci, rendendo difficoltosa la diagnosi delle issue già completate lato implementazione. Non è corretto dichiarare verde Pages quando le verifiche browser della stessa HEAD sono ancora in corso.

## Decisione

1. Conservare in `frontend` tutti i gate originali **typecheck, Vitest, smoke, build** e in `epubcheck` la validazione ufficiale dei quattro EPUB realmente generati.
2. Spostare Playwright in una **matrice 4 job**: shard `1/4`, `2/4`, `3/4`, `4/4`. Ogni shard esegue `npm ci` pulito e installa Chromium shell. La configurazione mantiene entrambi i progetti desktop/mobile: Playwright distribuisce i test tra shard, l'unione di tutti gli shard copre la suite completa.
3. `fail-fast: false`, ma nessuno shard può fallire o essere saltato senza invalidare il workflow. Timeout esplicito 45 minuti per shard e report/test-results con nome artifact diverso per runner in caso di fallimento. Non introdurre `continue-on-error`, esclusioni o retry delle richieste reali.
4. Nessun cambiamento di app, IndexedDB, codice narrativo, dipendenze o lockfile. La release è pronta solo con **ogni** job della Frontend CI, Pages e cleanup `completed/success` sulla medesima commit SHA, indipendentemente dal successo di build del deploy.

## Verifiche

Verificare che GitHub Actions generi tutti e quattro i job Playwright e che ogni job venga avviato sullo stesso SHA; controllare risultati e artefatti. Il timeout segnala un errore anziché fingere una conferma. Questa ADR non certifica l'inferenza su un provider LM Studio fisico né elimina la necessità dei test di integrazione sul PC.
