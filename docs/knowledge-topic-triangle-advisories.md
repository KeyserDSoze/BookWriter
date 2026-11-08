# Avvisi sulle interpretazioni di tre conoscenze — v0.11.18 (in sviluppo)

Nella sezione **Indice eventi candidati → Conoscenze interpretate dall'autore → Collegare informazioni fra personaggi**, dopo aver dichiarato almeno tre collegamenti, può apparire **«possibili incoerenze fra tre relazioni esplicite»**.

## Quando compare

Immagina che l'autore abbia confermato **tre decisioni indipendenti**:

- **Mara–Elio:** stessa informazione.
- **Elio–Nina:** stessa informazione.
- **Mara–Nina:** informazioni differenti.

BookWriter mostra le **tre citazioni originali** perché l'insieme merita una rilettura. Il sistema non aggiunge automaticamente Mara–Nina se mancano le sue decisioni; la sola presenza delle prime due coppie **non produce avvisi**.

Apri l'avviso e confronta le menzioni. Se ritieni una decisione non corretta, seleziona di nuovo quella coppia nel modulo superiore e salvala con una motivazione. Il nuovo atto dell'autore prevale, lo storico rimane intatto e l'avviso scompare se la terna non è più in quella configurazione.

Se una scena viene riaperta, modificata o non è più congelata, i collegamenti con la sua fonte non sono più correnti e cessano di contribuire all'avviso. Sono mostrati al massimo **12** casi alla volta, con il conteggio degli altri.

## Che cosa NON significa

Il controllo **non** dimostra una contraddizione del romanzo. Personaggi e narratori possono mentire o sapere cose parziali; gli stessi termini possono indicare informazioni differenti. Non presume cronologia della storia, passaggi di notizie, identità/alias dei personaggi o verità di una notizia, e non aggiorna il canone.

L'analisi avviene **solo in locale**, senza nuove chiamate HTTP o AI, salvataggi, blocchi di generazione o invio di nuovi dati ai revisori. Il risultato è effimero, non entra nei backup; le decisioni sottostanti possono invece comparire negli ZIP o nei push GitHub **manuali**, con possibili spoiler.

Vedi [relazioni a coppie](knowledge-topic-links.md), [ADR 0051](../ADR/0051-knowledge-topic-triangle-advisories.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
