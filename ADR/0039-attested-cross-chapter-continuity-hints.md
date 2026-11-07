# ADR 0039 — Confronti locali e consultivi tra eventi attestati

- **Stato:** proposto per v0.11.6
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0036–0038

## Contesto

La v0.11.5 mostra gli eventi esplicitamente annotati dall'autore che restano validi. Il confronto per nome tra capitoli richiede ancora di aprire singole annotazioni e verificare a mano le sequenze. È possibile evidenziare alcune **coppie letterali specifiche** senza inventare un'analisi semantica o modificare il canone.

## Decisione

1. `buildNarrativeContinuityHints` lavora **soltanto in memoria** sulle attestazioni `affirmed` correnti già rivalidate da `buildNarrativeEventLedger`. Le attestazioni `dismissed`, stale, rettificate, fuori freeze o prive di prova vengono escluse; non vengono consultati segreti, dossier storici o scene future.
2. Confrontare attestazioni di un **identico nome letterale** in capitoli distinti, ordinate per numero capitolo, scena e offset, con tre regole finite:
   - `post_death_activity`: dopo «muore», una successiva menzione «parte», «arriva», «fugge», «ritorna» o «scompare»;
   - `repeated_death`: due menzioni «muore» senza una menzione attestata «risorge» intermedia; «risorge» azzera **solo** questa ipotesi letterale;
   - `declared_date_backtrack`: per due eventi attestati con date di scena **rigorosamente ISO `YYYY-MM-DD` valide**, data successiva inferiore alla precedente nell'ordine dei capitoli. Date non parseabili e altre forme non vengono indovinate.
3. Mostrare per ciascun segnale due citazioni letterali, offset, capitolo/scena, date dichiarate e motivazioni dell'autore, con spiegazione del **perché controllare** e delle alternative (flashback, omonimie, soprannaturale, prospettive). Nessun segnale è una contraddizione verificata né un finding dei 12 agenti.
4. Al massimo **40 segnali visualizzati** in ordine deterministico; mostrare quanti sono omessi. Nessuna persistenza, nuove richieste AI/HTTP, migrazione ZIP, aggiornamento canone/segreti/oggetti/timeline, apertura del capitolo, autosync o bypass della redazione. I cinque lettori ciechi e il giudice non ricevono nuovi prompt.
5. Vitest su invalidazioni, rettifiche, ripetizioni, risurrezione e date, limite/ordine, integrità della memoria; Playwright su due capitoli annotati, riapertura UI, isolamento rete e layout mobile/desktop.

## Limiti

L'ordine dei capitoli non rappresenta necessariamente il tempo degli eventi. Le date sono **metadati di scena correnti**, non attestazioni datate: anche una data ISO valida può essere narrativa, ipotetica o sbagliata. Una frase letterale «muore» o «risorge» non prova che qualcosa sia avvenuto davvero: il software conserva la dichiarazione dell'autore, non un fatto storicamente o semanticamente autenticato. Il matching esatto non riconosce alias né omonimi. Nessun risultato certifica coerenza o completezza.
