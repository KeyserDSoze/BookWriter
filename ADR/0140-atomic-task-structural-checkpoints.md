# ADR 0140 — Checkpoint strutturali pre/post atomici per task

- Stato: accettato come passo preliminare, **non** rewind funzionante
- Data: 2026-11-12
- Issue: #166, parent #158; extends ADR 0139 e ADR 0136

## Contesto

Il preflight #165 confronta cronologia e canone attuale, ma non dispone di una prova persistente prima/dopo ciascun task. Un vero rewind richiede snapshot complete del contenuto e protezioni di consenso/backup/undo; duplicare automaticamente la prosa e i segreti in un audit non esportabile sarebbe un rischio privacy. Prima del versionamento testuale viene introdotta una prova strutturale minima per i **nuovi** commit del motore.

## Decisione

1. La funzione pura `captureBookStructure` crea una fotografia di sola struttura: `revision` (`BookProject.updatedAt`), `phase`, `status`, ID dei capitoli e delle scene, flag `frozen`, stato `planned|draft|canon` delle scene. Sono esclusi testo, titoli, summary, purpose, dossier, memoria e segreti, `Activity.output`, prompt e reasoning. `TaskStructuralCheckpoint` contiene `schemaVersion:1`, `bookId`, `activityId`, `before` e `after`; la versione apre la strada a letture fail-closed.
2. Per ogni **nuovo** `saveBookAndActivity` riuscito, con libro già esistente e `activity.bookId===book.id`, dopo il confronto CAS la transazione IDB comprende `books`, `activities`, `outbox` e `meta`: salva libro, attività e `meta.add("task-structure:v1:"+activity.id)` atomicamente. `add`, non `put`, impedisce di riscrivere uno snapshot già acquisito: il conflitto abortisce anche canone e audit. Nessun checkpoint per errori, cancellazioni, task legacy o chiamate preparatorie `saveActivity`.
3. `compareBookStructure` calcola **solo** conteggi di capitoli e scene aggiunti/rimossi, freeze inseriti/tolti, stato scene modificato e fase cambiata; non ha testo e non prova che la prosa sia invariata. Uno scenario con 0 differenze non attesta nessun cambiamento testuale. Mai usare i dati per ripristinare canone, modificare freeze, prendere decisioni automatiche o riaprire direttamente attività.
4. `loadTaskStructuralCheckpoint` legge dal solo IndexedDB `meta` **su clic** dell'autore, con validazione shape/versione e isolamento esatto per `bookId/activityId`. La UI recinta i ticket pendenti quando si passa ad altro task, libro/consenso, o si smonta il componente. Nessuna copia nel progetto, ZIP full/content, outbox, GitHub o richieste AI.
5. Per il vero rewind parent #158 restano da fare snapshot complete e sicure, backup con consenso, differenze di prosa per capitolo/scena, rami/undo non distruttivi, protezioni distributed writer, approvazioni granulari e invalidazione editoriale dei capitoli downstream. Quest'ADR non amplia la compatibilità LM Studio (#159).

## Verifiche

Vitest pure su copie senza prosa, differenze scene/freeze, versioni non riconosciute e oggetti invalidi; fake-indexeddb sullo stesso commit atomico con CAS stantio, duplicati, errore e isolamento cross-book; backup ZIP privo di store meta. Playwright desktop/mobile con vero `saveBookAndActivity` sintetico, differenze e rifiuto di checkpoint mancanti su task legacy. Chiusura #166 solo su stessa HEAD con Frontend CI 4 shard Chromium desktop/mobile, EPUBCheck 4 EPUB, Pages e cleanup `completed/success`.
