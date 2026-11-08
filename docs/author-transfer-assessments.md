# Valutare una pista di comunicazione — v0.11.20

BookWriter permette di registrare **la tua interpretazione di una singola citazione** dove il romanzo sembra descrivere una comunicazione fra due personaggi. L'analisi è volontaria; una frase può essere una menzogna, un sogno, un ricordo o un racconto incompleto. **Nessun giudizio entra automaticamente nel canone.**

## Come registrarla

Apri **Indice eventi candidati → Conoscenze interpretate dall'autore → Collegare informazioni fra personaggi**. È necessario aver prima confermato due conoscenze di personaggi differenti come **«stessa informazione»**. Premi **Esamina piste possibili** su quella coppia, confronta le citazioni in entrambe le direzioni e seleziona **Valuta questa pista** su una frase precisa.

Scegli una fra tre interpretazioni e scrivi **20–650 caratteri di motivazione**, poi conferma:

- **Comunicazione descritta secondo l'autore:** ritieni che la frase racconti un passaggio di notizia, ma non è prova che sia stato ascoltato, creduto o compreso.
- **Pista possibile, non accertata:** riconosci un indizio ancora ambiguo.
- **Pista respinta dall'autore:** decidi di non usare la frase come possibile passaggio.

Il form non preseleziona alcun giudizio. Puoi rettificarlo selezionando nuovamente la stessa citazione: la **scelta più recente prevale**, lo storico rimane. La scheda mostra la valutazione corrente e le versioni precedenti.

## Quando una valutazione non è più corrente

Ogni giudizio è ancorato all'ID del collegamento `same_information`, ai due ID delle interpretazioni knowledge nella direzione esatta e all'ID della singola frase. Se cambi il collegamento o la classificazione di una conoscenza, riapri il capitolo, modifichi il testo sorgente o la frase non rientra più nell'anteprima limitata, il giudizio non è più valido per il prossimo controllo: resta **solo nello storico**, senza confermare altre versioni né riabilitare scelte precedenti.

Il vecchio scanner legge soltanto capitoli **congelati precedenti nel manoscritto**, massimo 240 scene e 4 citazioni per direzione. Le date dei capitoli e il loro ordine non provano la cronologia della storia; l'assenza di risultati non prova che la notizia non sia stata comunicata.

## Privacy e backup

Il giudizio e la motivazione si salvano **localmente**, non sono inviati ai modelli AI e **non** autorizzano automaticamente revisori o giudice a modificare la prosa. Il salvataggio richiede Web Locks, controllo delle modifiche concorrenti e autopilot fermo; disabilita autosync GitHub e svuota l'outbox. L'attività registrata non contiene nomi, prosa o note private.

Lo storico entra nei backup ZIP content/full ed eventualmente in un **push manuale GitHub**: contiene possibili spoiler. Un ZIP importato non autentica la tua identità e le prove vengono ricontrollate prima di considerarne corrente l'interpretazione. Un vecchio ZIP senza questi giudizi rimane compatibile.

Riferimenti: [ADR 0053](../ADR/0053-author-transfer-assessment-ledger.md), [anteprima comunicazioni](knowledge-transfer-preview.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
