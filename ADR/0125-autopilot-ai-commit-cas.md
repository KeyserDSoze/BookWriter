# ADR 0125 — Commit AI dell'autopilot con CAS atomico sul libro e audit

- **Stato:** accettato, implementazione #142 verificata, incluso nella versione npm 0.11.89 (#143)
- **Data:** 2026-11-11
- **Issue:** [#142](https://github.com/KeyserDSoze/BookWriter/issues/142), epic [#6](https://github.com/KeyserDSoze/BookWriter/issues/6) e [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** [ADR 0080](0080-atomic-editorial-scene-approval-audit.md), [ADR 0124](0124-editorial-reconcile-checkpoint-fence.md)

## Problema

L'autopilot controllava la versione `updatedAt` del libro dopo aver ricevuto e validato la risposta AI. Poi chiamava `saveBookAndActivity(latest, started)` **senza** il token di revisione: una scrittura concorrente non cooperativa, avvenuta fra quel controllo e la transazione IndexedDB, poteva essere sovrascritta. L'Activity veniva marcata `succeeded` anche se il canone precedente non era più attuale. Lease Web Locks e writer remoto non rendono sicuri tutti gli import o editor non cooperativi.

Il database già possiede una precondizione opzionale `saveBookAndActivity(book, activity, expectedUpdatedAt)`, che confronta la revisione nello **stesso readwrite transaction** prima di modificare libro, Activity e outbox. Usarla era già obbligatorio nella conferma manuale della scena (ADR 0080), ma non nel risultato autopilot.

## Decisione

1. Passare all'operazione di commit AI la revisione `book.updatedAt` validata dopo la chiamata, come terzo parametro di `saveBookAndActivity`. Il confronto avviene nel database in un unico snapshot/transazione, con commit atomico per libro, audit e richiesta sync, non solo con un controllo applicativo precedente.
2. Se fallisce il CAS con `BookRevisionConflict`, l'AI **non deve** sovrascrivere neppure lo status del libro concorrente in un `catch` di recupero. Il libro, i segreti, scene, checkpoint e outbox rimangono quelli dello scrittore vincente. Il risultato AI viene **scartato** senza retry, secondo POST né nuova spesa.
3. Poiché la chiamata è **già stata effettuata e potrebbe essere fatturata**, salvare a parte l'Activity `cancelled`, `aiRequested=true`, con usage osservato se riportato, un messaggio generico italiano, senza `output`, `summary` o dati segreti. Questo audit di una richiesta tentata non è una conferma narrativa o un aggiornamento canon.
4. Gli errori diversi da un conflitto CAS continuano nel percorso già esistente. Il gate live di riconciliazione (ADR 0124) rimane indipendente e controlla la freschezza dei dati anche in presenza di timestamp invariato.
5. Test Vitest d'integrazione: un writer concorrente salva dopo il `getBook` pre-commit ma prima dell'inserimento di `saveBookAndActivity`; vengono preservati stop e segreto dell'autore, nessun rapporto redazionale viene approvato, outbox immutata, mentre usage già osservato resta nell'Activity tentata. Conservare i test della transazione CAS low-level e del percorso ordinario dei 12 revisori.

## Limiti

Il CAS `updatedAt` protegge la **scrittura locale con timestamp corretto**; non è un lease remoto, non certifica l'autenticità di un import che ricicla un timestamp né la correttezza semantica di una critica. Un conflitto che avvenga dopo la chiamata AI non restituisce crediti né autorizza nuove richieste. La release npm è separata dalla issue funzionale e il lockfile non va modificato manualmente.

Prima della chiusura, Frontend CI (typecheck, Vitest, smoke, build, Playwright desktop/mobile, EPUBCheck 5.4.0 su quattro EPUB), Pages e cleanup devono essere `completed/success` sulla **stessa HEAD di main**.

## Release npm 0.11.89

La #142 è chiusa dopo Frontend CI #43072393385 (826 Vitest, 148 Playwright desktop/mobile, EPUBCheck 4 EPUB), Pages e cleanup sulla HEAD `f4545e51`. [Runner npm #43079099716](https://github.com/KeyserDSoze/BookWriter/actions/runs/43079099716) `completed/success`: due `npm ci`, 826 Vitest in 133 file, smoke, typecheck e build per ciclo. Verificare la CI e il deploy della HEAD finale della release prima della chiusura #143.
