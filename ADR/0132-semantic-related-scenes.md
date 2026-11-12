# ADR 0132 — Continuità narrativa: scene semanticamente correlate da indice locale

- Stato: accettato
- Data: 2026-11-12
- Issue: #153; riferimenti #148 (embedding), #5 (continuità), #6 (qualità)
- Ambito: sola lettura nel pannello Libro → Ricerca semantica

## Contesto

L'indice delle scene canoniche viene già calcolato in modo esplicito sul server embedding loopback e resta volatile nel browser. Cercare concetti con una query richiede un'altra chiamata `/embeddings`, ma confrontare due scene già indicizzate **non** ne richiede altre. Un lettore può aver bisogno di ritrovare passaggi narrativamente vicini per confrontare luoghi, personaggi e ricorrenze, senza automatizzare giudizi.

## Decisione

1. Consentire all'autore di selezionare una `Scena di riferimento` fra le scene canoniche dell'indice già presente, poi premere `Trova scene collegate`. Disabilitare se l'indice manca/è stantio, se c'è una sola scena o durante una richiesta pendente. Non avviare `embedTextBatch` né altra POST per questa azione.
2. L'algoritmo `relatedSemanticScenes` legge i vettori in RAM già ottenuti, scarta il riferimento, convalida indice, identificatore, dimensioni e norma non nulla, ordina il resto per cosine similarity e restituisce fino a cinque passaggi. Non attribuire al risultato valori di probabilità, evidenza o certezza editoriale.
3. Mostrare soltanto estratti di scene canoniche e navigazione alla scena. Conservare la separazione dei risultati tra domanda libera (nuovo embedding della query, già autorizzato) e confronto fra scene (nessuna richiesta nuova). Nessuna persistenza, scrittura, ricerca in bozze, segreti/memoria privata, RAG automatico o aggiornamento del canone.
4. La scelta di un altro libro o revisione invalida l'indice e i risultati, come già previsto dall'ADR 0129. Qualsiasi confronto è solo supporto alla verifica umana; una somiglianza alta non rappresenta una contraddizione.
5. Test Vitest su ranking, esclusione di sé e input incoerente; Playwright desktop/mobile con provider mock e contatore delle richieste embedding invariato dopo il confronto. Tutti i gate CI, Pages e cleanup della stessa HEAD sono necessari alla chiusura #153.

## Non-obiettivi

Non è un giudice di continuità, non cerca automaticamente nella memoria narrativa privata, non completa l'issue epica #5, non modifica la fonte canonica e non aggiunge adapter AI.

## Stato release

Incluso nella versione **0.11.90** (#145): i confronti riusano soltanto l'indice RAM, non certificano coerenza narrativa né avviano richieste AI aggiuntive.
