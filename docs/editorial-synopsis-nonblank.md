# Sinossi editoriali con testo effettivo — BookWriter v0.11.80

Quando il direttore editoriale ha completato i 12 controlli per ogni segmento e ha respinto motivatamente tutte le critiche, BookWriter produce progressivamente una sinossi di capitolo e una del libro. Queste sinossi diventeranno contesto per le scene e i capitoli successivi: non devono mai essere sostituite da stringhe fatte solo di spazi.

## Protezione della sintesi

Da v0.11.80 il modello deve restituire due stringhe con **almeno 25 caratteri effettivi dopo aver ignorato gli spazi esterni**. Non bastano 25 spazi, tab o righe vuote. Restano i limiti già previsti: massimo 6.000 caratteri per il riassunto del capitolo e 9.000 per quello del libro. Il testo non viene tagliato o riscritto da questo controllo.

Se il modello restituisce una risposta sintatticamente JSON corretta ma supera uno dei due limiti, il validatore distingue il campo interessato e indica il limite esatto invece di presentare un generico errore di formato. Il testo restituito viene rifiutato, non abbreviato, e il nuovo tentativo correttivo deve compattare il riassunto progressivo eliminando ripetizioni e dettagli non essenziali.

Prima di salvare una risposta del modello, il sistema ricontrolla che il capitolo e il **segmento di sinossi** siano proprio quelli della richiesta inviata. La matrice dei 12 revisori e il giudizio freeze devono comunque essere integri e correnti.

## Sinossi gerarchiche — dalla 0.36.0

- **Segmenti intermedi:** il modello aggiorna solo `chapterSummary` (`{"chapterSummary":"..."}`). Un'eventuale `bookSummary` inviata comunque viene ignorata.
- **Ultimo segmento del capitolo:** il modello restituisce entrambe. La sinossi del libro parte da quella **congelata con il capitolo precedente** (`bookSummaryAtFreeze`), mai da una sinossi in corso che contenga già il capitolo: prima il modello riceveva lo stesso capitolo due volte e superava i 9.000 caratteri. I capitoli congelati da versioni senza snapshot continuano a usare la sinossi del libro salvata.
- **Obiettivi espliciti:** circa 2.500 caratteri per il capitolo e 6.000 per il libro, sotto i limiti assoluti invariati (6.000 e 9.000). Il prompt riporta le lunghezze attuali e chiede di ridurre a poche frasi i capitoli più vecchi. Se il modello supera un limite, l'errore indica la lunghezza ricevuta e quella da raggiungere: il tentativo correttivo sa di quanto accorciare.
- Un checkpoint salvato da una versione precedente può contenere ancora una sinossi del libro intermedia: resta accettato solo se valida. [ADR 0172](../ADR/0172-memory-without-duplicates-staged-compaction-hierarchical-synopses.md).

## Se il modello restituisce soltanto spazi

La chiamata viene registrata come **fallita**, senza fare retry automatico. I token input/output validi realmente restituiti restano nell'Activity, anche se la sinossi non viene utilizzata; la stima del costo segue il ledger configurato. Il capitolo **non viene congelato**, la scena resta intatta e la precedente sinossi del libro non viene cancellata. Puoi esaminare l'errore e decidere come riprendere.

Per i checkpoint intermedi provenienti da ZIP o da sessioni interrotte, le sinossi progressive solo-spazi sono già considerate non valide: il recupero supervisionato richiede consenso, archivia il ciclo originale e non avvia chiamate AI da solo.

**Limite importante:** 25 caratteri leggibili non provano che il riassunto sia fedele alla cronologia, ai segreti o ai fatti del romanzo. Il controllo protegge da dati palesemente vuoti, non sostituisce la revisione critica.

[ADR 0112](../ADR/0112-nonblank-editorial-synopsis-and-step-fence.md) · [Issue #117](https://github.com/KeyserDSoze/BookWriter/issues/117) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
