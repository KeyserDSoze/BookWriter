# Storico dei costi AI per singolo task — BookWriter v0.11.84, issue #128

Nella Dashboard del libro, nel pannello **Budget AI del libro**, trovi la sezione **Storico dei costi per task AI**. Funziona anche se il budget preventivo è disattivato: legge soltanto le Activity locali del libro attualmente selezionato. Non chiama provider, non acquista token e non esporta prosa.

## Come leggere lo storico

Ogni voce indica il titolo del task e la sua fase (ad esempio revisione del capitolo), data, stato `Completato`, `Fallito`, `Interrotto` o `In corso`, modello ed endpoint, token input/output effettivamente dichiarati e, quando entrambi sono noti, il costo **stimato** con tariffe manuali.

- **Tariffa salvata al tentativo:** lo snapshot della tariffa precedente all'invio del task, che non cambia se oggi aggiorni il listino.
- **Listino corrente (record legacy):** l'attività è precedente agli snapshot tariffari; una modifica del listino può rivalutare questa stima e non dimostra il costo passato.
- **Snapshot tariffa non valido / Tariffa non disponibile:** non sostituire implicitamente un prezzo errato con quello corrente, non inventare costi.
- **Stima non calcolabile:** usage incompleto, mancante, ancora in corso o prezzo non valido. Non equivale a una spesa zero. **Zero noto** appare solo quando il report è completo e una tariffa valida permette il calcolo.

La pagina mostra **10 tentativi alla volta**, dal più recente. Usa **Mostra altri 10 tentativi** per consultare i precedenti; usa **Solo tentativi senza stima** per individuare quelli che richiedono un controllo manuale. Il filtro non modifica dati, configurazione, checkpoint o costo futuro.

Per **l'intera cronologia** puoi sempre utilizzare **Esporta ledger CSV**. Il CSV non contiene il titolo del task e ha la colonna fattura reale vuota: [guida al CSV](ai-cost-ledger.md). Lo storico locale può mostrare titoli di task che contengono riferimenti alla storia, quindi proteggi la schermata da accessi non autorizzati.

## Cosa non rappresentano i numeri

BookWriter non legge il saldo conto o le fatture del provider; non garantisce che un errore sia gratuito o che un successo sia già stato fatturato. I prezzi sono quelli inseriti dall'autore. Caching, imposte, valute diverse, tool e chiamate esterne all'app possono alterare il costo. Per i dati ufficiali consulta il portale del servizio.

[ADR 0119](../ADR/0119-task-ai-cost-history.md) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17) · [Budget](ai-budget.md).
