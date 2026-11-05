# ADR 0015 — Citazioni storiche vincolate a ciascuna fonte

- **Stato:** proposto per v0.9.2; verifica CI e merge ancora necessari
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **PR:** [#27](https://github.com/KeyserDSoze/BookWriter/pull/27)
- **Predecessori:** ADR 0011, 0013, 0014

## Contesto

In v0.9.1 un `HistoricalClaim` può citare fino a tre `sourceIds`, ma `validateHistoricalClaim` richiede che la sola `sourceQuote` compaia in **almeno una** delle fonti. Un modello può quindi collegare una vera citazione a due riferimenti aggiuntivi che non la contengono, dando una falsa impressione di corroborazione. Il giudice riceve gli estratti ma non una corrispondenza esplicita tra citazione e singola fonte. È un bug di integrità delle evidenze, non una prova della veridicità delle fonti.

## Decisione

1. Il nuovo report storico usa `sourceEvidence:[{sourceId,quote}]` con un elemento obbligatorio per ogni ID dichiarato in `sourceIds` per le valutazioni `consistent_with_excerpt` o `contradicts_excerpt`. Massimo tre fonti, senza duplicati; nessun elemento aggiuntivo o mancante. Ogni `quote` (12–500 caratteri) deve comparire letteralmente nell'**estratto della fonte associata** e la fonte deve essere attiva e valida.
2. Per `unverified` `sourceIds` e `sourceEvidence` devono essere vuoti e `sourceQuote` assente. Una citazione Crossref/DOI continua a essere illegale come prova.
3. Le citazioni `sourceQuote` dei libri precedenti restano ammesse **solo con una singola fonte**. Un vecchio report già archiviato non viene cancellato né riscritto. Un nuovo report con più fonti e una sola `sourceQuote` viene respinto; se un report storico legacy presenta più ID senza citazione individuale, la UI e il giudice non devono trattarli come corroborati.
4. Due revisioni della stessa pagina Wikipedia (`pageId` uguale) **non** contano come due fonti indipendenti per un singolo claim, anche quando i loro ID sono distinti. Due pagine diverse possono ugualmente condividere la stessa origine editoriale: il giudice deve verificarne pertinenza e indipendenza sostanziale, non dedurla dagli ID.
5. Soltanto il revisore storico emette `sourceEvidence`; gli altri undici ruoli restano ciechi al dossier e i lettori ai segreti. Il direttore riceve per ogni fonte `citedQuote` e `quoteMatches` con l'estratto originale. In UI le citazioni appaiono accanto alla fonte corrispondente, non raggruppate in una falsa prova cumulativa.
6. Il cambiamento non introduce chiamate esterne, migrazioni IndexedDB, modifica del canon o nuove autorizzazioni. Salvataggio, freeze, rewind, GitHub/ZIP e spesa AI mantengono le regole esistenti.

## Limiti epistemici

Il controllo è **testuale**. Non prova né veridicità né pertinenza storica; non conferma che Wikipedia sia indipendente, che due estratti si sostengano reciprocamente o che una citazione sia contestualizzata correttamente. Tutti i risultati rimangono fonti terziarie. Non vengono scaricati articoli DOI o fonti primarie; restano in roadmap nell'issue #23. I report legacy già congelati non vengono riclassificati automaticamente: occorre una nuova review per applicare il controllo.

## Accettazione

- Una sola citazione non abilita più due `sourceIds`.
- Due citazioni valide su due pagine diverse passano; citazione assegnata alla pagina sbagliata, fonte non attiva, ID duplicato, metadati DOI e dati mancanti sono respinti.
- Revisioni diverse di una pagina non si travestono da più fonti indipendenti.
- `unverified` non accetta evidenza documentale mascherata.
- Report preesistenti con una fonte e `sourceQuote` restano interpretabili.
- Specialista e giudice ricevono istruzioni appropriate; gli altri revisori non vedono dossier.
- Typecheck, Vitest, smoke, build e Playwright desktop/mobile sulla HEAD della PR prima di ogni merge.
