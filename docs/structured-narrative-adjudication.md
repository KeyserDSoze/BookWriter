# Giudice critico strutturato — BookWriter v0.11.10

Nella redazione multi-agente, quattro specialisti (continuità, timeline, segreti e voce dei personaggi) possono indicare una **specifica possibile contraddizione** tra la scena corrente e una precedente menzione confermata dall'autore. Quando lo fanno, devono citare un **ID di testimonianza effettivamente fornito al revisore**, conservare una citazione letterale della **scena corrente** e spiegare l'ipotesi. Un ID inventato, obsoleto o non incluso fra i testimoni consultati viene respinto dal software.

Per questi rilievi il giudice critico non può limitarsi a dire «accetto». Deve compilare una **valutazione separata** dell'identità del soggetto, della cronologia effettiva, della causalità e delle possibili intenzioni artistiche, come flashback, sogni, omonimie e narratore inaffidabile. Ogni dimensione contiene la conclusione e una motivazione autonoma. In dashboard trovi l'ipotesi iniziale e il riquadro **Giudizio narrativo strutturato** nel resoconto del revisore.

### Quando un intervento è autorizzabile

Un'eventuale correzione del conflitto marcato richiede **tutte** le seguenti condizioni: citazione valida e fonte precedente ancora disponibile, identificazione del medesimo soggetto, nessuna spiegazione artistica plausibile riscontrata, una valutazione complessiva di conflitto supportato e almeno un'incompatibilità cronologica o causale valutata dal giudice. In assenza di queste condizioni, il giudice deve respingere o rivalutare la critica: **una menzione attesta soltanto un testo, non la verità dell'evento**.

Il controllo è ripetuto prima che il modello di scrittura riceva una remediation, compresi i casi di importazione ZIP e ripresa dopo una pausa. Se nel frattempo un capitolo è stato riaperto, un alias revocato o una menzione invalidata, l'intervento non è autorizzato. Le spiegazioni false positive vengono conservate nello storico senza modificare prosa o memoria.

### Cosa resta invariato

I **12 controlli** continuano a usare richieste indipendenti; il giudice resta una richiesta distinta, i cinque lettori ciechi non ricevono testimoni narrativi aggiuntivi e non possono marcare questi conflitti. `finding.evidence` deve sempre citare solo il segmento corrente. Nessun alias viene trasformato in identità canonica, nessuna remediation viene approvata automaticamente dal semplice matching, nessuna nuova chiamata AI o sincronizzazione viene aggiunta. I testi di istruzioni più lunghi possono aumentare l'uso di token delle chiamate già esistenti.

Le decisioni archiviate restano **valutazioni fallibili**: il software non può verificare autonomamente l'intenzione dell'autore, l'ordine narrativo o una causalità complessa. La nuova analisi strutturata riguarda solo i rilievi esplicitamente collegati a una menzione precedente attestata; gli altri rilievi mantengono il controllo editoriale esistente.

Riferimenti: [ADR 0043](../ADR/0043-structured-narrative-conflict-adjudication.md), [contesto precedente](attested-contextual-review.md), [prove narrative](editorial-narrative-evidence.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
