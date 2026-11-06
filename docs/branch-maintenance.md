# Pulizia dei branch dopo il merge

BookWriter usa **`main`** come unico ramo di rilascio. I branch di lavoro `feat/*`, `fix/*`, `docs/*` e `test/*` possono essere eliminati dopo che le relative PR sono state **effettivamente unite**: una PR semplicemente chiusa senza merge non è sufficiente.

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
