# Esportare il ledger dei consumi AI — BookWriter, issue #126

La Dashboard del libro contiene il pannello **Budget AI del libro** con il pulsante **Esporta ledger CSV**. Il pulsante è disponibile appena il libro selezionato ha registrato un tentativo AI; funziona anche con il budget **disattivato**. L'esportazione avviene interamente nel browser e non contatta provider, servizi analytics o GitHub.

## Che cosa c'è nel file

Un file `bookwriter-ledger-<id-libro>.csv` con codifica **UTF-8**, BOM e separatore `;` (compatibile con i fogli di calcolo italiani). Ciascuna riga riguarda **una sola Activity AI** del libro selezionato, ordinata per data e ID.

- `attivita_id`, `creata_utc`, `terminata_utc`, `stato_attivita` (`succeeded`, `failed`, `cancelled`, `running`), `endpoint_id`, `modello_id`.
- `token_input_osservati`, `token_output_osservati`: soltanto valori interi non negativi **ricevuti dal provider**. Una cella vuota significa **ignoto**, non zero.
- `copertura_usage`: `completo`, `parziale`, `mancante` oppure `in_corso`. I tentativi `running` non hanno un costo considerato conclusivo neanche quando contengono token provvisori.
- `origine_tariffa`: `snapshot` (tariffa registrata prima della richiesta), `listino_corrente` (Activity legacy senza snapshot, quindi ricalcolabile), `snapshot_non_valido` oppure `tariffa_assente`. Le colonne `prezzo_input_eur_milione` e `prezzo_output_eur_milione` riportano soltanto prezzi manuali validi.
- `costo_stimato_eur`: stima in euro **solo** con uso completo e prezzo valido; zero è significativo solo quando calcolato da numeri noti. Formula: `(input × tariffa_input + output × tariffa_output) / 1.000.000`. Una cella vuota non significa costo zero.
- `fattura_provider_eur`: **sempre vuota**. `stato_fattura`: sempre `non_disponibile`, perché BookWriter non legge le fatture del provider.

I tentativi respinti dal budget **prima** del contatto con il provider (`aiRequested=false`) non sono contabilizzati; le azioni editoriali manuali sono escluse. Una Activity con invio richiesto non dimostra di per sé che la rete sia stata raggiunta o che sia stato effettuato un addebito.

## Controllo e privacy

Il CSV **non contiene** testo narrativo, prompt, output, titoli, descrizioni, errori, segreti API, PAT o nomi dei libri. Contiene però orari, nomi dei modelli e importi: custodiscilo come un file di attività riservato. Le celle vengono escapate e gli identificatori importati sospetti non possono essere interpretati normalmente come formule dal foglio di calcolo.

I dati si riferiscono al **solo libro attivo**. La valuta delle tariffe è sempre EUR; il CSV non crea nuove tariffe, non accede a un account provider, non salva fatture ed **esporta l'intera cronologia** di quel libro, non solo il periodo del budget attualmente abilitato. Filtra le date nel tuo foglio per riconciliare una fattura relativa a un intervallo; confronta gli importi veri sul portale del provider.

La stima non comprende necessariamente cached tokens, strumenti, tasse, retry fatturati senza usage, prezzi in altre valute e tariffe per date. I costi reali devono essere verificati separatamente.

[ADR 0118](../ADR/0118-local-ai-cost-ledger-csv.md) · [Epic #17](https://github.com/KeyserDSoze/BookWriter/issues/17) · [Budget AI](ai-budget.md).
