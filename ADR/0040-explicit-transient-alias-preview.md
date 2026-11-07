# ADR 0040 — Anteprima alias esplicita, limitata a una coppia e non persistente

- **Stato:** accettato per v0.11.7 (PR #53)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessore:** ADR 0039 — segnali consultivi fra attestazioni valide

## Contesto

Il controllo v0.11.6 confronta eventi del medesimo nome letterale, senza rilevare che due nomi differenti potrebbero essere uno pseudonimo o soprannome. Assumere automaticamente l'identità falserebbe la lettura, potrebbe fondere due personaggi distinti e produrre diagnosi ingannevoli o persino cancellare segnali esistenti.

## Decisione

1. La UI permette di scegliere **manualmente due nomi distinti già presenti nelle attestazioni `affirmed` correnti**. L'utente deve confermare esplicitamente con un dialogo: la selezione è un'**ipotesi temporanea di confronto**, non un fatto o vincolo del canone.
2. `buildNarrativeContinuityHints(book, aliasPreview?)` conserva **invariato** l'insieme dei segnali basati sul nome letterale e aggiunge, soltanto per la coppia esplicitamente selezionata, possibili confronti **cross-name** usando le stesse tre regole letterali della v0.11.6. Nessuna inferenza transitiva, fuzzy matching, alias automatico o fusione delle identità canoniche. In presenza di una menzione attestata «risorge», si interrompe solo l'ipotesi post-mortem pertinente alla coppia, mai il calcolo dei segnali originali.
3. La selezione viene conservata **solo nello stato React della scheda**, associata all'ID del libro, senza IndexedDB, ZIP, snapshot GitHub, URL, sessionStorage o nuovi campi dominio persistiti. Si annulla con **Azzera confronto** oppure al reload. Una selezione invalida (nome mancante, uguale ignorando il case, privo di attestazioni valide, riapertura) viene ignorata conservativamente.
4. Ogni traccia aggiunta è contrassegnata `identityBasis=alias_preview` e rende espliciti **entrambi i nomi**, le citazioni, gli offset e le ragioni. Le tracce del nome identico sono etichettate `literal_name`. Rimane il limite complessivo di 40 tracce visualizzate con omissioni contate: il preview potrebbe occupare slot e non garantisce copertura esaustiva.
5. Nessuna nuova chiamata AI/HTTP, nessuna modifica a prosa, memoria, segreti, timeline, oggetti, freeze, review, autosync o pacchetti per i 12 revisori. Un futuro registro di alias persistenti richiede un'altra ADR, audit/autenticazione dei consensi, invalidazione e schema ZIP rigoroso.

## Conseguenze e verifiche

La UX mostra un'ipotesi **esplorativa**, non una dichiarazione che i due nomi identifichino la stessa persona. Confronti su romanzi non lineari restano euristiche; un alias selezionato non rende gli eventi veri. Unit test su consenso trasmesso come parametro, coppia invalida, rettifiche, additività, resurrezione e date; Playwright desktop/mobile per conferma, azzeramento, mancata persistenza, nessuna rete e canone immutato.
