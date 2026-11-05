# ADR 0005 — Prima sincronizzazione GitHub manuale con commit ottimistici

- **Stato:** Accettato (fase 1)
- **Data:** 2026-11-05
- **Issue:** [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **PR:** [#8 — Merge completato](https://github.com/KeyserDSoze/BookWriter/pull/8)

## Problema

BookWriter nasce local-first e scrive in IndexedDB. Dobbiamo salvare versioni recuperabili da un secondo browser, leggibili da Narrarium, impedendo push di token e sovrascritture silenziose.

## Decisione (fase 1)

1. Una **repository separata per libro**; un PAT GitHub fine-grained con `Contents: read/write` limitato alla repo, cifrato in IndexedDB con Web Crypto. No PAT nel Git del libro, nei log o negli ZIP di contenuti.
2. L'autore sceglie owner/repository/branch, verifica i permessi e collega il libro. Repository **private** preferite: su repository pubbliche serve un consenso esplicito nella schermata di sync.
3. Proiezione in Markdown/frontmatter compatibile con Narrarium (`book.md`, `chapters/`, `characters/`, `locations/`, `factions/`, `items/`, `secrets/`, `timelines/`, `state/`, `evaluations/`) più file di recupero integrale `.bookwriter/project.json` e `.bookwriter/activities.json`. Un manifest elenca esattamente i file gestiti.
4. Un'operazione remota genera **un solo commit multi-file** tramite Git Data API, partendo dal tree del branch: GET ref + commit, POST tree, POST commit e PATCH ref con `force:false`. Il branch non può essere sovrascritto tramite force push. Eliminazioni limitate ai file registrati nel manifest precedente.
5. Prima della prima scrittura, rifiutare repository che contengono un altro `.bookwriter/manifest.json` o un `book.md` preesistente non gestito. Se il branch è avanzato dopo l'ultimo sync salvato, **fermare** la scrittura anche se la modifica non tocca il libro: meglio un falso positivo che una perdita.
6. Importazione da GitHub soltanto quando il book ID non esiste localmente; non sovrascrive nessun libro o attività. Il runner viene ripreso manualmente.
7. L'autopilot deve essere in pausa durante il push manuale. Non attiviamo autosync/lease finché non saranno sviluppati e testati in un ADR successivo.

## Limiti intenzionali

- **Non è ancora autosync**: niente outbox persistente, lease cross-device o snapshot ZIP GitHub periodico. La UI deve descriverlo sempre.
- Le chiavi API e il PAT non migrano tra dispositivi: verranno recuperati con vault Google/Microsoft soltanto dopo il relativo OAuth e le scelte di sicurezza.
- Questa fase non importa repository Narrarium che non contengano già `.bookwriter/project.json`.
- Blocco conservativo se il branch HEAD è diverso dallo SHA dell'ultimo salvataggio; risoluzione conflitti e rebase sono sviluppi successivi.
- I commit sono leggibili in chiaro dai collaboratori della repo; se la repo è pubblica, i segreti narrativi diventano pubblici.

## Conseguenze

Otteniamo uno storico versionato dei libri, restore lossless su altro browser con credenziali inserite separatamente e protezione dai conflitti più pericolosi. Si incrementa il numero di chiamate REST rispetto a ZIP singoli, in cambio della capacità di review per-file e interoperabilità con Narrarium.

## Riferimenti

- https://docs.github.com/en/rest/git/trees
- https://docs.github.com/en/rest/git/commits
- https://docs.github.com/en/rest/git/refs
- https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests
