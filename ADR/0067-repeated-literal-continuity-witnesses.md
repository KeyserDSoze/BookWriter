# ADR 0067 — Recupero di menzioni letterali ripetute nelle finestre di continuità

- **Stato:** accettato per v0.11.34
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063–0066

## Problema

La v0.11.33 ha aggiunto una seconda finestra mirata per scene lunghe, ma il codice interrogava **esclusivamente la prima occorrenza** di ogni nome o termine. Se «Ivo» e «chiave» comparivano nello stesso primo estratto e «chiave» ricompariva molte pagine dopo, la seconda occorrenza non veniva vista. Quando soltanto «Ivo» era pertinente ma appariva in due passaggi distanti della scena, si sceglieva comunque un fallback generico. La mancanza di queste seconde menzioni indebolisce i confronti cronologici, senza però provare di per sé alcuna incoerenza.

## Decisione

1. Conservare la selezione del **primo** estratto secondo l'ordine dei segnali `literalEntities`, `entities`, `terms` e la ricerca del primo match a parola intera sul testo originale (ADR 0064).
2. Estendere l'helper di ricerca letterale con un intervallo **assoluto** `from/until` nel testo UTF-16 originale, usando l'ultimo indice del motore regex e verificando l'intero match dentro l'intervallo. Non ricostruire gli offset tramite copie tagliate, normalizzate o unite. Continuare a escape dei metacaratteri regex e al controllo di confine Unicode.
3. Dopo aver definito la finestra primaria `[start,start+1250)`, per ciascun *termine distinto* tra i primi 48 cercare la prima menzione valida in `[0,start)` e poi in `[start+1250,text.length)`. Questa ricerca deve poter trovare una **seconda** menzione dello stesso termine alternativo se la prima è già dentro la finestra primaria. Il primo termine distinto rilevante nell'ordine della query vince.
4. Se manca un testimone di **termine diverso** fuori dal primo estratto, tentare una menzione ripetuta del **termine primario** nelle stesse porzioni scoperte. Se non esiste, usare il fallback distante di ADR 0066. Due citazioni dello stesso nome non sono due attestazioni indipendenti né prova di identità o sequenza degli eventi.
5. Mantenere due finestre **massimo 1.250 caratteri ciascuna**, ordine crescente di offset, copertura `partial` per scene lunghe, massimo 4 scene (2/capitolo), ranking di 1.600 candidate e gli attuali contatori di omissione. Nessun nuovo campo persistito, prompt o modello, nessuna nuova richiesta AI/HTTP e nessuna condivisione di segreti, note autore, registri alias o contesti ai lettori ciechi.

## Tradeoff e verifiche

La ricerca in porzioni scoperte può aumentare il lavoro CPU locale ma rimane limitata a massimo 48 segnali; riduce il rischio di citare solo la prima comparsa di un nome senza promettere ispezione completa. Testare un termine alternativo presente sia nella prima finestra sia altrove, due occorrenze distanti dello stesso nome, priorità del termine diverso, fallback senza match, offset esatti, nessuna lettura delle memorie segrete e nessun trasferimento ai cinque lettori ciechi, con Vitest e Playwright desktop/mobile.
