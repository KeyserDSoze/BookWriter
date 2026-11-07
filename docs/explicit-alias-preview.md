# Confronto temporaneo di alias — v0.11.7

Nel pannello **Redazione multi-agente → Indice eventi candidati → Tracce di continuità da verificare** puoi aprire **Confronto temporaneo tra due nomi**.

Scegli **Primo nome** e **Secondo nome** fra quelli già presenti nelle attestazioni dell'autore ancora valide. Premi **Confronta temporaneamente** e conferma nel dialogo. BookWriter mostrerà eventuali **nuove tracce tra nomi diversi** con entrambe le citazioni originali, capitoli, offset e motivazioni. Queste segnalazioni sono riconoscibili dalla dicitura «Solo anteprima alias». I segnali di nome identico continuano a essere calcolati e rimangono disponibili: il preview non li cancella.

**È solo un esperimento reversibile.** I due nomi NON diventano una singola entità canonica. Non vengono cambiati segreti, conoscenze, inventari, timeline, dialoghi o eventi. L'app non indovina sinonimi, pseudonimi né omonimie: sei tu a indicare esattamente una coppia. Non ci sono collegamenti transitivi (associare A a B non significa associare B a C).

Puoi usare **Azzera confronto** per rimuovere l'ipotesi. La scelta resta esclusivamente nella scheda corrente e si perde al ricaricamento della pagina, non compare nei backup ZIP o nei commit e non viene inviata a servizi AI o GitHub. Se uno dei due nomi non ha più attestazioni attuali (capitolo riaperto, scena modificata o scelta rettificata), la coppia non può generare nuovi segnali.

Il matching usa solo parole letterali e ordine capitoli; non certifica cronologia reale, identità o causalità. Le date ISO della scena sono metadati correnti, non prove autenticate. Anche con un'anteprima attiva valgono il limite complessivo di 40 segnali e le limitazioni del rilevamento degli eventi. Per cambiare davvero il canone occorre un'altra decisione esplicita e un processo editoriale distinto.

Consulta [ADR 0040](../ADR/0040-explicit-transient-alias-preview.md), [tracce v0.11.6](attested-continuity-signals.md), [registro v0.11.5](narrative-event-ledger.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
