# ADR 0141 — Snapshot testuali delle scene canoniche, opt-in per libro e revoca locale

- Stato: accettato come prerequisito **non distruttivo** del rewind
- Data: 2026-11-12
- Issue: #167, parent #158; estende ADR 0140 e ADR 0139

## Contesto

La #166 ha introdotto prova strutturale atomica prima/dopo ogni task applicato, senza testo. Per individuare dove cambia davvero la prosa servono versioni testuali autentiche acquisite nella stessa transazione del risultato; registrarle automaticamente per tutti i libri raddoppierebbe però testo privato e consumo di spazio. L'archivio principale e gli ZIP esistenti già salvano il canone **corrente**, ma non versioni pre/post per task.

## Decisione

1. **Consenso esplicito, locale, per libro:** valore booleano nello store `meta` alla chiave `task-prose-consent:v1:<bookId>`; solo `true` abilita la registrazione. Default `false` anche su libri legacy/importati. La UI Attività espone l'avviso di duplicazione e due azioni con nomi espliciti; nessun consenso dedotto da `inspectAiRequests`, config globale o permessi dei modelli.
2. **Atomicità:** `saveBookAndActivity` usa già `books+activities+outbox+meta`. Dopo CAS e prima del `tx.done`, per un task `succeeded` con libro preesistente e `activity.bookId===book.id`, leggere il consenso `meta` nella **medesima transazione** e registrare con `meta.add` uno snapshot `task-prose:v1:<bookId>:<activityId>`. Qualunque errore di quota o duplicato abbandona la transazione, senza canonizzare un task senza il checkpoint richiesto. La disattivazione serializzata di `meta` non può lasciare in piedi copie scritte simultaneamente.
3. **Formato v1:** `{schemaVersion:1,bookId,activityId,before:{revision,scenes},after:{revision,scenes}}`; ogni `scene` ha soltanto `chapterId,sceneId,text`. Conservare **il testo integrale** delle scene canoniche disponibili prima e dopo; escludere qualsiasi draft/planned, titoli, purpose, brief, memory, secret_refs, prompt, reasoning, output AI, chiavi e settings. Nessuna troncatura silenziosa. Validare versione, identità e forma alla lettura; gli ID dei capitoli non sono identità narrative certificate.
4. **Revoca con purge:** `setTaskProseConsent(bookId,false)` usa una singola `readwrite` transaction `meta+books`: memorizza `false` e cancella le chiavi del prefisso esatto `task-prose:v1:<bookId>:`; altri libri, canone, attività, checkpoint strutturali #166 e outbox restano invariati. Riattivare non ricostruisce le versioni cancellate. Copie mai incluse nello ZIP full/content, GitHub o export: lo store `meta` resta esplicitamente fuori dal backup.
5. **Vista:** `loadTaskProseCheckpoint` effettua nello stesso transaction readonly controllo di consenso e lookup, richiesto **solo da clic esplicito**. Nel registro task, un fence indipendente invalida letture obsoleti a cambio libro/focus/consenso; mostra solo **conteggi** delle scene nuove/scomparse/con testo diverso, mai il testo in chiaro. La comparazione è di pura uguaglianza fra stringhe canoniche con stesso `chapterId/sceneId`, non un diff di paragrafi né una mappa affidabile delle conseguenze narrative.

## Non-obiettivi e rischi

- Nessun restore, undo, fork, modifica del canone, sblocco freeze, retry AI, tool calling o esecuzione automatica di riscritture. Il progetto non è ripristinabile a partire da sole scene canoniche; il vero rewind #158 richiede backup/restore supervisionato con protezioni lock/CAS, consenso e controllo downstream.
- Il volume locale può crescere con la dimensione del libro e il numero di task. In questa fase **non** si adotta retention automatica che cancelli la storia senza avviso; l'autore può revocare e cancellare tutte le copie del libro. Una policy di quota, conteggio occupazione e retention configurabile è lavoro successivo.
- Lo svuotamento di IndexedDB rimuove le copie, gli ZIP non le contengono. Non chiamarle backup.

## Verifiche

Vitest pura per cattura completa, scene draft escluse, differenze per ID composto, valida shape e nessuna mutazione; fake-indexeddb per off di default, opt-in, CAS, dup, cross-book, revoca+purge e nessun dato storico nell'archivio ZIP. Playwright desktop/mobile con attivazione esplicita, commit applicativo reale sintetico, confronto su clic, disattivazione e preservazione del canone. Frontend CI (quattro shard Chromium desktop/mobile, EPUBCheck 4 EPUB), Pages e cleanup `completed/success` **sulla stessa HEAD** prima di chiudere #167.
