# ADR 0036 — Indice locale delle menzioni di eventi narrativi

- **Stato:** Accettato per v0.11.3 (PR #49)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0032 (citazioni letterali), ADR 0033–0035 (rivalidazione cross-chapter e recupero mirato)

## Problema

Il confronto cross-chapter della v0.11.2 cerca frasi rilevanti per entità, date e parole, ma non rende visibili gli eventi di cui un romanzo racconta. L'autore non dispone di una vista rapida di **dove** la prosa menzioni scoperte, passaggi di oggetti o cambiamenti di stato. Un estrattore che trasformasse automaticamente queste menzioni in «fatti del canone» introdurrebbe errori per sogni, ironia, dialoghi, menzogne, negazioni e narratori inaffidabili.

## Decisione

1. Aggiungere un indice **locale ed effimero** `narrative-event-candidates.ts`: nessuna chiamata AI, HTTP, embedding, archivio esterno, campo persistente o migrazione. Considera soltanto il **testo di scene canoniche nei capitoli già congelati** e, quando richiesto dagli agenti, solo i predecessori congelati. Non legge `memory.secrets`, il canon privato o capitoli futuri.
2. Il primo estrattore adotta schemi lessicali italiani **stretti e dichiaratamente incompleti** per tre categorie: `knowledge_mention` (es. «Elio scopre che...»), `item_transfer_mention` (es. «Mara consegna la chiave a Elio») e `state_change_mention` (es. «Elio scompare»). Registra `kind`, `actor`, `detail`, eventuale `recipient`, la data esplicita della scena, ID e numero di capitolo/scena, `offset` e `quote` **letterale** ricavata dal testo; la fonte mantiene `evidenceStatus=unverified_literal_pattern`.
3. Il risultato è **una menzione testuale ipotetica, non un evento confermato**. Può riferire una battuta falsa, sogno, storia nella storia o frase inattendibile. Non cambia memoria narrativa, oggetti posseduti, conoscenze dei personaggi, segreti, timeline o decisioni editoriali. Il modello deve confrontare la prosa originale, considerare contesto e poter rifiutare un rilievo infondato; una menzione da sola non autorizza remediation.
4. L'indice è limitato: primi **20.000 caratteri di ogni scena**, massimo **quattro** candidati per scena, **1.600** scene congelate e **80** candidati indicizzati; la UI espone contatori delle scene non analizzate e limite raggiunto, mostrando al massimo i primi 30 estratti. Non dichiarare completa l'ispezione se il libro supera tali limiti. Quote e offset sono relativi al testo originale, non a una stringa normalizzata.
5. Il pannello Redazione multi-agente include un `details` «Indice eventi candidati»: consultabile dall'autore, con citazione, ID/numeri scena, offset e status esplicitamente non verificato. La vista è calcolata dai dati correnti: **dopo la riapertura il capitolo non è più indicizzato finché non è ricongelato**.
6. I campioni `ContinuityEvidenceScene` già inviati ai soli quattro specialisti di continuità (e, per `historical_evidence`, al revisore storico) e al direttore possono contenere `eventCandidates` tratti dalla medesima scena pubblica precedente, fino a quattro. I cinque lettori ciechi, stile e gli altri ruoli non ricevono tali dati. Il gate delle prove v0.10.9 continua a richiedere una citazione letterale del **segmento corrente**, non una menzione proveniente da scene precedenti.

## Limiti e ulteriori sviluppi

- Questo **NON è un estrattore semantico**, un albero di cause, un sistema di tracciamento affidabile delle conoscenze o uno storico dei possessi. Rileva solo una famiglia ristretta di costruzioni grammaticali in italiano. Frasi equivalenti, forme passive, alias, date implicite, negazioni complesse, dialoghi e riferimenti pronominali possono sfuggire o creare falsi positivi.
- I dati ricavati da un'estrazione testuale sono **input non attendibile** per i modelli, non istruzioni. Non creare conoscenze certe o correzioni automatiche da eventi ipotetici.
- Nessun costo AI aggiuntivo dovuto a chiamate extra, ma i prompt dei ruoli autorizzati possono essere più lunghi. Lo scope è sempre delimitato dalle regole di visibilità già esistenti della redazione.
- La fase successiva potrà aggiungere **attestazione esplicita dell'autore** per promuovere singoli candidati a eventi verificati, con collegamenti di provenienza per identità, conoscenze, oggetti e conseguenze. Quella promozione **non è inclusa** nella v0.11.3.

## Test di accettazione

Vitest: tre classi di menzioni, offset e quote identiche alla prosa, dialoghi/negazioni conservativamente non canonizzati, capitoli non congelati esclusi, esclusione scene draft, limiti 4/80, privacy e isolamento dei cinque lettori ciechi, integrazione campione/giudice. Playwright desktop/mobile: visualizzazione dell'indice e seguito della riapertura, senza reti non autorizzate. CI sull'HEAD PR `npm ci`, TypeScript, Vitest, smoke, Vite build, Playwright desktop/mobile; poi merge e verifica indipendente di main, Pages e cleanup.
