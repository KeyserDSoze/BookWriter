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

## v0.11.32 — distribuzione del budget fra capitoli molto grandi

Il limite di 1.600 scene **non** aumenta, ma quando le scene candidate superano quel limite il campionamento preliminare cambia: anziché esaminare tutte le scene del capitolo origine prima di passare all'ultimo predecessore, BookWriter esamina a turni i capitoli precedenti, con priorità di ordine a **capitolo origine, ultimo predecessore, poi capitoli intermedi dal più recente**. Le scene della modifica che l'autore ha indicato con `originSceneIds` vengono tentate per prime nel capitolo origine.

Per esempio, un capitolo origine con 1.705 scene non può più assorbire da solo il budget lasciando fuori ogni scena del predecessore e dei capitoli intermedi. Quando un capitolo contiene più scene, i turni successivi recuperano ulteriori candidati fino a 1.600; il ranking lessicale e strutturato delle scene effettivamente lette, la selezione finale di massimo **quattro scene** e il limite di **due per capitolo** restano invariati. Se la storia comprende più di 1.600 capitoli con scene, hanno precedenza gli ancoraggi e i capitoli più recenti: i capitoli non scanditi non sono implicitamente verificati.

L'ordine è deterministico per numero e ID di capitolo/scena e non dipende dalla disposizione dei record nel libro. `candidateSceneCount`, `scannedSceneCount`, `unscannedSceneCount` e `omittedSceneCount` rimangono conteggi reali, così l'autore può vedere che **la copertura resta parziale**. Non viene aggiunta alcuna chiamata AI, indice persistente, condivisione di segreti o inferenza di identità. Vedi [ADR 0065](../ADR/0065-balanced-cross-chapter-candidate-sampling.md), issue #20.

## v0.11.33 — due estratti pertinenti nella stessa scena lunga

Quando una scena precedente supera 2.800 caratteri, il recupero continua a inviare **al massimo due finestre letterali da 1.250 caratteri**, con offset riferiti al testo originale. La prima rimane focalizzata sul primo segnale attendibile in ordine `literalEntities`, `entities`, `terms` (ADR 0064). **La seconda**, se disponibile, ora punta al primo *altro segnale* presente fuori dalla prima finestra: così un nome e un oggetto citati in posizioni distanti della stessa scena possono entrambi essere visibili ai revisori. Se i segnali successivi sono già coperti dal primo estratto, oppure non sono reperibili come parole intere, resta il precedente frammento di contesto distante.

I due estratti sono mostrati in ordine di offset originale, non come una narrazione continua: **tra di essi può mancare testo importante**. La ricerca continua a essere letterale e limitata ai primi **48 segnali** validi (ogni termine 3–100 caratteri), con confini Unicode e nessuna sostituzione di sinonimi o alias. Non viene ampliato il numero dei candidati, delle scene, dei revisori o delle richieste AI: il costo in token dei due estratti resta vincolato alle dimensioni già esistenti. La ricerca del secondo riferimento può richiedere più lavoro locale di scansione.

La presenza di due menzioni in una scena precedente **non** certifica possesso, intenzioni, segreti, cronologia né una contraddizione. Gli agenti autorizzati e il giudice mantengono la valutazione critica; i cinque lettori ciechi non ricevono questi frammenti aggiuntivi. Nessun campo viene scritto nella memoria del libro o trasferito automaticamente in canone. Vedi [ADR 0066](../ADR/0066-dual-focused-continuity-windows.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).

## v0.11.34 — seconda occorrenza letterale fuori dalla prima finestra

Il criterio introdotto in v0.11.33 individuava soltanto la **prima occorrenza** di ciascun segnale. Se «Ivo» era già visibile nella prima finestra e compariva una seconda volta molto più avanti, o se «chiave» appariva sia nella prima finestra sia in una scena successiva dello stesso capitolo, la seconda menzione poteva essere ignorata e sostituita dal contesto generico.

Ora, dopo aver individuato la prima finestra, la ricerca del secondo estratto considera **separatamente le porzioni non coperte** prima e dopo quella finestra, rispettando i confini di parole e gli offset originali UTF-16. Tenta prima un **segnale diverso** (nell'ordine di priorità già noto), anche quando la sua prima occorrenza era dentro il primo estratto. Solo se nessun altro segnale distinto compare fuori dalla finestra, può scegliere una **nuova menzione dello stesso nome**; altrimenti conserva il fallback di contesto distante.

Restano al massimo **48 segnali**, due finestre da 1.250 caratteri nelle scene lunghe, quattro scene nel campione e 1.600 candidati per il ranking. Questa ottimizzazione può leggere ulteriori porzioni **sullo stesso dispositivo** e non introduce chiamate AI, ulteriori estratti o nuove autorizzazioni. Due citazioni dello stesso nome **non sono due attestazioni indipendenti**: ripetizioni, bugie, flashback, omonimie e cambi di prospettiva richiedono ancora il giudizio editoriale. Gli alias motivati, la memoria privata e i lettori ciechi restano fuori dal nuovo recupero. Vedi [ADR 0067](../ADR/0067-repeated-literal-continuity-witnesses.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
