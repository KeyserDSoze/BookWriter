# ADR 0133 — Campionamento multi-passaggio controllato per scene lunghe

- Stato: accettato
- Data: 2026-11-12
- Issue: #154, estende #148 / #153
- Ambito: `semantic-search.ts`, `SemanticSearchPanel.tsx`, ricerca embedding locale

## Contesto

Il MVP #148 indicizzava i soli primi 1.400 caratteri per ciascuna scena canonica. L'inizio non rappresenta necessariamente un evento o un'informazione introdotti nel centro/finale; perciò la ricerca per query e il confronto di continuità possono produrre falsi negativi anche quando LM Studio funziona correttamente.

## Decisione

1. L'azione di indicizzazione resta **esplicita e per libro**. La funzione pura `sampleSemanticPassages` riceve il solo `scene.text` canonico e restituisce al massimo tre passaggi di massimo 1.400 **code unit UTF-16** ciascuno, evitando di interrompere coppie surrogate. Scene brevi vengono coperte integralmente con segmenti contigui. Quelle oltre il limite, o nei casi limite Unicode, includono porzioni di incipit, centro e conclusione. La parte saltata è conteggiata e dichiarata: non inferire assenza di temi o fatti dalle lacune.
2. Massimo 80 scene e **240** vettori in RAM per indicizzazione, `embedTextBatch` conserva lotti da max 8, POST seriali e solo hostname loopback letterali. Per i modelli Nomic restano i prefissi document/query e il limite di input 1.600; nessuna chiamata automatica, retry, batch remoto o nuova trasmissione di bozze, memoria privata e segreti.
3. La UI mostra scena e conteggio passaggi, progressione per passaggi, frammento corrispondente e posizione del match. `rankSemanticPassages` raggruppa i risultati del matching coseno prendendo il **massimo** per scena, non la somma né una media. `relatedSemanticPassages` compara tutte le coppie di passaggi fra la scena scelta e le altre **dallo stesso indice RAM**, senza altre richieste di embedding. La similarità non è un giudizio sulla continuità narrativa né una probabilità di verità.
4. Prima di usare l'indice validare count di scene/passaggi e vettori, dimensioni coerenti, numeri finiti e norma positiva. Una risposta incompleta non viene consolidata. Abort o cambio libro/revisione/endpoint invalida richieste e stato; il fencing impedisce reset tardivi di nuove operazioni.
5. Invariati: backup ZIP, dati canonici, IndexedDB, GitHub, Activity, budget autopilot, sessioni e adapter TTS. Le query utente continuano a generare un unico embedding per ricerca. Valutare in #148 ulteriore copertura incrementale o un indice persistente con consenso; non introdurli in questo intervento.

## Verifiche

Vitest: copertura breve/lunga, Unicode, limite, privacy, ranking del finale, confronto zero-fetch e vettori malformati. Playwright desktop/mobile mock: un elemento introdotto nel finale di una scena lunga deve essere trovato e il confronto non deve inviare POST aggiuntive. Chiusura #154 subordinata a Frontend CI tutti sei job, Pages e cleanup **completed/success sulla stessa HEAD**; i mock non sono prova del modello fisico sul PC dell'autore.
