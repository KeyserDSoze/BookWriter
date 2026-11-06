# ADR 0028 — Dipendenze documentali dichiarate dall'autore, senza indipendenza certificata

- **Stato:** Accettato per v0.10.5 (PR #40)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0013, 0015, 0026, 0027

## Contesto

La v0.10.4 richiede al revisore e al direttore di motivare data, luogo, edizione e identità dell'evento. Il dominio usa l'ID della pagina Wikipedia/Wikisource o dell'item LoC per impedire duplicazioni interne, ma due pagine diverse potrebbero riportare il **medesimo originale** o citarsi l'una con l'altra. Dato che il software non ha consultato la genealogia archivistica, non può dedurre l'indipendenza da URL, titolo, numero di pagina, hash OCR o testi brevi.

## Decisione

1. Introduciamo nel `ChapterHistoricalDossier` l'elenco opzionale `sourceRelations` di dichiarazioni dell'autore. Ogni record è append-only: `id`, ID degli esatti snapshot `sourceAId,sourceBId` ordinati, `relation` (`same_original|derived|unknown`), `note` (24–400), `recordedAt`. Max 60, mai cancellare o sovrascrivere il precedente; l'ultima dichiarazione per coppia prevale.
2. La UI permette solo di scegliere **due fonti attive e citabili** fra Wikipedia, Wikisource con revisione verificata, OCR LoC e trascrizioni manuali autorizzate. È una scelta consapevole dopo un dialogo che mostra IDs, testo, conseguenze per la review e possibili destinazioni future dei dati. Nessun servizio esterno viene contattato nel salvataggio.
3. `same_original` e `derived` dichiarano prudenzialmente due riferimenti non indipendenti: il validatore li raggruppa anche **transitivamente** e rifiuta un finding che li presenta contemporaneamente come prove indipendenti. Un link già noto fra due revisioni della stessa voce continua a essere rifiutato dalle regole canoniche. `unknown` *ritira* un precedente vincolo per la coppia senza provare un rapporto indipendente; il modello deve valutare l'incertezza.
4. I collegamenti valgono solo mentre **entrambi gli snapshot originali sono attivi**. Una nuova revisione non eredita automaticamente un'attestazione riferita alla versione vecchia: lo storico rimane per audit e l'autore può registrare una nuova relazione. Durante le ricerche successive i moduli che ricostruiscono i dossier devono preservare il campo. L'import di un archivio manomesso con record malformati blocca l'uso della sua cronologia invece di cancellare silenziosamente i vincoli.
5. La modifica è applicata con **Web Locks** writer e outbox, confronto CAS su `updatedAt`, salvataggio locale e attività audit nella stessa transazione IndexedDB, autosync disabilitato, outbox ripulita e, se serve, ripristino di sinossi precedente e riapertura dei capitoli congelati e dipendenti. Nessun push automatico di questo cambiamento.
6. Lo storico e il direttore critico ricevono solo relazioni attive come **dati non attendibili**, mai istruzioni. Gli altri undici revisori non le vedono; `sourceRelations` non sono `historical.sourceIds` né citazioni di originali.

## Limiti e rischi residui

- L'app non ha letto, controllato o autenticato nessun originale storico per dedurre questi legami. La **dichiarazione dell'autore può essere errata**, assente o successivamente rettificata. Fonti prive di un link registrato non sono necessariamente indipendenti.
- Anche una catena di dipendenze dichiarate può essere incomplete; non è una dimostrazione epistemica automatica. Un'annotazione errata potrebbe impedire una corroborazione legittima e richiede controllo manuale.
- Le note possono contenere materiale dell'autore: non inviarvi chiavi, segreti di trama o testi non autorizzati. Sono memorizzate nei backup locali e possono raggiungere il provider AI dei ruoli storico/giudice o GitHub secondo i consensi già stabiliti.

## Accettazione

- Prove di blocco su coppie dirette/transitive; rettifiche append-only; snapshot obsolete; tampering; preservazione dei dossier; isolamento e citazioni letterali compatibili.
- Test Playwright desktop/mobile di consenso, salvataggio senza richieste di ricerca, audit, rewind, stato sync e visualizzazione.
- CI su HEAD definitiva (typecheck, Vitest, smoke, build, Playwright); merge solo dopo esito verde, poi verifica CI main, Pages e cleanup.
