# Osservare e controllare le richieste AI in BookWriter — #156 / #157

## Copie locali integrali della prosa canonica con consenso per libro — #167

Le copie testuali sono **disattivate per impostazione predefinita**, indipendentemente da «Ispezione locale richieste AI». Nella pagina **Attività** per il libro corrente trovi **Copie locali della prosa canonica per task (opt-in)**. Solo dopo aver premuto **Attiva copie testuali locali per questo libro**, i successivi task **completati e applicati** possono conservare due versioni del testo integrale delle scene **canoniche** (prima/dopo il commit). Le scene `draft` e `planned` non sono copiate. Non ci sono troncamenti intenzionali, ma i dati duplicati possono occupare molto spazio sul disco locale; un errore di quota non autorizza un commit narrativo con checkpoint solo parziale.

Le copie rimangono in **IndexedDB del browser**, con `bookId/activityId`, mai nei backup ZIP (nemmeno full), nella sincronizzazione GitHub, nell'outbox, nei prompt o in altri provider. **Revoca consenso ed elimina tutte le copie testuali del libro** disattiva nuove registrazioni ed elimina le precedenti copie del **solo libro selezionato** nella stessa transazione; non cancella il manoscritto, l'audit o i checkpoint strutturali. Un nuovo consenso non ricostruisce le copie cancellate e non modifica i task legacy.

Apri la **scheda di un task**, poi premi **Carica confronto della prosa canonica**: vengono mostrati il numero di scene canoniche prima/dopo e i conteggi delle scene aggiunte, rimosse o con **testo esattamente diverso**. Il testo completo non viene esposto automaticamente nella UI; il caricamento richiede ancora consenso e un clic per singolo task, con invalidazione quando cambi libro/task/consenso. Questi record sono **copie parziali del progetto**: contengono testo canonico, non tutto BookProject, non sono backup di recupero, né consentono ancora «Riparti da qui». Per il rewind vero #158 mancano ancora diff testuale editoriale, conservazione/retention controllata, fork/undo non distruttivo, protezioni writer e approvazioni/rivalidazione downstream. [ADR 0141](../ADR/0141-opt-in-canonical-prose-snapshots.md).

## Confrontare la struttura prima e dopo un task — #166

Per i nuovi task completati e applicati, BookWriter conserva **localmente** un checkpoint **strutturale** versione 1 dentro la stessa transazione IndexedDB che salva il libro, il risultato della attività e l'eventuale outbox. Questo evita di raccontare come «storico» una foto ottenuta dopo una modifica concorrente: il controllo CAS blocca una revisione stantia e i duplicati non possono sovrascrivere il checkpoint del task. Per i task falliti/interrotti e quelli precedenti a questa funzione non viene creata retroattivamente alcuna prova.

In **Attività → Apri scheda task → Carica confronto strutturale** puoi consultare le revisioni prima/dopo, il numero di capitoli prima/dopo, aggiunte/rimozioni, modifiche al freeze, scene aggiunte/rimosse e cambi di status. Il caricamento è manuale, isolato per libro/task e invalida le letture obsolete quando cambi scheda o libro.

**Limite essenziale:** il checkpoint contiene solo ID capitoli/scene, indicatori di congelamento e stati, fase e revisione. **Non** contiene testo, titoli, prosa, memoria privata, prompt, reasoning o output AI. Anche con **0 differenze strutturali**, il testo potrebbe essere cambiato radicalmente. Non è un backup, una snapshot recuperabile della prosa, un diff testuale o un pulsante di rewind. Non è incluso in ZIP o GitHub e può andare perso svuotando IndexedDB; la #158 resta aperta per snapshot canoniche complete con backup, diff, ramo/undo e consenso esplicito. [ADR 0140](../ADR/0140-atomic-task-structural-checkpoints.md).

## Valutazione preliminare prima di un rewind — #165

In **Attività → Apri scheda task** compare **Prima di ripartire: impatto potenziale (non un rewind)**. Il pannello mostra il numero dei task con orario di creazione sicuramente successivo al task selezionato, fino a cinque esempi cronologici, e segnala separatamente le attività con timestamp **identico** o **non verificabile**. Nessun filtro della vista o raggruppamento nasconde le altre attività del libro nel conteggio; vengono ignorati i task di altri libri. Se data/identità del task non è affidabile, la valutazione fallisce in modo esplicito. Anche quando non risultano successori, **non** significa che non esistano conseguenze narrative.

Il pannello mostra inoltre **solo lo stato attuale**: capitoli, capitoli congelati, scene canoniche e scene segnalate per rilettura. Non equivale alla situazione al tempo del task, non calcola un diff, non distingue capitoli effettivamente dipendenti da capitoli indipendenti e non modifica il canone. L'eventuale attività dell'autopilot richiede prima la pausa. Il bottone **Prepara revisione da questo task** continua a proporre una nuova istruzione per il libro **corrente**, soggetta al flusso esistente di autorizzazione e CAS; non torna automaticamente indietro. Le snapshot versionate pre/post, il backup, l'undo/branch, le differenze, gli strumenti editoriali e la rivalidazione downstream restano requisiti non completati della #158. [ADR 0139](../ADR/0139-rewind-readonly-impact-preflight.md).

## Scheda dedicata di un singolo task — #164

Nella pagina **Attività** scegli **Apri scheda task** su una riga. La lista lascia spazio a un solo task, con dati già registrati, risposta confermata (se presente) e pulsante per ispezionare richiesta e risposta. Il titolo della scheda mostra la posizione nella vista corrente; **Task precedente** e **Task successivo** percorrono soltanto gli elementi risultanti dalla ricerca, dai filtri e dall'ordinamento scelti, anche quando è attivo il raggruppamento per run. **Torna al registro dei task** ripristina l'elenco preservando filtri e gruppi, senza modificare l'attività.

Entrando, uscendo o cambiando task, un'eventuale ispezione IndexedDB del task precedente viene annullata logicamente: nessun prompt, reasoning o risposta privata viene trasferito alla nuova scheda. Occorre premere nuovamente **Ispeziona richiesta e risposta** con il consenso locale già abilitato per leggere una traccia disponibile. Il testo confermato nell'attività resta distinto dalla risposta in streaming provvisoria. La scheda è **sola lettura**, non è ripristino della storia, non salva un checkpoint e non invia richieste AI. Il vero rewind supervisionato rimane #158. [ADR 0138](../ADR/0138-focused-task-inspection.md).


## Raggruppare task della stessa sessione — #163

In **Attività**, oltre ai filtri, puoi scegliere **Raggruppa per sessione (run)**. I task con lo stesso `runId` appaiono vicini, preservando internamente l'ordine cronologico scelto; le sessioni sono ordinate dalla prima attività visibile. Vecchie attività senza `runId` rimangono separate. Il raggruppamento avviene **dopo** i filtri, senza modificare il libro né inviare richieste AI; viene disattivato con **Azzera filtri** o cambiando libro.

Ogni intestazione mostra quanti task appartengono alla sessione, una **stima € parziale** solo con tariffa storica valida e contatori token completi, più il numero di tentativi incerti. Senza report utilizzabili appare «non determinabile», mai un falso zero. Anche errori e interruzioni possono avere costi; non è una fattura né un totale. Si consultano solo metadati e non prompt, output, reasoning o tracce IndexedDB; per ispezionare le richieste integrali rimane necessario il consenso locale. La Dashboard mantiene gli ultimi otto task. [ADR 0137](../ADR/0137-task-run-grouping.md).


## 0. LM Studio e modelli lenti: perché 0 caratteri non significa fermo

Muse Glimmer può produrre molti token di reasoning prima di una risposta leggibile. In questo periodo il browser può mostrare 0 caratteri; allo scadere del vecchio timeout SSE di dieci minuti LM Studio può scrivere “Client disconnected”, senza che il modello fosse davvero inattivo.

**Soluzione da provare:** in Impostazioni → Endpoint, mantenendo `http://localhost:1234/v1`, seleziona **Protocollo AI per le richieste Chat → LM Studio nativo /api/v1/chat**. Il protocollo nativo è solo su hostname letterale localhost/127.0.0.1 con path /v1. Usa `stream:true`, `store:false`, nessun tool o plugin; il browser mostra i progressi realmente emessi da LM Studio, compresi model load, prompt-processing, reasoning e messaggio. Non è selezionato automaticamente in caso di errori dell'altra API e non esegue doppi POST. L'endpoint OpenAI-compatible rimane disponibile come default per altri provider.

In **Tempo massimo lettura streaming** puoi impostare 600–3600 secondi, ad esempio 1800 per una macchina con generazione lenta, indipendentemente dall'attesa degli header. Un limite più alto non migliora la velocità né garantisce testo finale. Puoi sempre premere Pausa.

**Reasoning diverso per ogni attività:** nella sezione **Router dei modelli** scegli per Brainstorming, Validazione, Scrittura, Revisioni, specialisti ecc. Eredita dall'endpoint, Automatico (omette il parametro), Low, Medium, High, Extra high. Salva le impostazioni. In **Override del libro** puoi cambiare la stessa scelta per il libro corrente, solo a generazione ferma. Priorità: override libro, poi task globale, infine endpoint. In nativo viene inviato il campo `reasoning` (solo Low/Medium/High; xhigh non supportato); nel protocollo OpenAI-compatible viene inviato `reasoning_effort`, che LM Studio può ignorare a seconda di modello e motore. “Reasoning richiesto” indica ciò che BookWriter invia, non una certificazione del provider.

Il Dashboard mostra i byte e gli eventi SSE arrivati, la fase corrente e una percentuale di analisi del prompt **solo se fornita dal provider**. Non inventa token o ragionamenti non trasmessi. Se lo stream finisce senza `chat.end`, con `tool_call` non autorizzato o senza testo finale, il canone non cambia; usa i dettagli di errore per capire perché. [ADR 0135](../ADR/0135-native-lmstudio-task-reasoning.md).


## 1. Configurare LM Studio

In **Impostazioni → Endpoint OpenAI-compatible** seleziona il server `http://localhost:1234/v1`, scegli **Nessuna autenticazione (solo localhost)** e l'ID Chat corretto, ad esempio `meta/muse-glimmer` se presente nel catalogo. Abilita CORS nel server LM Studio.

- **Streaming Chat Completions:** seleziona **Streaming SSE (provider compatibile)**. BookWriter invia `stream:true` a `POST /v1/chat/completions` e, per compatibilità, `stream_options:{include_usage:true}`. Se il modello rifiuta SSE o quest'opzione, seleziona manualmente JSON: BookWriter non ritenta da solo richieste potenzialmente addebitate.
- **Reasoning effort AI:** seleziona Automatico (omette il parametro), Low, Medium, High oppure Extra high (`xhigh`). Il parametro è `reasoning_effort` di Chat Completions e la compatibilità dipende dal modello/provider. Un modello può usarlo, ignorarlo o rifiutarlo. Non va confuso con il selettore di reasoning dell'interfaccia chat di LM Studio: quella interfaccia ha sessioni e impostazioni proprie.
- Premi **Salva impostazioni**. La versione frontend numerata resta indipendente dal commit di funzione.

In **Trasparenza e ispezione delle richieste AI**, attiva **Ispezione locale richieste AI** *prima* di avviare la generazione. Questa scelta è disattivata per default, perché i messaggi system e user possono includere testo del libro, fatti riservati, istruzioni e dati privati. Le credenziali non vengono registrate. È possibile cancellare tutte le tracce locali con il pulsante dedicato.

## 2. Vedere ciò che accade

### Vista task completa (issue #162)

Dal Dashboard premi **Apri registro completo e filtri** (oppure usa la scheda **Attività**). Puoi cercare per titolo, motivo, prossima azione, fase, modello, endpoint e run, filtrare per stato o fase, ordinare dal più vecchio al più recente, e **Azzera filtri** per tornare alla lista completa. La ricerca non esamina il testo del romanzo, le risposte AI o i prompt riservati: per questi ultimi usa **Ispeziona richiesta e risposta** dopo il consenso locale esplicito.

Ogni attività conclusa mostra la **durata rilevata** soltanto se i timestamp di avvio/fine sono disponibili e coerenti. La **stima costo task** usa esclusivamente i token input/output realmente riferiti dal provider e la tariffa inserita dall'autore **al momento della chiamata**. Se manca anche un solo elemento, compare “non determinabile”, non zero. La panoramica distingue i report con costo stimabile dai tentativi senza certezza: una richiesta fallita o interrotta può comunque avere un costo. Gli importi non sono fatture ufficiali né saldi disponibili.

Quando cambi libro, disattivi l'ispezione o selezioni un task differente mentre IndexedDB sta caricando una vecchia trascrizione, BookWriter scarta il risultato obsoleto. I messaggi system/user vengono mostrati solo nella scheda esatta del libro e del task di appartenenza. Le trace non sono incluse nei backup o nella sincronizzazione GitHub. Questa vista è in sola lettura: “Prepara revisione” non ripristina checkpoint passati (#158).


Nel **Dashboard** trovi la timeline delle attività AI e una finestra **Streaming task corrente** con fase, modello, endpoint, secondi trascorsi, stato della chiamata e caratteri ricevuti. Se è stata attivata l'ispezione, compariranno anche i frammenti di risposta in arrivo e il reasoning fornito dal provider. **Il thinking non è garantito**: alcuni provider non inviano `reasoning_content`/`reasoning` e l'assenza di delta non prova che il modello non stia elaborando. Ogni testo parziale è **provvisorio e non canonico**; solo le attività confermate sono registrate come risultati applicati.

In **Attività** ogni task ha un riquadro con obiettivo, risultato, modello/endpoint, eventuali token e pulsante **Ispeziona richiesta e risposta**. I messaggi system/user e la risposta sono disponibili soltanto per richieste future in cui l'ispezione era attiva. I limiti sono 120.000 caratteri per messaggio e per risposta, 20.000 per reasoning; un contenuto troncato viene segnalato. Le tracce sono salvate nella store IndexedDB `meta` locale e **non** entrano nei backup ZIP (nemmeno full), nel canone, in attività esportate, nell'outbox o su GitHub.

## 3. Verificare la vera chiamata localhost

Apri gli strumenti per sviluppatori **della scheda che visualizza BookWriter** (non quelli della finestra LM Studio). Nel pannello **Network**, cancella eventuali filtri testuali, seleziona **Fetch/XHR** e attiva **Preserve log**. Durante una nuova richiesta dovresti vedere `POST http://localhost:1234/v1/chat/completions`. Aprire DevTools dopo che la richiesta è partita potrebbe non recuperarla. Sullo screenshot dell'autore il campo filtro era `time` e la barra diceva `0 / 4 requests`: c'erano richieste ma il filtro le nascondeva. Se il browser è su un secondo dispositivo, il relativo `localhost` non è il PC LM Studio. In caso di CORS/Private Network Access o firewall, il browser può bloccare la rete; DevTools Console e Network mostrano l'errore specifico.

**Reasoning e stato:** Chat Completions SSE OpenAI-compatible può contenere delta testo e in alcuni provider delta `reasoning_content`. LM Studio ha anche una API nativa `/api/v1/chat` che offre eventi più ricchi (load modello e prompt processing): **non** sono eventi garantiti su `/v1/chat/completions`. Non simulare progresso prefill/token se il provider non lo espone.

## 4. Tornare a un task precedente

Dalla timeline premi **Prepara revisione da questo task**: il testo della correzione viene precompilato con il riferimento al task selezionato. L'autore può modificare la nuova istruzione, premere **Pausa** se necessario, quindi usare il flusso di revisione esistente. Le conseguenze narrative vengono analizzate dal lavoro editoriale corrente sotto gli invarianti di lock/CAS. **Non è un rollback**: nessuna snapshot storica viene ripristinata e nessun capitolo/freeze viene annullato automaticamente. Il vero rewind supervisionato con anteprima dell'impatto, tool per paragrafi/capitoli, audit e nuovo ramo è tracciato in #158 e #150.

Fonti per la compatibilità: [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat), [LM Studio REST streaming events](https://lmstudio.ai/docs/developer/rest/streaming-events), [ADR 0134](../ADR/0134-task-observability-streaming.md).
