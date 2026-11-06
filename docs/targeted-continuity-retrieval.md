# Confronto mirato delle scene — BookWriter v0.11.2

## Perché è diverso

Quando una revisione retroattiva o un aggiornamento delle fonti storiche obbliga a ricontrollare i capitoli successivi, BookWriter non si limita più ad affiancare un paio di scene del capitolo modificato e dell'ultimo predecessore. Il sistema ora cerca anche **passaggi pertinenti nei capitoli intermedi**.

Per scegliere le scene considera personaggi, oggetti, luoghi, fazioni dichiarati nelle scene, termini lessicali presenti nella prosa e date esplicite coincidenti. Per esempio, se un personaggio sostiene di cercare una chiave nel capitolo 7, una consegna della stessa chiave nel capitolo 3 può rientrare nel campione, anche se l'evento originario era nel capitolo 1.

**Importante:** questo confronto identifica parole e metadati correlati, **non** determina che vi sia una contraddizione, non riconosce automaticamente sinonimi o motivazioni implicite e non autentica un fatto storico.

## Quali dati vengono mostrati ai revisori

- Almeno un campione dal capitolo da cui parte la modifica e uno dall'ultimo predecessore (quando sono differenti), più scene selezionate per pertinenza fra gli altri capitoli precedenti.
- Fino a **quattro scene**, mai più di due per capitolo. Ogni scena ha capitolo e ID, eventuale data, segnali che hanno contribuito al ranking e motivo della scelta.
- Se una scena è lunga, due finestre **letterali** di massimo 1.250 caratteri, con posizione esatta nel manoscritto. Una finestra punta ai termini corrispondenti; non vengono inventate parti intermedie.
- Contatori di **candidati, scene scansionate, scene non analizzate** e scene omesse dal campione. Quando il romanzo è molto grande, il ranking si ferma a 1.600 scene candidate; dei testi oltre 16.000 caratteri campiona inizio, centro e fine per il ranking. Il risultato rimane parziale e va interpretato come tale.

Il direttore, e gli specialisti di continuità, timeline, segreti e voce, possono utilizzare questi estratti di **prosa già congelata**. Lo storico riceve lo stesso tipo di campione soltanto se è cambiato il dossier documentale. I cinque lettori ciechi **non** ricevono i nuovi estratti né il canone privato.

## Come interpretare un risultato

Un risultato con `selectionReason=targeted_match` significa soltanto che il codice ha trovato parole, entità o date in comune; non significa che i due passaggi si contraddicano. `coverage=partial`, `omittedSceneCount` e `unscannedSceneCount` devono impedire di interpretare il campione come ispezione totale del romanzo.

Il validatore v0.10.9 richiede ancora al revisore una citazione letterale **del segmento attualmente esaminato**. Può citare nella spiegazione gli ID delle scene precedenti, ma non deve spacciare le parole di una scena remota per prova del segmento corrente. Il direttore accetta o respinge le remediation spiegando il merito, e lo storico del freeze memorizza numero di candidati e ID delle scene scelte.

La selezione avviene **sul dispositivo**, senza inviare nuove richieste pubbliche o AI. Gli estratti sono comunque inclusi nei prompt degli agenti già configurati e possono consumare token aggiuntivi.

Riferimenti: [ADR 0035](../ADR/0035-targeted-local-continuity-retrieval.md), [catena di rivalidazione](cross-chapter-continuity.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
