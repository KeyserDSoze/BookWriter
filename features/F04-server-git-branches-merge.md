# F04 — Git sul server: pull, branch e unioni curate dall'autopilot

- Stato: **implementata nel sorgente** (0.33.0, completata in 0.34.0); server da sorgente. [ADR 0169](../ADR/0169-server-git-working-copy-branches-and-merge.md) · [Guida](../docs/personal-server-git.md).

## Criteri di accettazione

- [x] Il server usa il binario `git` in una cartella di lavoro per repository; senza `git` ≥ 2.32 ricade sul REST e lo segnala.
- [x] PAT e `force:false`: mai in argv/URL/config/errori; nessun push forzato; ACK, marker e autorità invariati.
- [x] Ramo di default `main`; il libro può passare a un altro ramo solo se salvato; creazione di un ramo da un altro ramo, con o senza passaggio.
- [x] Pull prima di `start`, prima del salvataggio dal server, a fine corsa e su richiesta; fast-forward o unione a tre vie.
- [x] Unione tra branch: automatica per ciò che non si sovrappone, conflitti durevoli, decisioni dell'autore, commit con due genitori.
- [x] Autopilot: propone le scene modificate in entrambi i rami, con consenso per quell'unione; il risultato è bozza in capitoli riaperti.
- [x] Nulla è pubblicato o avviato mentre un'unione attende; annullare lascia il libro com'era.
- [x] Client: pannello per pull, elenco/creazione/cambio branch, unione, decisioni sui conflitti.
- [x] Adottare dal server un libro già presente su GitHub e riportarlo al client ([ADR 0170](../ADR/0170-github-book-adoption-and-release.md)).
- [x] Eliminare un ramo già interamente unito; variabili di proxy e CA inoltrate a `git`.
- [ ] Prova con GitHub reale (permessi, branch protetti) e con un proxy reale. Windows è coperto dalla CI, non da prove manuali.
- [x] Autopilot sui conflitti di testo oltre le scene (campi, voci di memoria, stato, timeline, liste). Capitoli e schede narrative restano all'autore.
- [ ] Rebase, cherry-pick, tag, pull request: **esclusi di proposito** (riscrittura della storia / nessuna funzione sul libro).
