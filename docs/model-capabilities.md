# Catalogo e ruoli dei modelli AI — issue #147

In BookWriter, **Impostazioni → Endpoint OpenAI-compatible → Leggi /models** rileva gli identificatori pubblicati dal provider. Questa lista **non dichiara quali funzioni i modelli possano eseguire**. In **Ruoli dei modelli AI** puoi cercare un modello e aggiungere più etichette dichiarate manualmente.

## Etichette per modello

- **Chat / scrittura**: modello usato per generazione di idee, pianificazione, scene, redazione e revisione via `POST /chat/completions`. Il pulsante **Usa come predefinito Chat** aggiorna il router globale già esistente; il router può comunque definire override per task o libro.
- **Tool calling**: indicazione che l'autore considera il modello predisposto a chiamare strumenti. Può coesistere con il tag Chat, **ma non abilita** nuove chiamate a strumenti: l'autopilot non effettua ancora un ciclo tool-calling strutturato per questo tag.
- **Embedding**: indica un modello preparato a trasformare testi in vettori, futuro supporto alla ricerca semantica. Il predefinito Embedding è conservato come impostazione, **ma BookWriter non chiama ancora** un'API `/embeddings` tramite questo campo.
- **Voce**: indica un modello audio/voce selezionato dall'autore. Il predefinito Voce viene conservato, **ma non abilita** generazione o trascrizione audio (l'API esatta varia tra server e modelli).

Un modello può avere tag multipli, per esempio Chat + Tool calling. Nomi o prefissi come `phonon-`, `meta/` o `text-embedding-` **non** vengono usati per attribuire tag automaticamente.

## Predefiniti

Il predefinito **Chat / scrittura** si può scegliere da **Seleziona modello Chat dal catalogo** oppure inserire manualmente nella casella **Modello predefinito** (che resta un campo testo accessibile). Continua a usare `AppSettings.defaultRoute` e gli override `taskRoutes` o del singolo libro; il pulsante per il Chat lo aggiorna senza modificare gli altri ruoli. I tre selettori separati **Tool calling**, **Embedding** e **Voce** accettano solo modelli manualmente etichettati con quel ruolo, anche su endpoint differenti. Sono selezioni per integrazioni future: non avviano chiamate al provider.

Se un modello possiede tag espliciti ma **non** il tag Chat, BookWriter interrompe una richiesta Chat Completions indirizzata a quel modello **prima di inviare il prompt**. Un modello legacy senza tag mantiene il comportamento precedente. Rimuovere il tag da un modello predefinito annulla la scelta di quel ruolo senza riscrivere altri predefiniti.

## Funzioni editoriali effettive (prime integrazioni)

Dalla pagina **Libro** è disponibile la [lettura a voce di scene canoniche e la ricerca semantica locale](semantic-voice-workspace.md). La seconda usa davvero l'API `POST /embeddings` di LM Studio sul loopback e richiede il predefinito embedding; la prima sfrutta Web Speech API e **non** richiama il modello vocale configurato. L'uso di un modello per la sintesi audio resta una integrazione distinta.

## Persistenza, backup e sicurezza

Le configurazioni e i tag sono persistiti localmente in IndexedDB mediante **Salva impostazioni**, con la stessa protezione da salvataggi obsoleti. Il backup ZIP **full** include etichette e predefiniti, ma lo ZIP **content** non include impostazioni/chiavi; gli archivi legacy senza i nuovi campi restano validi. Import ZIP full con tag malformati o predefiniti incoerenti fallisce chiuso. Un inventario aggiornato `/models` non cambia automaticamente i tag dichiarati e non deve sovrascrivere modifiche recenti durante la chiamata.

Il browser continua a richiedere CORS dal server; le API effettivamente disponibili dipendono da provider e modello. Test UI e unitari non certificano automaticamente compatibilità semantica o endpoint audio/vettoriali reali.

Riferimenti: [issue #147](https://github.com/KeyserDSoze/BookWriter/issues/147), [ADR 0128](../ADR/0128-model-capability-tags.md), [endpoint locali](ai-local-endpoints.md) e [catalogo /models](ai-model-inventory.md).
