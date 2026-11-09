# ADR 0098 — Segmentazione grafemica, senza perdita, per i 12 revisori

- **Stato:** accettato per v0.11.66
- **Data:** 2026-11-09
- **Issue:** [#103](https://github.com/KeyserDSoze/BookWriter/issues/103)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** [ADR 0011](0011-independent-editorial-board-and-chapter-freeze.md), [ADR 0032](0032-literal-narrative-evidence-gate.md)
- **Guida:** [docs/editorial-unicode-segmentation.md](../docs/editorial-unicode-segmentation.md)

## Problema

La redazione a 12 agenti deve esaminare *tutto* il capitolo, segmentandolo in blocchi da massimo 10.000 caratteri JS e non più di 40 segmenti, senza troncamenti. Il metodo precedente sceglieva un offset UTF-16 e chiamava `String.slice` senza rispettare la nozione di carattere visibile. Una coppia surrogata (emoji), un accento combinante o una sequenza ZWJ può così essere spezzata in due prompt distinti; alcune serializzazioni AI possono sostituire metà carattere con U+FFFD. Inoltre `lastIndexOf("\\n", end)` cercava in un indice **inclusivo** pari a 10.000, permettendo occasionalmente 10.001 unità, malgrado il limite promesso. Citazioni letterali e memoria dei ruoli dipendono dalla fedeltà dei segmenti.

## Decisione

1. Conservare l'ordine originale delle scene, la precedenza di interruzione su fine riga/frase e l'indice di segmento, ma utilizzare **confini di grafemi estesi** selezionati da `Intl.Segmenter("it", { granularity:"grapheme" }).segment(text).containing(offset).index` quando il testo supera 10.000 unità UTF-16. Il confine precedente evita di spezzare surrogate pair, diacritici combinanti, CRLF o emoji con joiner senza normalizzarli. La lunghezza di ogni segmento rimane <=10.000; la concatenazione è identica alla prosa di origine.
2. Correggere l'inclusività della ricerca di interruzioni (newline a `end-1`, `. ` a `end-2`) prima della scelta grafemica, evitando il caso precedente 10.001. Tenere il blocco `oltre 40 segmenti` invariato.
3. In modo **conservativo**, rifiutare la review di scene con surrogati UTF-16 non accoppiati, quando non è disponibile `Intl.Segmenter` per un testo da tagliare, o se un singolo grafema supera 10.000 unità. Nessun ripiego su `slice` di code unit, nessuna mutazione del canone, nuova dipendenza o chiamata AI. Riportare un errore comprensibile da correggere prima di riprendere.
4. Non modificare l'interfaccia persistita `ChapterSegment`, la fonte IndexedDB, il routing modelli né la politica dei segreti: i cinque lettori restano ciechi ai segreti, il direttore riceve soltanto i rapporti e prove pertinenti. La validazione `validateReport` esistente verifica che un segmento riportato sia attuale e che la prova letterale sia presente; report vecchi con ancore spostate non possono autorizzare remediation nuove.

## Prove

Vitest ricostruisce il testo originale esattamente dopo tagli in corrispondenza di surrogate, combinanti, ZWJ, CRLF e confini di newline/frase, impone <=10.000 unità e <=40 segmenti, verifica i rifiuti su UTF-16 malformato/browser privo di `Intl.Segmenter`/grafema troppo lungo e ancora una citazione Unicode al secondo segmento reale. Playwright desktop/mobile inietta una scena canonica mock con un emoji ZWJ sul confine, fa ripartire la review e intercetta i primi due prompt di specialisti indipendenti, verificandone la ricostruzione senza duplicazioni o perdita.

## Conseguenze e limiti

- Browser più vecchi senza `Intl.Segmenter` non possono segmentare in sicurezza un capitolo lungo: la review si ferma con messaggio che invita ad aggiornare il browser. Non si nasconde un fallback meno affidabile.
- L'algoritmo può spostare leggermente un confine rispetto ai report precedenti; le ancore narrative correnti rimangono verificate dalla logica esistente e, in caso di mismatch, occorre riavviare la review prima di accettare correzioni. La compatibilità con rapporti persistiti non equivale a migrazione forzata dei capitoli.
- Un confine grafemico corretto **non prova** la verità del fatto narrato, l'indipendenza degli agenti o la bontà della remediation; rimangono necessari giudice critico e supervisione autore, nell'epic #20.
