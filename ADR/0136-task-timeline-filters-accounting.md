# ADR 0136 — Timeline dei task interrogabile con stime economiche e isolamento delle tracce

- Stato: accettato come incremento del MVP task-first
- Data: 2026-11-12
- Issue: #162, parent #157; ledger #17; rewind #158; privacy streaming #156

## Contesto

Il Dashboard compatto serve a vedere l'attività corrente, ma dopo decine di run il registro senza filtri impedisce di ritrovare un tentativo precedente. La sola indicazione dei token può indurre a trattare assenza di conteggi come costo zero. I prompt sono dati sensibili: anche con un consenso locale attivo, una Promise IndexedDB che risolve dopo il cambio libro non deve mai far riapparire la trascrizione di un altro libro.

## Decisione

1. Introdurre un modulo puro `domain/task-timeline.ts` che filtra una **copia** ordinata delle Activity per stato/fase/query di metadati e ordine. Mai interrogare `Activity.output`, messaggi system/user o `AiLocalTrace`; nessun indice di testo sensibile o nuova chiamata AI. Filtri solo nel registro completo; Dashboard mantiene massimo otto task, con accesso esplicito alla pagina Attività.
2. Mostrare durata solo da date di inizio/fine ISO parseabili con `end >= start`. Nessuna stima per task senza `endedAt` o timestamp corruttibili. Stato running e timeout non devono essere presentati come durata conclusa.
3. Prezzo storico: usare soltanto `Activity.priceRateSnapshot` quando `isPriceRate` conferma struttura/range, i campi `endpointId/modelId` coincidono e `validTokenCount` accetta sia token input sia output; calcolare EUR = `(in*inRate+out*outRate)/1_000_000`. Mancanze e preflight non richiesti non vanno contati come costi zero. Il riepilogo distingue `pricedReports` da `uncertainAttempts`; zero report priced e stima 0 non attestano costo complessivo zero. Anche attività failed/cancelled possono avere consumo parziale.
4. Protezione dal leakage cross-book: invalidare con ticket incrementale ogni ispezione in volo al cambio di `bookId`, consenso, selezione o unmount; anche in render il tracciato sensibile viene mostrato solo se `trace.bookId===bookId && trace.activityId===item.id && chosen===item.id && inspectionEnabled`. Le tracce restano IndexedDB meta locale, mai nel canon, ZIP o GitHub. La ricerca pubblica non accede a esse.
5. Nessun tentativo di rewind: il pulsante di revisione usa ancora il flusso supervisionato corrente. Durata/costo non implicano un audit contabile completo (#17). Non alterare writer lock, CAS, budget o sync.

## Verifiche

Vitest deterministico per filtri/ordinamento senza mutazione input, esclusione output dalla ricerca, durata mancante/invalida, stima EUR esatta e tentativi incerti. Playwright Chromium desktop/mobile con seed sintetici IndexedDB, filtri, reset, ordinamento e cambio libro mentre una traccia era stata ispezionata. Tutti i job Frontend CI/EPUBCheck/Pages/cleanup devono essere `completed/success` sulla stessa SHA prima di chiudere #162. La CI non attesta il server LM Studio fisico (#159).
