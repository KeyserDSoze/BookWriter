# Quando un personaggio apprende una notizia — v0.11.16

BookWriter permette ora all'autore di annotare **quando** un personaggio conosce una notizia rispetto alla scena che la menziona. Questo è diverso da **dove** la scena compare nel romanzo: un capitolo successivo può raccontare un flashback, un sogno o un avvenimento antecedente.

## Uso del registro

Nel libro apri **Indice eventi candidati → Conoscenze interpretate dall'autore → Quando i personaggi sanno?**. Prima devi avere un evento di `knowledge_mention` confermato su una scena canonica congelata e una classificazione corrente della conoscenza (appresa direttamente, riferita da altri o ancora segreta).

Per la conoscenza selezionata scegli:

- **Momento d'accesso:** appresa in questa scena, già nota prima della scena, non ancora conosciuta o non determinabile.
- **Ordine narrativo:** cronologia lineare dichiarata dall'autore, flashback/ordine riorganizzato oppure non determinato.
- **Motivazione:** spiega la tua interpretazione (20–650 caratteri); la motivazione è privata e non viene inviata all'AI.

Se avevi indicato che la notizia è **ancora segreta**, puoi segnare soltanto **non ancora nota** o **momento incerto**. Una decisione incompatibile viene rifiutata. Puoi sempre rettificare la decisione: lo storico conserva le versioni precedenti.

## Confrontare i personaggi

La vista mostra le interpretazioni correnti raggruppate **per nome letterale del personaggio**. Ogni riga cita il capitolo, la scena, il testo di partenza, il momento d'accesso e la qualificazione dell'ordine narrativo. Il confronto non significa che due personaggi parlino della **stessa** informazione, né che una notizia sia stata trasmessa da uno all'altro. L'ordine di visualizzazione è quello del **manoscritto**, non una timeline fiction verificata.

Se la scena viene modificata o riaperta, una decisione viene rettificata o la fonte viene nuovamente attestata, le annotazioni obsolete diventano **storiche** e non vengono trasferite automaticamente. Il sistema non crea un grafo causale o delle conoscenze, non modifica il canone e non conclude che un personaggio debba sapere qualcosa solo perché una frase compare in un capitolo precedente.

## Privacy, salvataggio e backup

I nuovi dati temporali rimangono **esclusi dai prompt AI**, anche quando avevi già autorizzato un revisore o il giudice a vedere la classificazione della conoscenza della v0.11.15. Un eventuale utilizzo di questi tempi nei prompt richiederà un nuovo consenso esplicito. Il salvataggio è locale, usa i lock e la verifica revisionale del libro, disabilita l'autosync GitHub e non avvia chiamate AI.

I backup ZIP conservano il registro e lo storico, con schema rigoroso per le nuove voci. Un backup importato non autentica l'autore. **Un export ZIP o un push GitHub manuale può comunque diffondere note private e spoiler**: controlla la destinazione.

Riferimenti: [ADR 0049](../ADR/0049-author-knowledge-temporal-anchors.md), [registro conoscenze](author-knowledge-registry.md), [consensi per ruolo](knowledge-sharing-consent.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).

## Confrontare due personaggi dalla v0.11.17

Il pannello [Collegare informazioni fra personaggi](knowledge-topic-links.md) consente all'autore di associare esplicitamente due decisioni knowledge correnti di personaggi diversi come **stessa** oppure **diversa** informazione. Se presenti, le due etichette temporali vengono mostrate affiancate, ma l'ordine del manoscritto non dimostra l'ordine degli eventi e un collegamento non prova una trasmissione. I legami restano privati ai modelli AI.
