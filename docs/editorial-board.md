# Redazione multi-agente di BookWriter — v0.8.0

Dopo la scrittura e il primo consolidamento delle scene di un capitolo, l'autopilot apre automaticamente una **redazione indipendente**. Il capitolo non viene considerato definitivo né sincronizzato su GitHub finché questo percorso non è concluso.

La schermata **Dashboard → Redazione multi-agente** mostra quali verifiche sono in corso, le criticità trovate, le correzioni suggerite, le decisioni dell'editor e lo stato di ogni capitolo.

## Chi controlla il capitolo

| Revisore | Controllo |
| --- | --- |
| Coerenza e causalità | Contraddizioni fra scene, informazioni, cause ed effetti |
| Segreti, indizi e spoiler | Rivelazioni premature, informazioni non conosciute dai personaggi e payoff |
| Timeline e cronologia | Durate, ordine degli eventi, spostamenti ed età |
| Plausibilità e accuratezza storica | Possibili anacronismi e affermazioni che richiedono una verifica documentale |
| Voce, dialoghi e motivazioni | Personaggi che parlano o agiscono fuori carattere |
| Stile e lingua | Ripetizioni, cliché, sintassi, registro e punto di vista |
| Struttura, ritmo e payoff | Funzione del capitolo, tensione e promesse narrative |
| Lettore esperto del genere | Originalità e aspettative del genere |
| Lettore generalista | Chiarezza, accessibilità e coinvolgimento |
| Lettore critico e scettico | Forzature, coincidenze e logica |
| Lettore delle relazioni | Empatia, conflitti e sfumature dei personaggi |
| Lettore di misteri e promesse | Suspense, curiosità e rivelazioni percepite dal lettore |

**Non sono dodici personaggi simulati nella stessa conversazione.** Ogni revisore usa una richiesta AI distinta; vede il proprio contesto e le proprie brevi note, non le conclusioni degli altri. I cinque lettori ricevono soltanto le informazioni già disponibili al lettore: **non vedono il registro dei segreti**, i dossier privati o gli archi futuri. Gli specialisti leggono le entità e la timeline pertinenti; il revisore dei segreti può leggere il registro privato.

## Come funziona il ciclo

1. **Scrittura e prima review delle scene:** il capitolo viene composto e controllato localmente, ma questo non equivale a congelamento.
2. **Analisi dei dodici agenti:** ciascuno legge tutti i segmenti del capitolo. Un rapporto può essere positivo oppure includere criticità con categoria, severità, citazione di prova, ragione e remediation.
3. **Direttore editoriale:** riceve i rapporti, valuta ogni critica, accetta ciò che ha fondamento e respinge con una spiegazione ciò che è una falsa pista o danneggerebbe una scelta artistica voluta.
4. **Remediation:** soltanto gli interventi approvati vengono applicati, riscrivendo le scene coinvolte. Le osservazioni respinte non diventano istruzioni all'autore.
5. **Riconciliazione:** viene aggiornato il canone, inclusi oggetti, conoscenze, timeline e segreti, dopo le modifiche.
6. **Nuova analisi:** gli stessi dodici ruoli riesaminano il capitolo, da capo, per trovare nuovi problemi o effetti collaterali delle correzioni.
7. **Esito:** quando il direttore non ritiene necessarie altre modifiche, il sistema aggiorna le sinossi del capitolo e del libro, archivia i rapporti e marca il capitolo **congelato**. Soltanto ora l'autopilot passa al prossimo capitolo.

Un rilievo respinto con motivazione non obbliga a riscrivere una buona scena. Il registro conserva il **perché** della decisione. Questo è consenso editoriale **risolto criticamente**, non l'obbligo di obbedire a qualunque commento.

## Cosa succede se i revisori non si accordano

L'autopilot può tentare fino a **tre cicli completi di remediation**. Se continuano a emergere correzioni accettate, si mette **in pausa** e indica che serve l'autore; **non inventa un'approvazione**. Nel pannello apri i resoconti, leggi le proposte accettate e respinte e scrivi la tua nuova istruzione: il vincolo verrà salvato e potrai avviare una nuova tornata dal pulsante **Riprendi**.

Il browser salva un checkpoint dopo **ogni chiamata**; un riavvio riprende dal punto successivo, non dalla prima lettura. Chiusura e sospensione del browser **non** permettono al sistema di lavorare in background.

## Riaprire un capitolo dopo averne scritti altri

Dalla stessa Dashboard, il pulsante **Rivaluta** riapre un capitolo già congelato, con conferma esplicita. L'operazione:

- disattiva autosync e cancella la vecchia coda di pubblicazione;
- toglie il congelamento al capitolo scelto **e a quelli successivi**, perché una nuova battuta o un segreto introdotto prima può cambiare il significato delle scene più avanti;
- conserva i rapporti precedenti nell'archivio e avvia un nuovo ciclo;
- richiede che ogni capitolo toccato venga nuovamente congelato prima che l'autopilot avanzi.

Le revisioni impartite da **Intervieni sull'autopilot** possono analizzare l'impatto sui capitoli precedenti e successivi. La sequenza di approvazioni non si presume più valida dopo modifiche retroattive.

## Contesti, riassunti e crediti

Ogni ruolo riceve il segmento del capitolo, una sinossi progressiva del libro, il contesto pertinente e una memoria breve **solo propria** delle osservazioni precedenti. Il libro aggiorna il proprio riassunto dopo il congelamento, invece di trascinare l'intero manoscritto in ogni chiamata. Un capitolo lungo viene spezzato in blocchi che ogni revisore leggerà, senza eliminare porzioni di prosa. Se il canone privato eccede i limiti disponibili, l'app si ferma: la compattazione automatica completa del registro segreti/entità è un lavoro successivo.

Il costo può essere **elevato**: per N segmenti di testo, ci sono almeno **12 × N** richieste di revisione, una chiamata del direttore e una o più di sinossi, oltre alle riscritture e ai nuovi giri. In **Impostazioni** puoi scegliere modelli differenti per **Specialisti capitolo**, **Cinque lettori**, **Direttore editoriale**, **Remediation mirata**, **Consolidamento** e **Riassunti**, anche per singolo libro. La Dashboard mostra i token comunicati dagli endpoint, ma **non** conosce universalmente il credito residuo e non impone ancora un budget di spesa. Verifica i crediti sul portale provider: [issue #17](https://github.com/KeyserDSoze/BookWriter/issues/17).

## Controlli storici e fattuali

Il revisore storico è utile per individuare anacronismi sospetti, ma **non consulta ancora archivi e fonti esterne**. Le sue osservazioni sono ipotesi da verificare, non certificazioni. Le verifiche con fonti reali, citazioni e valutazione della loro affidabilità sono previste come sviluppo successivo nell'[issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).

## Limiti dichiarati

I modelli possono sbagliare e un giudice può respingere una critica valida; il rapporto resta disponibile per la tua verifica. Il sistema non esegue merge semantico automatico a livello di frammenti senza approvazione, non funziona da browser chiuso, non garantisce un hard cap economico, non svolge fact-checking esterno e non ha ancora un motore completo di retrieval semantico per migliaia di entità. La capacità di blocco multi-dispositivo rimane best effort (ADR 0007).

**Riferimenti:** [ADR 0011](../ADR/0011-independent-editorial-board-and-chapter-freeze.md), [Issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20), [Issue #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
