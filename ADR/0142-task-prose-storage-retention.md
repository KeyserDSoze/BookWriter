# ADR 0142 — Spazio e retention delle copie canoniche locali

- Stato: accettato come sicurezza storage del prerequisito rewind, senza ripristino
- Data: 2026-11-12
- Issue: #168, parent #158; segue ADR 0141 (#167) e 0140 (#166)

## Contesto

Le coppie integrali pre/post delle scene canoniche sono consentite per libro e salvate solo in IndexedDB locale. Per un romanzo lungo, molte copie del medesimo testo possono crescere enormemente; la quota fisica IndexedDB non è controllabile dall'app. Non è ammesso troncare in silenzio lo storico o eliminare dati senza consenso. Occorre distinguere *stima applicativa* da *misura reale del browser*.

## Decisioni

1. `loadTaskProseInventory(bookId)` legge solo copie con prefisso chiave `task-prose:v1:<bookId>:` e calcola numero/byte stimati dei payload con `TextEncoder(JSON.stringify(...)).byteLength`. L'oggetto restituito contiene solo ID task e conteggi di byte, **mai prosa o altro testo**. La stima del prossimo pre/post ripete lo stato attuale su entrambi i lati; **non** è un upper bound di generazione. Overhead IndexedDB, indici, chiavi, browser quota e spazio effettivo **non** sono misurati e non si devono dichiarare come tali. La scansione è manuale, perché l'archivio può essere grande.
2. Soglia opzionale `task-prose-limit:v1:<bookId>` di 1–1024 MiB, assente per default. L'assenza significa **nessun limite applicativo**, non spazio illimitato nel browser. L'autore sceglie se configurarla; non è una retention automatica. Alla prima configurazione, `setTaskProseLimit` inizializza da tutte le copie già presenti `task-prose-usage:v1:<bookId>` con `schemaVersion:1`, `bookId`, `estimatedBytes`, `records`. Successivi commit succeeded opt-in aggiornano l'indice in O(1) atomico nella transazione di `saveBookAndActivity`; una configurazione o un ledger non valido blocca il commit. Nessuna copia retroattiva o cancellazione implicita.
3. La verifica del limite considera **interamente** il nuovo payload prima/dopo, byte JSON UTF-8, più l'uso indicizzato. Se supererebbe la soglia, lancia `TaskProseQuotaExceeded` e chiama `tx.abort()`: libro, attività, checkpoint strutturale, copia testuale, outbox e ledger **non** vengono confermati. È vietata la canonizzazione parziale, il taglio del testo o l'eviction automatica. Il browser può rifiutare per quota fisica anche sotto il limite, e la transazione IDB abortisce.
4. Solo un'azione esplicita seleziona 1–20 ID distinti per volta e richiede una **seconda conferma**. `deleteSelectedTaskProse` opera in una singola transazione `books+meta` sul solo prefisso del libro, rimuove le snapshot indicate, aggiorna il ledger se presente e scrive `task-prose-removed:v1:<bookId>:<activityId>` con data/motivo **senza testo**. L'assenza di una snapshot non è spacciata per un backup o per un confronto ancora valido. Resta intatto `BookProject`, `Activity`, checkpoint strutturali e tutte le altre librerie/opere. Un errore blocca l'intera cancellazione.
5. `setTaskProseConsent(false)` rimane il purge integrale per libro #167. Quando un ledger è presente, viene azzerato **nello stesso transaction** della revoca e cancellazione; la soglia scelta non viene cancellata, se l'autore riattiva il consenso. Nessun dato, neppure le chiavi di configurazione/indici/tombstone, entra in ZIP full/content, GitHub, outbox o provider AI. La UI invalida le letture obsolete quando si cambia libro/consenso e non mostra mai testo privato.

## Limiti e verifica

- Con consent esplicito e limite non impostato, resta la quota fisica/il rischio di storage pieno. Una quota applicativa raggiunta rifiuta un task riuscito, non cancella il libro e non inventa un risultato. L'indice ha semantica interna all'app: vecchie tab di versioni precedenti o modifiche esterne a IndexedDB non sono certificate e necessitano futura rivalidazione; la stima manuale scandisce comunque i record.
- La selezione UI espone al massimo 20 task per pagina; non introduce politiche automatiche per cancellare i più vecchi. L'utente può ripetere l'operazione o revocare in blocco.
- La #158 resta aperta per copie complete del progetto, backup/undo, diff testuali approvati, controllo multi-tab/distributed lease e rivalidazione delle dipendenze editoriali.
- Test fake-indexeddb per off/on, Unicode, limite per commit/rollback, somma ledger, aggiornamento dopo cancellazione, multi-book, revoca e tombstone; test Playwright desktop/mobile su limite configurato, selezione+conferma e overflow sintetico. Frontend CI, quattro shard Playwright, EPUBCheck 4/4, Pages e cleanup **sulla stessa HEAD** prima della chiusura della #168.
