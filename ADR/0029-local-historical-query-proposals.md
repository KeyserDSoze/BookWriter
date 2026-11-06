# ADR 0029 — Proposte locali di ricerche storiche con conferma dell'autore

- **Stato:** Accettato per v0.10.6 (PR #41)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0013, 0026–0028

## Problema

La ricerca storica oggi richiede che l'autore scriva manualmente ogni query pubblica. Questo riduce il rischio di spedire segreti e materiale inedito ma rende oneroso identificare i possibili anacronismi in un capitolo già scritto. Estrarre automaticamente testo libero e inviarlo a Wikipedia/LLM, senza rivederlo, violerebbe il requisito di riservatezza e l'esplicito consenso alla ricerca.

## Decisione

1. Il browser dispone di una funzione pura `proposeHistoricalQueriesLocally` che legge solo il testo delle scene del capitolo in memoria e **non esegue alcun fetch o chiamata AI**. Cerca una whitelist ridotta, statica e pubblica di temi storici (telegrafo, ferrovie, fotografia, ecc.) e associa un anno a quattro cifre nel range 1300–2099 **solo se appare entro una breve distanza** dal termine; altrimenti usa il termine `storia`.
2. L'output contiene soltanto un'etichetta predefinita e un anno letteralmente già presente nel testo (oppure `storia`). Non trasmette stringhe libere, nomi propri o brani. Deduplica per tema, conserva l'ordine della prima comparsa e restituisce al massimo cinque proposte. Limita la scansione a 16 scene e 24.000 caratteri per scena. Non pretende precisione di riconoscimento di tutte le epoche o tecnologie.
3. Il pannello `Dossier storico` aggiunge una sezione per **generare in locale**, mostrare e selezionare manualmente le proposte. Il clic su `Aggiungi alla bozza` modifica solo lo stato React della textarea. Non modifica le query già approvate nel dossier, IndexedDB, la coda GitHub o il canone. Non è ancora una ricerca.
4. Solo `Cerca fonti pubbliche` utilizza `normalizeResearchQueries` e apre il **dialogo già esistente** con la lista esatta delle query. Un annullamento lascia il browser senza chiamate e non muta il libro. L'autore può modificare qualunque proposta prima dell'invio. La ricerca confermata conserva i blocchi, il CAS, l'audit e il rewind dell'ADR 0013.
5. La proposta non accede alla memoria `secrets`, `authorConstraints`, al brief privato, ad API di terze parti né al routing AI. Non vi sono nuovi costi o telemetrie. Le nuove proposte sono **effimere**, non nel progetto, backup o GitHub finché la ricerca non sia stata approvata.

## Limiti epistemici e riservatezza

- Anche un vocabolo comune o un anno possono essere uno spoiler in determinati romanzi; il filtro non è una garanzia assoluta. Prima della ricerca l'autore deve controllare il testo esatto che lascerà il browser.
- Un termine riconosciuto non dimostra che la tecnologia sia presente storicamente in quel luogo e in quell'anno; un'assenza di proposte non prova assenza di anacronismi.
- Non si generano nomi di istituzioni, località, persone o fatti nuovi, non si cercano automaticamente fonti primarie e non si delega una ricerca autonoma a un modello.

## Accettazione

- Vitest su whitelist/anni espliciti vicini/assenza date/limiti/deduplica, non-leak di nomi e stringhe arbitrarie.
- Playwright desktop/mobile: proposte senza rete, bozza non persistita, consenso annullato senza HTTP, conferma con solo query esatta e assenza chiamate AI.
- CI completa sull'HEAD definitiva della PR, poi merge e verifica CI main/deploy Pages/cleanup.
