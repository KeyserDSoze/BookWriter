# ADR 0070 — Nomi letterali bilanciati tra le scene della query di capitolo

- **Stato:** accettato per v0.11.37
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063, 0064, 0068, 0069

## Contesto

La v0.11.36 ha distribuito i **48 termini lessicali** fra le prime sei scene correnti nella query aggregata del direttore. Tuttavia `literalQuery` per i nomi espliciti continuava a ricavarsi da `entityQuery`, un `Set` popolato in ordine, con `slice(0,16)`. Se la prima scena possedeva almeno 16 nomi, i personaggi, oggetti o luoghi della sesta scena erano esclusi dalla ricerca di nomi **senza tag nella prosa precedente**. Il matching strutturato dei metadati già usava invece tutto `entityQuery`, perciò il problema colpiva soprattutto le menzioni non etichettate (ADR 0063).

## Decisione

1. Conservare `entityQuery` completo dei nomi pubblici espliciti delle scene correnti selezionate (massimo sei con testo) per `matchSignals.entities`: **non** introdurre un nuovo cap sulla ricerca dei metadati strutturati.
2. Per `literalEntities` creare `balancedLiteralNames(selectedQuery)`: partendo dai massimi **30 riferimenti per scena**, eliminare i nomi di lunghezza inferiore a 3 o superiore a 80 (già casefold e deduplicati per scena); inserire un primo nome per scena in ordine corrente, poi un secondo per scena, e così via, deduplicando fra scene fino a **16 nomi**.
3. Con `currentScene` esplicita, eseguire la stessa routine ma su una sola scena: l'ordine rimane equivalente al precedente. Non modificare `balancedQueryTerms`, cap 48, ranking e punteggi, priorità dei nomi in `targetedLiteralWindows`, ricerca originale a parola intera o gestione Unicode.
4. I nomi provengono **soltanto dai metadati espliciti** `characters`, `locations`, `items`, `factions` delle scene correnti. Vietato usare registri alias, segreti, note private, canon inferito o nuove chiamate AI. Non riconoscere automaticamente sinonimi, identità, possesso e causalità.
5. Conservare massimo **8 `literalEntities` per scena precedente**, 1600 candidate, 4 scene selezionate (2 per capitolo), i tre frammenti di scansione per scene lunghe e due finestre letterali originali da 1250 caratteri. Non cambiano contatori, metodo di audit, formati ZIP/IndexedDB, freeze, destinatari autorizzati o giudizi.

## Test e tradeoff

Vitest su prima scena con 25 nomi diversi, ultima scena della query con nome determinante, prosa precedente senza tag, assenza di match per sola prima scena, match per singola sesta scena, isolamento dei lettori ciechi e campione riutilizzato dal giudice; esclusione della settima dalla query aggregata. Playwright desktop/mobile sull'avviso di rivalidazione; CI/Pages/cleanup sulla stessa HEAD.

**Tradeoff:** i primi 16 nomi della prima scena non sono più tutti rappresentati nella query aggregata quando altre scene contribuiscono; è un budget fisso e non un controllo completo del capitolo. Il giudice deve distinguere indizi letterali da prove verificabili.
