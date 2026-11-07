# Annotazioni dell'autore sugli eventi — v0.11.4

Nella **Redazione multi-agente → Indice eventi candidati** puoi scegliere una frase letterale di un capitolo congelato, scrivere una motivazione da 12 a 500 caratteri e selezionare **Annota come avvenuto** oppure **Respingi menzione**. L'app chiede conferma prima del salvataggio. Una successiva rettifica **non sovrascrive** quella precedente: tutte le decisioni restano consultabili nello storico, con data, scena, citazione e motivazione.

**Non è una modifica al canone.** «Annota come avvenuto» significa soltanto che hai espresso una tua interpretazione di una frase; non modifica automaticamente memorie, chi conosce un segreto, possesso di oggetti, timeline o prosa del romanzo, e non certifica una fonte storica. Le decisioni non diventano parte dei prompt dei revisori o del giudice. Per correggere la storia occorre una revisione editoriale distinta.

## Scena modificata o capitolo riaperto

Le annotazioni valgono come *correnti* soltanto per lo stesso congelamento e testo della scena da cui derivano. Se il testo cambia o il capitolo viene riaperto, il record rimane nello storico come **non corrente**. La nuova versione della scena richiede una decisione esplicita nuova: la vecchia conferma non si applica da sola. L'app confronta citazione/offset e un checksum locale per accorgersi dei cambiamenti; non è una firma digitale né prova chi abbia scritto il record, soprattutto dopo import ZIP.

## Salvataggio e sicurezza

- Il salvataggio usa IndexedDB, Web Locks e controllo contro scritture concorrenti; viene registrata un'attività. Niente nuove richieste a modelli o servizi di ricerca.
- L'autosync GitHub viene **disabilitato** e l'outbox cancellata; eventuali annotazioni e modifiche locali vanno sincronizzate manualmente dopo controllo. Il dialogo di conferma avverte prima.
- Le annotazioni fanno parte dei backup ZIP e dello snapshot JSON del libro sincronizzabile su GitHub: non includono token o chiavi, ma riportano citazioni tratte dalla prosa. Usa repository private per lavori inediti.
- Al massimo 400 decisioni per libro; vengono mostrate 30 menzioni alla volta. I record importati sono **dichiarazioni nel file**, non attestazioni autenticate.

Vedi [ADR 0037](../ADR/0037-author-event-annotations.md), [indice v0.11.3](narrative-event-candidates.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
