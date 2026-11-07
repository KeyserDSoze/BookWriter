# Registro privato delle conoscenze dell'autore — v0.11.14

BookWriter consente all'autore di annotare **come interpreta il sapere di un personaggio** in una scena del romanzo. Si tratta di note editoriali locali, non di fatti certificati o di nuove informazioni canoniche.

## Come si usa

Apri il libro e il pannello **Indice eventi candidati** nella redazione. Per registrare una conoscenza, deve esserci prima una menzione testuale riconosciuta (per esempio «Mara scopre che…») in un capitolo **già congelato**. L'autore deve aver confermato quella menzione con **Annota come avvenuto** e una motivazione. Questa prima attestazione certifica soltanto la scelta dell'autore sulla **menzione**, non che ogni parola corrisponda a un evento vero.

Nell'area **Conoscenze interpretate dall'autore** scegli l'attestazione corrente e scrivi una motivazione di **12–500 caratteri**, poi scegli tra:

- **Appresa direttamente:** secondo l'autore, la scena rappresenta un apprendimento diretto.
- **Riferita da altri:** secondo l'autore, la conoscenza è di seconda mano e potrebbe essere inaffidabile.
- **Ancora segreta per il personaggio:** secondo l'autore, la scena può essere una menzogna, un sogno o una falsa impressione; il personaggio non conosce ancora la notizia.

Ogni scelta richiede conferma. Una scelta successiva rettifica la precedente senza cancellare lo storico. Se il testo sorgente cambia, viene riaperto, rigelato o riattestato, la decisione collegata diventa **storica/non corrente**. Non viene trasferita automaticamente a una nuova fonte.

## Privacy, backup e sincronizzazione

Queste note possono contenere spoiler e segreti. **Non sono inviate automaticamente ai revisori, al giudice o ai modelli AI nella v0.11.14**, e nessuna nuova chiamata AI viene effettuata. La decisione disabilita l'autosync per il libro e svuota la coda di sincronizzazione. I **backup ZIP**, sia solo contenuti sia completi, includono però lo storico; un **push GitHub manuale** potrebbe pubblicarlo. Evita repository pubblici per dati sensibili.

Il sistema non modifica automaticamente `memory.secrets`, le schede dei personaggi, la timeline, la prosa o il canone. I registri importati vengono validati come struttura e rivalidati con le fonti correnti, ma l'importazione **non autentica l'identità di chi ha scritto le decisioni**.

## Limiti attuali

Il registro supporta soltanto menzioni esplicite di conoscenza che l'indice lessicale riesce a trovare e che l'autore ha già confermato; non permette di dedurre automaticamente informazioni da pronomi, conversazioni indirette o segreti mai pronunciati. Non è ancora un grafo completo di ciò che tutti i personaggi sanno. La connessione delle annotazioni ai prompt dei revisori richiederà una futura decisione progettuale sulla privacy e sul consenso.

Riferimenti: [ADR 0047](../ADR/0047-author-attested-knowledge-interpretations.md), [indice attestazioni](narrative-event-decisions.md), [piste di comunicazione](information-transfer-traces.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
