# Registro delle differenze editoriali per capitolo — v0.11.29

Quando una storia attraversa più revisioni, BookWriter conserva i giudizi precedenti. Ora puoi vedere un **registro cronologico** di come si sono ripresentati (o non si sono ripresentati) i **controlli letterali irrisolti**, senza dover aprire singolarmente ogni tornata.

## Dove trovarlo

Apri **Redazione multi-agente → Stato dei capitoli → Registro delle differenze editoriali** nel capitolo che vuoi esaminare. La vista compare se sono presenti vecchi controlli con prove insufficienti o gruppi di proposte correnti. Funziona anche per capitoli **già congelati**, senza riaprirli.

La scheda mostra le singole *serie di citazioni*, e dentro ciascuna puoi leggere nell'ordine registrato:
- l'archivio originale e la tornata, anche quando il numero si è ripetuto;
- le tornate precedenti del ciclo attuale;
- la revisione corrente, se il capitolo è aperto e ha nuovi gruppi rilevati.

Per ogni occorrenza sono visibili la provenienza delle prove, la posizione nella scena, la prova mancante dichiarata dal giudice e il **controllo suggerito, non eseguito**. Se la formulazione cambia, il registro lo segnala. Se la stessa citazione compare più volte in una singola tornata, il rapporto è marcato **ambiguo**.

## Come leggere il risultato

**“Citazione e posizione coincidono”** significa soltanto che le coordinate letterali riportate dai revisori sono le stesse; non che abbiano identificato lo stesso errore narrativo. **“Posizione differente”** è una pista di confronto, non una prova di continuità. **“Non osservata nei gruppi nuovi esaminati (non risolta)”** significa soltanto che il campione esaminato non conteneva quel gruppo; non autorizza a chiuderlo o considerarlo corretto.

Il nuovo giudizio viene riportato solo se supera i controlli di validazione correnti. Se è vecchio, alterato o manca, non vengono mostrate conclusioni di approvazione. Tutti i vecchi controlli senza fonte coerente rimangono separati e chiaramente non confrontabili.

## Copertura, privacy e sicurezza

Il registro osserva al massimo **240 occorrenze recenti**, mostra **12 serie** e le ultime **8 osservazioni per serie**, con contatori di quelle non mostrate. La redazione continua a campionare massimo sei gruppi di dodici finding, segnalando gruppi omessi o troppo grandi.

Il registro non legge né copia le **annotazioni private dell'autore**: quelle restano nelle apposite viste, senza essere trasferite alle nuove revisioni. Non avvia ricerche, chiamate AI, edit, repair, freeze o sincronizzazioni; non modifica file ZIP o database. La lettura è locale e consultiva, anche per libri importati.

Riferimenti: [ADR 0061](../ADR/0061-editorial-diff-ledger.md), [confronto archivio/nuova revisione](editorial-archive-revision-comparison.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).

## Filtri consultivi v0.11.29

Nel registro puoi selezionare **Tutte le serie**, **Corrispondenze ambigue**, **Citazioni spostate**, **Controlli riformulati**, **Non osservate nella revisione corrente** oppure **Fonti o giudizi non convalidati**. La selezione non salva nulla e non avvia agenti o interventi.

Il filtro agisce su **tutte le serie candidate ricostruite dalle 240 osservazioni più recenti**, prima di applicare il limite di visualizzazione delle 12 serie: puoi quindi ritrovare una citazione ambigua più vecchia delle 12 mostrate inizialmente. Le condizioni sono calcolate **prima** di ridurre a otto le osservazioni visibili per serie. Non è una ricerca nello storico completo: le osservazioni fuori dalla finestra di 240 rimangono escluse.

I contatori distinguono serie complessive nel campione, corrispondenze del filtro, serie escluse solo dal filtro e serie corrispondenti non mostrate oltre 12. Un filtro vuoto non significa che la storia sia corretta: può mancare una nuova revisione, una prova valida o copertura sufficiente. «Non osservate» è disponibile solo quando c'è un ciclo editoriale corrente del medesimo capitolo; su capitoli congelati non si deduce alcuna assenza. «Non convalidati» indica limiti delle fonti o del giudizio, non che il giudice abbia respinto o accettato un rilievo.

Le note private dell'autore, le scelte sui suggerimenti e gli stati di repair rimangono separati; nessuna modifica a ZIP, IndexedDB, GitHub Sync, prompt, canone o freeze. Vedi [ADR 0062](../ADR/0062-editorial-ledger-focus-filters.md) e issue #20.
