# Prove narrative verificabili — BookWriter v0.10.9

## Che cosa cambia

Quando i dodici agenti controllano un capitolo, ogni nuovo rilievo deve riferirsi **a una citazione letterale di almeno dodici caratteri presente nel segmento di scena che l'agente ha effettivamente ricevuto**. BookWriter confronta il testo della prova con il manoscritto e rifiuta un rapporto se contiene una citazione non presente o inventata. Non sono accettate parafrasi, sequenze di parole riordinate o punti di sospensione fittizi. Sono ammesse differenze di maiuscole e di a capo/spazi.

La modifica vale per continuità, segreti, timeline, storia, voce, stile, struttura e i cinque lettori indipendenti. Il controllo di provenienza del testo narrativo è diverso dalla verifica delle **fonti storiche**: una frase presente nel romanzo non prova che l'affermazione sia corretta.

## Come leggere la sezione redazione

- **Citazione letterale nel segmento** significa che BookWriter ha trovato esattamente quel passaggio nella porzione letta dal revisore. Mostra numero del segmento, offset nel segmento, testo effettivamente presente e breve contesto. Se la stessa frase compare più volte, il conteggio è visibile e viene mostrata la prima occorrenza.
- **Report precedente senza ancoraggio** significa che il finding è stato archiviato prima di questa versione, o che manca un ancoraggio valido. Il testo resta consultabile per audit ma **non può autorizzare automaticamente una nuova riscrittura**: occorre un nuovo controllo.
- **Respinto dal direttore** non significa che l'agente non ha trovato la frase. Significa che il direttore, pur riconoscendone la presenza, giudica infondata o fuori contesto la proposta di correzione. Ogni decisione conserva la motivazione e la remediation proposta.

Se un agente tenta di citare parole mai lette o presunte omissioni senza indicare un passaggio reale, la redazione rifiuta il report invece di archiviarlo come accertamento. L'autopilot rimane nel proprio flusso di retry/pausa; non inventa una prova e non passa in automatico alla fase successiva.

## Limiti

Il controllo è **testuale e locale**: non determina se la critica abbia senso, non verifica fonti esterne, non risolve automaticamente contraddizioni semantiche o la psicologia di un personaggio. L'assenza di una frase non si dimostra con una citazione breve, perciò per casi complessi è necessario controllo umano. L'ancoraggio è relativo al segmento originale e viene riverificato prima di approvare una nuova correzione.

Riferimenti: [ADR 0032](../ADR/0032-literal-narrative-evidence-gate.md), [redazione a 12 agenti](editorial-board.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
