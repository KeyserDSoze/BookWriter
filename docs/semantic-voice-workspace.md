# Lettura vocale e ricerca semantica del manoscritto — #148 / #149

BookWriter usa i modelli configurati per aiutare il lavoro editoriale, senza trasformare una semplice etichetta in un'asserzione di compatibilità. Queste prime funzioni sono nella pagina **Libro**, sopra il testo delle scene.

## Ascolta il manoscritto

Premi **Ascolta scena** dopo aver scelto una scena canonica. Puoi selezionare una voce disponibile nel browser/sistema operativo e una velocità di lettura; pausa, riprendi e ferma interrompono o controllano la riproduzione. Il lettore percorre **l'intera scena canonica** senza fermarsi ai primi 5.000 caratteri. Suddivide il testo in blocchi di massimo 700 codepoint Unicode, preferendo pause naturali su frase/parola, e indica il blocco corrente. Play, pausa, riprendi, ferma, cambio scena/voce/libro e modifica del manoscritto interrompono in sicurezza la coda precedente. Una scena eccezionalmente lunga (oltre 280.000 codepoint) è rifiutata con messaggio anziché troncata: puoi dividerla in scene più brevi. Le bozze non sono ascoltate.

Il pannello usa la **Web Speech API del browser**, non il modello `voice` selezionato nelle impostazioni. La compatibilità OpenAI documentata di **LM Studio non include un endpoint TTS `/v1/audio/speech`**, quindi non sarebbe corretto affermare che `phonon-40m-multilingual` venga richiamato per l'audio. La scelta del modello Voce resta disponibile per un adapter dedicato successivo nella [issue #149](https://github.com/KeyserDSoze/BookWriter/issues/149). La sintesi vocale del browser può utilizzare voci online del sistema, dipende dalla piattaforma e non è garantita offline; BookWriter **non** invia autonomamente il testo a un provider esterno durante questa modalità.

**Lingua:** per una scena in italiano, scegli se disponibile una voce di sistema `it-IT`; la voce predefinita usa `it-IT`. Il modello Phonon 40M multilingual pubblicato da Gradium supporta ufficialmente inglese, francese, tedesco, spagnolo e portoghese, non l'italiano; è quindi importante non associarlo automaticamente a una lettura italiana. È necessario verificare disponibilità e condizioni di licenza per il proprio uso.

## Ricerca semantica con il modello Embedding

1. In **Impostazioni → Ruoli dei modelli AI**, assegna il tag **Embedding** al modello che in LM Studio supporta davvero l'endpoint embedding e sceglilo in **Predefinito Embedding**. Salva.
2. Apri un libro che contenga scene **canoniche**. In **Libro → Ricerca semantica**, premi **Indicizza scene su localhost**. È un consenso esplicito al passaggio di estratti delle scene al **server loopback**.
3. Quando viene mostrato *Indicizzate N scene*, scrivi una domanda in linguaggio naturale (es. «Quale scena anticipa il tradimento del protagonista?») e premi **Cerca scene simili**.
4. I risultati riportano capitolo, scena, estratto e punteggio coseno (solo ranking, non probabilità di verità). **Vai alla scena** scorre alla scena nel lettore.

L'API usata è `POST http://localhost:1234/v1/embeddings` con il modello scelto; se il server o il modello non lo supporta, si visualizza un errore senza retry automatico. La risposta del provider deve rispettare i vincoli di validazione e di memoria. Per la famiglia `nomic-embed-text` vengono aggiunti i prefissi consigliati `search_document:` per estratti e `search_query:` per query, richiesti da Nomic Embed Text v1.5.

### Continuità narrativa: trova scene collegate

Dopo **Indicizza scene su localhost**, scegli un capitolo e una **Scena di riferimento** in **Continuità narrativa: scene collegate** e premi **Trova scene collegate**. La funzione confronta i passaggi indicizzati della scena con i passaggi delle altre scene canoniche, esclude la scena stessa e mostra fino a cinque correlazioni con l'estratto più pertinente, capitolo e comando **Vai alla scena**. **Non invia ulteriori richieste** a LM Studio; riusa i vettori già presenti nella RAM del browser. Non è una verifica automatica delle contraddizioni: una forte similitudine può riflettere ripetizioni, un tema comune o un evento da controllare manualmente. Se la selezione contiene una sola scena non esistono altre scene da proporre; modifica del libro o del modello richiede una nuova indicizzazione.

### Limiti, privacy e coerenza

- Soltanto hostname letterali **localhost** o **127.0.0.1**; anche con API key non viene inviata prosa a un endpoint remoto da questa funzione. CORS è necessario in LM Studio.
- Al massimo **80 scene canoniche** in ordine del libro, con **fino a tre passaggi da 1.400 caratteri** ciascuno: fino a **240 embedding** su localhost, a gruppi seriali di otto. Per scene brevi l'intero testo è coperto; per scene lunghe si campionano inizio, centro e finale, senza duplicare la prosa nei campioni. L'interfaccia mostra quanti passaggi saranno inviati e quanti caratteri restano fuori dall'indice. I risultati riportano il passaggio con la similarità migliore, che può trovarsi nel finale. Non usare una ricerca senza risultati per affermare che un dettaglio non esista nel libro: i segmenti non coperti non sono stati indicizzati. Nessuna indicizzazione o invio avviene prima di un clic esplicito.
- Sono esclusi scene in bozza, segreti editoriali e campi di memoria privata. Questa funzionalità non legge né modifica direttamente il canone, non cambia l'autopilot e non esegue retrieval automatico per i prompt AI.
- Vettori e risultati rimangono **solo in memoria volatile della pagina**: non vengono salvati in IndexedDB, ZIP o GitHub. Un cambio libro, aggiornamento del manoscritto o uscita dalla pagina richiede reindicizzazione. La query viene inviata a localhost solo quando l'autore avvia la ricerca.
- La lettura di voci del browser e le richieste embeddings sono flussi separati: i tag da soli non attestano compatibilità di modello, API, lingua, licenza o qualità dei risultati.
- I costi di provider, se il server locale è una proxy che inoltra richieste, non sono automaticamente registrati nel ledger AI. Usare endpoint locali fidati e limitati a loopback.

Fonti: [LM Studio API OpenAI-compatible](https://lmstudio.ai/docs/developer/openai-compat), [Nomic Embed Text v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), [Phonon multilingual](https://huggingface.co/gradium/phonon-40m-multilingual), [ADR 0129](../ADR/0129-opt-in-editorial-voice-semantic-workspace.md).

## Versione

La release **0.11.90** include lettura integrale **tramite browser**, retrieval `/embeddings` su localhost e confronto delle scene canoniche già indicizzate. Il modello Voce selezionato non viene ancora chiamato per TTS/STT; provider reale da verificare separatamente.
