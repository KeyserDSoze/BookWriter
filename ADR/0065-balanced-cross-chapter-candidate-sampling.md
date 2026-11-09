# ADR 0065 — Campionamento bilanciato dei candidati di continuità

- **Stato:** accettato per v0.11.32
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0033–0035, 0063, 0064

## Problema

In `retrievePriorContinuityScenes` il limite di 1.600 candidati era applicato dopo un ordinamento che elencava **tutte** le scene del capitolo origine e solo dopo quelle dell'ultimo predecessore. In un import con oltre 1.600 scene nel solo capitolo origine, l'ultimo predecessore non veniva neppure scansionato. Nonostante l'invariante di ADR 0035 («almeno un ancoraggio da origine e ultimo»), il codice non poteva includere la sua scena; anche un capitolo intermedio con il nome letterale corretto restava invisibile. I contatori di omissione erano corretti ma non risolvevano questo squilibrio.

## Decisione

1. Con **al massimo 1.600 scene candidate**, mantenere il recupero e ranking esistenti, senza costi aggiuntivi.
2. Soltanto oltre il limite, costruire una sequenza locale e deterministica dei capitoli: **origine**, poi **ultimo predecessore** se differente, poi capitoli precedenti rimanenti per numero decrescente e ID crescente. Ignorare i capitoli senza scene. In ogni capitolo ordinare le scene per numero e ID; nell'origine, anteporre le scene esplicitamente nominate in `originSceneIds`, mantenendo poi l'ordine deterministico.
3. Ripartire **a turni** fino a 1.600 candidati: una scena per capitolo in ordine di priorità, poi la seconda di ogni capitolo che ne abbia, e così via. Interrompersi esattamente al cap, senza esplorare nuove scene. Per libri con più di 1.600 capitoli con scene possono rimanere capitoli interamente esclusi; preservare comunque i due ancoraggi in testa.
4. Applicare il **ranking esistente** a tutti e soli i candidati così scansionati. Mantenere `origin_anchor`, `latest_anchor`, `targeted_match`, `coverage_fallback`, massimo 4 scene finali e 2 per capitolo; i segnali non sono evidenza semantica. Un'eventuale scena intermedia può occupare uno degli slot solo se è nel budget e il punteggio la rende rilevante.
5. Conservare `method=local_structured_lexical_v1`, `candidateSceneCount`, `scannedSceneCount`, `unscannedSceneCount`, `omittedSceneCount` e l'audit legacy compatibile. Non memorizzare un indice persistente, non cambiare ZIP/IndexedDB, non modificare il canone o giudizi, e non introdurre altre chiamate AI/HTTP. I quattro specialisti e il giudice restano gli unici destinatari normali; storico soltanto sul trigger documentale, mai i cinque lettori ciechi.

## Tradeoff e verifiche

Il campionamento distribuito aumenta la diversità dei capitoli esaminati, **non la completezza**. Un evento decisivo collocato in una scena oltre il turno disponibile può ancora essere perso; `unscannedSceneCount > 0` indica tale limite. La ricerca lessicale non dimostra contraddizioni, identità o verità storiche.

Vitest su origine e ultimo da 1.705 scene, scena marcata modificata alla fine dell'origine, evento letterale in capitolo intermedio, conteggi e privacy, oltre 1.600 capitoli e ordine inverso dei record; Playwright desktop/mobile per i messaggi di rivalidazione. CI completa e deploy Pages sullo stesso `main`.
