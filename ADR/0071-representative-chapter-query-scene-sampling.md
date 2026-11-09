# ADR 0071 — Campionamento rappresentativo delle scene nella query aggregata del direttore

- **Stato:** accettato per v0.11.38
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063, 0069, 0070

## Contesto

Il direttore giudica l'insieme dei rilievi di un capitolo. Il recupero delle scene precedenti usa una query **aggregata**, costruita finora sulle prime **sei scene correnti con testo**. Le versioni 0.11.36 e 0.11.37 hanno bilanciato il lessico (48 termini) e i nomi (16) fra queste scene, ma in un capitolo con sette o molte più scene una menzione importante nell'ultima rimaneva **completamente esclusa dalla query**. Aumentare il numero di scene correnti e i candidati della ricerca inciderebbe sul lavoro locale e sul contesto della redazione; rappresentarle meglio evita l'esclusione automatica della conclusione del capitolo senza aumentare i limiti.

## Decisione

1. Mantenere `MAX_QUERY_SCENES=6`. Se `currentScene` è esplicitamente richiesta da un revisore, usare **solo quella scena**, con comportamento invariato. Se il capitolo contiene al massimo sei scene con testo, usare **tutte** e conservare il loro ordine esistente.
2. Solo oltre sei scene con testo, ordinare una **copia non mutata** per `scene.number` crescente e `scene.id` crescente; le scene senza testo restano escluse. Scegliere le sei posizioni date da `Math.round(i*(N-1)/5)`, per `i=0...5`. Includono sempre la prima e l'ultima, con quattro scene intermedie equidistanti. Con `N>6` queste posizioni sono univoche e il risultato è stabile anche quando i record in input sono invertiti.
3. Applicare le query esistenti **solo alle sei scene selezionate**: `entityQuery`, `dateQuery`, `balancedLiteralNames` con max16 nomi e `balancedQueryTerms` con max48 termini. Non leggere le scene escluse per estrarne segnali o inventare una copertura completa. Non cambiare nessuno dei punteggi o del ranking.
4. Conservare i limiti dei capitoli precedenti: 1600 candidate scandite, 4 scene selezionate (massimo 2 per capitolo), finestra letterale originale 1250 caratteri (due per scena lunga), score e contatori di omissione, `local_structured_lexical_v1` persistito. Le scene non selezionate nella query aggregata possono comunque essere esaminate da ciascun revisore come segmenti singoli, con le normali autorizzazioni.
5. Non consultare segreti, decisioni alias, documenti non congelati o memoria privata, non introdurre nuove chiamate AI/HTTP, campi ZIP/IndexedDB, sync, cambiamento canon, freeze o permessi. Il direttore deve ancora distinguere menzioni letterali e giudizi critici, con la facoltà di respingere un rilievo.

## Conseguenze, rischi e verifiche

Il rischio di escludere l'ultima scena cala, ma alcune scene intermedie non entrano più nel campione aggregato quando il capitolo è lungo. I test devono rendere esplicito questo limite, non mascherarlo come una review integrale. Vitest: inclusione settima scena su sette (nome e termine), scena finale su 101, esclusione di una specifica scena intermedia su otto, determinismo in presenza di record invertiti, richiesta della singola scena sempre intatta e nessuna mutazione. Playwright desktop/mobile sul copy, CI + Pages + cleanup sulla stessa HEAD. Nessuna inferenza semantica e nessun riconoscimento automatico di contraddizioni.
