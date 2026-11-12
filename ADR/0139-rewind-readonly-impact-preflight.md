# ADR 0139 — Preflight non distruttivo per ripartenza da task storico

- Stato: accettato come sotto-step **read-only**, non implementazione del rewind
- Data: 2026-11-12
- Issue: #165, parent #158; #150 tool calling e #157 task-first separati

## Contesto

«Riparti da qui» richiede snapshot per task e una strategia di revisione/undo con protezioni writer lock/CAS e freeze. Le `Activity` attuali non contengono una copia versionata del canone prima/dopo ogni task; i timestamp ordinano eventi, ma non descrivono da soli le dipendenze narrative. Ripristinare `phase` o rimuovere scene sulla base dello storico sarebbe un falso rewind pericoloso.

## Decisione

1. Offrire nella **scheda dedicata** un preflight *soltanto informativo*. La funzione pura `analyzeRewindPreflight` accetta l'ID del libro, il task scelto, l'elenco completo delle attività del libro e solo i metadati correnti di capitoli/scene. Non usa filtri della UI per nascondere task successivi e ignora completamente gli altri libri.
2. Verificare identità univoca del task selezionato e appartenenza al libro. Richiedere timestamp ISO 8601 esplicitamente dotato di timezone e data civile valida (non normalizzare 30 febbraio). Comparare istanti reali, non stringhe locali; contare a parte parità di timestamp e date non affidabili. Mostrare il numero dei successori con data sicuramente posteriore e una preview massima di **5** titoli/fasi/stati; nessuna catena di dipendenze ricostruita o costo inventato.
3. Mostrare come **fotografia attuale**, e mai come snapshot storica, il numero di capitoli, capitoli congelati, scene canoniche e marcature di rilettura. Non accedere a `Scene.text`, `Activity.output`, prompt, reasoning o tracce IndexedDB. Il caso task assente, con data invalida, libro errato o ID duplicato è un errore di preflight, non «nessun successore».
4. Vietare ogni modifica del canone, richiesta provider, salvataggio, replay, tool chiamati senza consenso, ripristino freeze o promozione di draft. Il comando di revisione già esistente continua a richiedere pausa/lease/CAS; l'esito del preflight **non** autorizza nulla. Il futuro rewind #158 richiederà snapshot/versionamento pre/post, preview diff, backup, isolamento multi-tab/lease, decisioni esplicite e invalidazione downstream.

## Verifiche

Vitest per ordine temporale con offset, istanti coincidenti, date invalide anche civili, task duplicati, isolamento cross-book, canone corrente e assenza di testo privato, limite preview e assenza di mutazioni. Playwright desktop/mobile su cronologia sintetica e capitolo congelato. Chiusura #165 solo dopo Frontend CI con 4 shard Chromium desktop/mobile, EPUBCheck 4 EPUB, Pages e cleanup tutti `completed/success` sulla stessa HEAD. Nessuna certificazione di provider fisico o rewind reale.
