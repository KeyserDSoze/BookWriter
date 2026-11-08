# Pulizia dei branch dopo il merge

BookWriter usa **`main`** come unico ramo di rilascio. I branch di lavoro `feat/*`, `fix/*`, `docs/*`, `test/*` e `chore/*` possono essere eliminati dopo che le relative PR sono state **effettivamente unite**: una PR semplicemente chiusa senza merge non è sufficiente.

A partire dal rilascio v0.9.4, il workflow [Cleanup merged branches](../.github/workflows/cleanup-merged-branches.yml) viene avviato a ogni push su `main` e può essere richiamato manualmente da **Actions → Cleanup merged branches → Run workflow**. Non ha accesso ai segreti AI, ai libri locali o ai contenuti di altri repository: usa soltanto il token GitHub Actions con autorizzazioni `contents: write` e `pull-requests: read`.

## Garanzie prima dell'eliminazione

1. GitHub segnala `merged_at` non nullo per la PR (non basta lo stato `closed`).
2. La PR proviene **dallo stesso repository** e il branch appartiene a una delle famiglie `feat/`, `fix/`, `docs/`, `test/`.
3. **Nessuna PR aperta** usa ancora quel branch.
4. Il commit a cui il branch punta è **esattamente uguale** allo SHA della HEAD della PR unita; se qualcuno ha aggiunto nuovi commit, non viene eliminato.
5. `main`, nomi inattesi e branch senza PR unita non vengono mai eliminati. Ogni cancellazione viene registrata nel log del workflow.

Lo storico dei commit e la PR unita rimangono consultabili su GitHub dopo l'eliminazione del riferimento; non vengono cancellati i commit in `main` o la cronologia delle review.

## Limiti e recupero

Il workflow effettua lettura e cancellazione del riferimento con due operazioni GitHub separate: **non** è un aggiornamento atomico con lease. Per questo è destinato solamente ai branch di PR già unite e inattivi; evita di continuare a lavorare su un branch già mergiato. Se devi riprendere lo sviluppo, crea un **nuovo branch da `main`** anziché riutilizzarne uno vecchio.

In presenza di token GitHub Actions con permessi insufficienti, branch protetto o blocchi delle Actions, la pulizia può fallire senza compromettere il rilascio. Controlla il log del job e, se necessario, elimina manualmente i singoli branch dalla pagina GitHub **Branches** dopo averne verificato le PR. Non usare `git push --force` per pulire i branch.

## Pulizia straordinaria del prototipo eventi v0.11.4 (8 novembre 2026)

Dopo il merge della v0.11.28, il solo branch non-`main` rimasto era
`feat/0.11.4-attested-event-ledger` con HEAD
`55b2142c6c6674e9d309af2da7b8b8df35850207`: vecchio tentativo di
implementazione delle decisioni autore sugli eventi, **senza propria PR**.
La funzionalità è stata consegnata con un'implementazione alternativa
tramite [PR #50](https://github.com/KeyserDSoze/BookWriter/pull/50)
e poi estesa nelle successive release; NON bisogna fondere alla cieca
il codice del prototipo `0.11.4` sopra la `0.11.28`.

Il workflow di cleanup contiene un controllo **una tantum e fail-closed**
per rimuovere *soltanto* quel ref e *soltanto se* conserva lo SHA
sopraindicato, la PR #50 è realmente mergiata, il modulo canonico è
presente su `main` e nessuna PR aperta punta al vecchio branch.
Il controllo conserva la copia se c'è qualunque divergenza o errore.
Non si cancellano automaticamente altri prototipi senza PR.
Le PR integrate restano consultabili e lo storico del commit legacy
rimane identificabile dal suo SHA.
