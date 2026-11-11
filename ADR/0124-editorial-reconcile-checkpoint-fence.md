# ADR 0124 — Fencing della riconciliazione del canone dopo remediation

- **Stato:** implementazione su `main` (CI finale da verificare)
- **Data:** 2026-11-11
- **Issue:** [#140](https://github.com/KeyserDSoze/BookWriter/issues/140), epic [#20](https://github.com/KeyserDSoze/BookWriter/issues/20) e [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Predecessori:** [ADR 0011](0011-independent-editorial-board-and-chapter-freeze.md), [ADR 0111](0111-saved-freeze-judgment-and-summary-gate.md)

## Problema

Dopo una remediation approvata, il runner chiede all'agente di riconciliare la memoria narrativa della scena. La pianificazione leggeva il segmento e la memoria di un preciso checkpoint, ma il callback che applicava la risposta usava la fase e il capitolo catturati prima dell'attesa. Il controllo di revisione IndexedDB protegge dalle scritture concorrenti persistite, **non** autorizza a saltare il controllo semantico della fase/cursore e del contenuto effettivamente inviato all'agente.

Una risposta tardiva non deve sovrascrivere memoria, timeline e segreti dopo una modifica alle scene, al capitolo, al segmento, al cursore o alla memoria stessa.

## Decisione

1. `captureEditorialReconcileStep(book)` rifiuta **prima del provider** checkpoint senza `phase=chapterReview`, `stage=reconcile`, cursore `reconcileCursor` intero sicuro dentro l'intervallo, capitolo esistente e non congelato o segmenti validi. Un checkpoint legacy che manca del cursore non viene assunto automaticamente come primo segmento.
2. Conservare **solo nella closure del task**, non in IndexedDB, Activity, backup o GitHub, il capitolo e il cursore attesi, ID/testo del segmento, numero segmenti, JSON completo delle scene del capitolo e JSON della memoria fornita nel prompt. È una comparazione di freschezza **esatta**, non una firma crittografica, una valutazione della verità narrativa o prova di lettura del modello.
3. `assertCurrentEditorialReconcileStep(book, snapshot)` rilegge dal **BookProject live** i dati immediatamente prima di validare e applicare l'output AI. Ogni divergenza blocca l'applicazione con errore italiano generico, privo di prosa/secret, senza modifiche parziali e senza retry/costi aggiuntivi.
4. Dopo il gate viene validato tutto il JSON della memoria; solo allora si sostituisce `book.memory` e si avanza esattamente il cursore previsto. Al termine si aggiornano le scene del **capitolo live**, mai una lista di scene catturata prima della chiamata. La successiva tornata completa a 12 agenti e il giudizio critico restano obbligatori prima del freeze.
5. Un'importazione/restore che modifica scena, status, titolo, numero o memoria rispetto alla snapshot viene bloccata; nessuna migrazione dei dati persistiti né nuova chiamata di rete.

## Verifiche e limiti

Vitest: checkpoint immutato, varianti di scena/ordine/status e memoria privata, fase/stage/capitolo/cursore mutati, cursore legacy mancante, scena congelata e segmenti multipli. Il runner conserva le protezioni di lease writer e CAS IndexedDB indipendenti dal gate. Frontend CI con Playwright desktop/mobile, EPUBCheck su quattro EPUB, Pages e cleanup devono essere verificati sulla **stessa HEAD** prima di chiudere #140.

La comparazione locale garantisce solo che la **risposta appartiene al prompt preparato**, non che la riconciliazione del modello sia vera, esaustiva o semanticamente corretta. L'uso reale di crediti resta soggetto al ledger e al budget AI.
