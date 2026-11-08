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

## v0.11.30 — nomi espliciti nella prosa senza metadati

Durante una rivalidazione di capitoli successivi il recupero confronta ora anche i **nomi di personaggi, luoghi, oggetti o fazioni già dichiarati nei metadati della scena corrente** con le menzioni *letterali a parola intera* nelle scene precedenti congelate, anche quando quelle scene non riportano alcun tag. Ad esempio, se la scena corrente indica `Ivo` fra i personaggi, una scena precedente con «Ivo nasconde il plico» può essere scelta anche senza `characters: ["Ivo"]`. La sottostringa di «vivo» non vale come menzione di «Ivo»; nomi composti devono corrispondere integralmente.

Il nuovo segnale `matchSignals.literalEntities` è distinto da `matchSignals.entities` (entità dichiarate in entrambi i metadati) e contribuisce con un peso inferiore al ranking. Per ogni interrogazione vengono cercati massimo **16 nomi** espliciti (lunghezza 3–80) e riportati fino a **8 segnali** per scena; l'algoritmo esamina solo inizio, centro e fine entro il limite di 16.000 caratteri della prosa, senza inventare match fra porzioni disgiunte. Le finestre di prova continuano a essere frammenti letterali con offset originali.

**Non è riconoscimento di sinonimi, pseudonimi o identità semantiche.** Il registro degli alias motivati dall'autore non è usato per espandere automaticamente la query, né viene trasmesso agli agenti con questa funzione. Un nome citato può riferirsi a omonimia, falso indizio, dialogo, flashback o errore; il giudice rimane critico. Nessuna correzione o modifica del canone è prodotta dal ranking. Restano invariati gli ancoraggi origine/ultimo predecessore, massimo 4 scene complessive, 2 per capitolo, 1.600 candidati e isolamento dei 5 lettori ciechi; non si aggiungono chiamate di rete o nuovi costi AI. [ADR 0063](../ADR/0063-literal-untagged-prior-entity-retrieval.md), issue #20.

## v0.11.31 — finestre letterali realmente centrate sui nomi

Nella rivalidazione, BookWriter seleziona **prima i nomi citati nella prosa precedente senza tag**, poi le entità presenti nei metadati di entrambe le scene e infine le parole lessicali. I due estratti di massimo 1.250 caratteri mantengono il testo originale: uno è centrato sulla prima corrispondenza completa disponibile in quest'ordine, l'altro presenta un contesto distante.

La ricerca della posizione usa ora **parole intere**, non sottostringhe: «Ivo» non viene individuato dentro «vivo» e «Donna Alba» non coincide con «Donna Albareda». I caratteri speciali nei nomi sono trattati come testo normale. Gli offset sono ottenuti dalla **stringa originale UTF-16**, senza fare ricerche su una copia casefold che potrebbe cambiare lunghezza e spostare i riferimenti. Per mantenere l'app reattiva su manoscritti lunghi si considerano al massimo 48 segnali per scena e termini di lunghezza 3–100; se non esiste un match attendibile, l'estratto conserva l'inizio e la fine del testo **senza inventare una citazione**.

Sono invariati i limiti del ranking (1.600 candidate, 4 scene scelte e 2 per capitolo), il campionamento testuale, le fonti ammesse e i ruoli che ricevono le scene. Non viene introdotto alcun dizionario sinonimico o trasferimento di alias salvati, segreti o note autore. La presenza di una parola intera prova soltanto la presenza di quella frase, **mai** la correttezza di un rilievo. Vedi [ADR 0064](../ADR/0064-whole-word-continuity-windows.md), issue #20.
