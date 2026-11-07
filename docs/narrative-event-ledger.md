# Registro delle attestazioni e navigazione delle menzioni — v0.11.5

Nella **Redazione multi-agente → Indice eventi candidati**, i pulsanti **Pagina precedente** e **Pagina successiva** consentono di consultare tutte le menzioni già individuate (30 per pagina, fino a 80). Lo scanner resta incompleto: altre frasi possono non essere rilevate.

Apri **Registro attestazioni correnti** per leggere soltanto le decisioni **«Annota come avvenuto»** ancora corrispondenti allo stesso testo canonico e congelamento, senza successive rettifiche. Ogni riga mostra soggetto, capitolo/scena, citazione, offset e motivazione. Le menzioni respinte correnti e quelle storiche/non correnti sono contate separatamente, non promosse a fatti.

## Confronto tra capitoli

Quando un nome letteralmente identico appare in attestazioni correnti di capitoli diversi, la vista lo raggruppa come **tracce da confrontare manualmente**. Non dimostra una contraddizione, non risolve alias o omonimie e non deduce cosa un personaggio sappia o possieda, né date o cause implicite.

Il registro è ricalcolato localmente da tutte le decisioni del libro (fino a 400), non soltanto dalle prime 80 menzioni scoperte: una attestazione valida oltre il limite consultivo non viene persa. Riaperture, cambiamenti della scena o rettifiche impediscono la riattivazione automatica. Per intervenire sulla storia serve il processo editoriale con l'autore.

**Privacy e limiti:** nessun nuovo dato inviato all'AI, al giudice, ai lettori ciechi o a servizi remoti. Nessuna nuova sincronizzazione o modifica automatica di canone, segreti, timeline o inventari. Un backup ZIP non autentica il dichiarante e il checksum rapido non certifica identità/integrità. Vedi [ADR 0038](../ADR/0038-derived-author-event-ledger.md), [guida decisioni](narrative-event-decisions.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
