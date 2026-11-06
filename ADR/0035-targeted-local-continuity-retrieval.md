# ADR 0035 — Recupero locale mirato delle scene per la continuità

- **Stato:** Accettato per v0.11.2 (PR #48)
- **Data:** 2026-11-06
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0032 (citazioni narrative), ADR 0033 (catena di rivalidazione), ADR 0034 (rewind delle fonti storiche)

## Problema

Le review cross-chapter dalla v0.11.0 selezionano al massimo due scene dal **capitolo origine** e due dall'**ultimo predecessore**. Un indizio decisivo in un capitolo **intermedio** non entra nel confronto, anche se è collegato ai personaggi, agli oggetti e alla data della scena rivalidata. In una scena lunga, mostrare solo inizio e fine nasconde eventi nel mezzo. Il direttore può quindi approvare un controllo con copertura documentale troppo debole.

## Decisione

1. Un nuovo modulo puramente locale `continuity-retrieval.ts` costruisce **al volo** segnali per le scene già congelate a monte. Dalla scena corrente (o da un campione bounded delle scene del capitolo nel prompt del direttore/freeze) estrae **solo** nomi dichiarati di personaggi, luoghi, oggetti e fazioni, parole distintive della prosa e date esplicite. Il confronto è **lessicale/strutturato**, senza embedding, ricerca web, identificazione semantica degli eventi o inferenze sul canon privato. La metrica è euristica, non un punteggio di verità.
2. Tra le scene precedenti candidate, **conserva almeno un ancoraggio** dal capitolo che ha originato la modifica e, se diverso, dall'ultimo predecessore. Gli altri slot sono assegnati a scene con riferimenti coincidenti anche in **capitoli intermedi**. Ordinamento deterministico per punteggio, capitolo, numero e ID della scena, con massimo **quattro scene totali e due per capitolo**. Quando non esiste alcuna coincidenza, usa un fallback dichiarato, senza fingere pertinenza.
3. Le scene lunghe usano **due finestre letterali di massimo 1.250 caratteri**, con offset esatto nel testo originario. Una finestra viene centrata sul primo termine significativo trovato secondo l'ordine deterministico di lunghezza, l'altra mantiene contesto lontano. Nessuna concatenazione di parole da punti diversi viene spacciata per citazione continua; la copertura resta `partial` quando il testo non è integrale.
4. Limiti operativi: al massimo **1.600 scene** esaminate dal ranking; se il manoscritto è più grande, origine e ultimo predecessore hanno priorità, poi le più recenti. Per scene di lunghezza superiore a 16.000 caratteri, il ranking considera un massimo di circa 16.000 caratteri distribuiti fra inizio, mezzo e fine; le finestre di citazione sono invece prese dal testo originale. La query considera al massimo 48 termini, fino a sei scene correnti se non è indicata una scena specifica.
5. `ContinuityEvidencePack` espone `retrieval.method=local_structured_lexical_v1`, `candidateSceneCount`, `scannedSceneCount`, `unscannedSceneCount`, `omittedSceneCount`, `selectionReason`, `matchSignals` e finestre letterali. Nel freeze, `lastContinuityReview` registra statistiche quantitative opzionali accanto agli ID campionati e marca la copertura parziale se scene/finestre rimangono omesse. La UI mostra la modalità e il limite, senza dichiarare che i testimoni siano stati tutti letti.
6. Quattro specialisti di continuità e giudice ricevono i campioni; lo storico li riceve **solo per** `historical_evidence` (ADR 0034). Il gate `finding.evidence` richiede **sempre citazione letterale del segmento corrente** (ADR 0032). I cinque lettori ciechi e gli altri ruoli non ricevono il nuovo retrieval né memoria privata aggiuntiva. Il pacchetto contiene solo prosa già scritta e congelata, mai capitoli futuri, segreti del canone o ricerca esterna.

## Tradeoff, rischi e limiti

- Un match per parole, nomi o date **non certifica una contraddizione**. Lessico sinonimico, assenza di metadati, ironia, cambi di identità, fatti impliciti e date discordanti possono essere mancati. Non annunciare "retrieval semantico" o "copertura esaustiva"; è un miglioramento mirato della copertura **documentale**, non una seconda mente che capisce l'intero romanzo.
- In manoscritti grandi, una scena esclusa dal limite di 1.600 candidati o una porzione non compresa nelle tre finestre di ranking può ancora nascondere indizi. La UI e i prompt devono mostrare i limiti; il direttore mantiene libertà di rigetto, e l'autore può riaprire la review.
- Il ranking e i prompt possono avere un costo locale di calcolo e aumentare alcuni token dei ruoli autorizzati; nessuna nuova chiamata AI né rete. Nessun indice persistente o migrazione dati. I campi aggiuntivi dell'audit sono opzionali per ZIP precedenti e convalidati in modo `strict` per import ostili.
- Per review multi-segmento, lo stesso capitolo può generare campioni differenti per il singolo revisore e per il direttore (query di capitolo). Lo storico del freeze conserva gli ID della selezione di **capitolo**, non promette di elencare tutti i frammenti visti in ogni chiamata separata.

## Gate di qualità

Vitest per recupero di una scena in capitolo intermedio, segnali deterministici, finestra nel mezzo con offset letterale, limite di candidati, niente scene future o canon segreto, prompt dei revisori autorizzati e lettori ciechi invariati, audit, ZIP legacy e metadati strict. Playwright desktop/mobile su indicazioni di retrieval. CI PR su HEAD esatta `npm ci`, TypeScript, Vitest, smoke, build e browser. Merge solo verde; verificare poi `main`, Pages e cleanup prima di comunicare il rilascio.
