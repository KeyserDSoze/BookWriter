# Osservare e controllare le richieste AI in BookWriter — #156 / #157

## 1. Configurare LM Studio

In **Impostazioni → Endpoint OpenAI-compatible** seleziona il server `http://localhost:1234/v1`, scegli **Nessuna autenticazione (solo localhost)** e l'ID Chat corretto, ad esempio `meta/muse-glimmer` se presente nel catalogo. Abilita CORS nel server LM Studio.

- **Streaming Chat Completions:** seleziona **Streaming SSE (provider compatibile)**. BookWriter invia `stream:true` a `POST /v1/chat/completions` e, per compatibilità, `stream_options:{include_usage:true}`. Se il modello rifiuta SSE o quest'opzione, seleziona manualmente JSON: BookWriter non ritenta da solo richieste potenzialmente addebitate.
- **Reasoning effort AI:** seleziona Automatico (omette il parametro), Low, Medium, High oppure Extra high (`xhigh`). Il parametro è `reasoning_effort` di Chat Completions e la compatibilità dipende dal modello/provider. Un modello può usarlo, ignorarlo o rifiutarlo. Non va confuso con il selettore di reasoning dell'interfaccia chat di LM Studio: quella interfaccia ha sessioni e impostazioni proprie.
- Premi **Salva impostazioni**. La versione frontend numerata resta indipendente dal commit di funzione.

In **Trasparenza e ispezione delle richieste AI**, attiva **Ispezione locale richieste AI** *prima* di avviare la generazione. Questa scelta è disattivata per default, perché i messaggi system e user possono includere testo del libro, fatti riservati, istruzioni e dati privati. Le credenziali non vengono registrate. È possibile cancellare tutte le tracce locali con il pulsante dedicato.

## 2. Vedere ciò che accade

Nel **Dashboard** trovi la timeline delle attività AI e una finestra **Streaming task corrente** con fase, modello, endpoint, secondi trascorsi, stato della chiamata e caratteri ricevuti. Se è stata attivata l'ispezione, compariranno anche i frammenti di risposta in arrivo e il reasoning fornito dal provider. **Il thinking non è garantito**: alcuni provider non inviano `reasoning_content`/`reasoning` e l'assenza di delta non prova che il modello non stia elaborando. Ogni testo parziale è **provvisorio e non canonico**; solo le attività confermate sono registrate come risultati applicati.

In **Attività** ogni task ha un riquadro con obiettivo, risultato, modello/endpoint, eventuali token e pulsante **Ispeziona richiesta e risposta**. I messaggi system/user e la risposta sono disponibili soltanto per richieste future in cui l'ispezione era attiva. I limiti sono 120.000 caratteri per messaggio e per risposta, 20.000 per reasoning; un contenuto troncato viene segnalato. Le tracce sono salvate nella store IndexedDB `meta` locale e **non** entrano nei backup ZIP (nemmeno full), nel canone, in attività esportate, nell'outbox o su GitHub.

## 3. Verificare la vera chiamata localhost

Apri gli strumenti per sviluppatori **della scheda che visualizza BookWriter** (non quelli della finestra LM Studio). Nel pannello **Network**, cancella eventuali filtri testuali, seleziona **Fetch/XHR** e attiva **Preserve log**. Durante una nuova richiesta dovresti vedere `POST http://localhost:1234/v1/chat/completions`. Aprire DevTools dopo che la richiesta è partita potrebbe non recuperarla. Sullo screenshot dell'autore il campo filtro era `time` e la barra diceva `0 / 4 requests`: c'erano richieste ma il filtro le nascondeva. Se il browser è su un secondo dispositivo, il relativo `localhost` non è il PC LM Studio. In caso di CORS/Private Network Access o firewall, il browser può bloccare la rete; DevTools Console e Network mostrano l'errore specifico.

**Reasoning e stato:** Chat Completions SSE OpenAI-compatible può contenere delta testo e in alcuni provider delta `reasoning_content`. LM Studio ha anche una API nativa `/api/v1/chat` che offre eventi più ricchi (load modello e prompt processing): **non** sono eventi garantiti su `/v1/chat/completions`. Non simulare progresso prefill/token se il provider non lo espone.

## 4. Tornare a un task precedente

Dalla timeline premi **Prepara revisione da questo task**: il testo della correzione viene precompilato con il riferimento al task selezionato. L'autore può modificare la nuova istruzione, premere **Pausa** se necessario, quindi usare il flusso di revisione esistente. Le conseguenze narrative vengono analizzate dal lavoro editoriale corrente sotto gli invarianti di lock/CAS. **Non è un rollback**: nessuna snapshot storica viene ripristinata e nessun capitolo/freeze viene annullato automaticamente. Il vero rewind supervisionato con anteprima dell'impatto, tool per paragrafi/capitoli, audit e nuovo ramo è tracciato in #158 e #150.

Fonti per la compatibilità: [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat), [LM Studio REST streaming events](https://lmstudio.ai/docs/developer/rest/streaming-events), [ADR 0134](../ADR/0134-task-observability-streaming.md).
