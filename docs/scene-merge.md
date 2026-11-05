# Laboratorio di fusione delle scene — v0.7.0

Questa funzione è accessibile in **Archivio → Confronto e recupero delle versioni** e richiede due versioni della stessa scena (locale e GitHub). Non serve un modello AI per utilizzare l'editor manuale.

## Procedura senza AI

1. Seleziona il libro collegato a GitHub, metti in pausa l'autopilot e premi **Confronta locale e GitHub**.
2. Apri una differenza di tipo **Scena**. Usa **Diff parola per parola** per vedere in rosso ciò che compare solo localmente e in verde ciò che compare soltanto su GitHub. Per scene molto lunghe il programma usa un confronto per paragrafi o mostra le versioni complete senza bloccare il telefono.
3. Apri **Mostra tutto il contenuto locale/GitHub** se hai bisogno di rileggere l'intera scena.
4. Nell'editor **Bozza modificabile**, scrivi la tua fusione o adatta il testo locale, poi premi **Salva nuova bozza manuale**. La bozza viene conservata in IndexedDB con la revisione locale e il commit GitHub esaminati.
5. Seleziona una bozza dallo **Storico bozze locali**, rileggila e premi **Usa questa proposta per la scena**. La selezione è reversibile e non modifica ancora il libro.
6. Premi **Applica scelte con doppio backup**, conferma e controlla nella sezione **Libro** che la scena risulti **draft**, non canon.
7. Rivedi continuità, personaggi, cronologia e segreti; usa le normali revisioni editoriali prima di riprendere l'autopilot. Dopo il recupero l'autosync è **disattivato**: rileggi il libro, esegui un push manuale e poi, se desideri, riattivalo.

## Proposta AI facoltativa

In **Impostazioni → Router dei modelli** configura **Fusione di scene** con un endpoint/modello OpenAI-compatible. È possibile definire un **Override del libro** per il modello di fusione, indipendente dai modelli per brainstorming, prosa, review o riassunto.

Nel laboratorio inserisci indicazioni editoriali facoltative e scegli **Genera proposta AI**. Prima di inviare la richiesta, la UI mostra nome dell'endpoint e del modello e chiede il consenso al trasferimento delle **due versioni integrali della scena, dei vincoli e della memoria narrativa, inclusi i segreti**. Il provider può consumare crediti anche se rifiuti la proposta.

L'app acquisisce un lease di scrittura sul ramo GitHub dedicato, verifica che la sessione possa ancora scrivere, contatta l'endpoint AI e valida nuovamente il lease, il commit remoto e il timestamp locale. Se l'operazione non è confermata o è diventata obsoleta, non la applica al canon. Puoi interrompere la chiamata, ma eventuali crediti già fatturati non sono recuperabili.

La risposta viene salvata come **bozza** e rimane modificabile. Puoi scegliere tra tutte le bozze della sessione di confronto, rifiutarle o salvarne una alternativa manuale. **Nessuna risposta AI viene applicata automaticamente**.

## Stato e audit

- `proposed`: bozza disponibile e ancora non accettata.
- `rejected`: bozza esplicitamente rifiutata; la scena principale non cambia.
- `accepted`: bozza applicata soltanto dopo approvazione e recupero con doppio backup. Il testo della scena resta in stato **draft**.
- Il registro attività conserva il modello, l'endpoint e i token di input/output **solo se restituiti dal provider**. Non viene inventato il costo in euro.
- L'approvazione crea due copie complete in IndexedDB (originale locale e originale GitHub), conserva l'ultima versione editoriale scelta, invalida i riassunti obsoleti e disattiva autosync.
- I testi degli originali e le proposte restano visibili nello storico delle bozze del browser. Lo **ZIP di soli contenuti** include lo storico; quando lo importi su un altro dispositivo le vecchie bozze non vengono riconosciute automaticamente come approvate.

## Privacy e sicurezza

Le chiavi AI e il PAT GitHub sono locali e non sono salvati nelle bozze né nello ZIP content-only. Tuttavia **prosa, segreti e bozze sono contenuti in chiaro** nello ZIP di soli contenuti; usalo come copia privata, non pubblicarlo. Se vuoi esportare contenuti con credenziali usa il backup completo protetto con password.

L'app non modifica il repository durante il confronto, la proposta AI o l'approvazione; GitHub viene scritto soltanto da una successiva sincronizzazione esplicita. La protezione dei lock è conservativa e non sostituisce un coordinatore distribuito transazionale.

## Limiti

- Una sola scena alla volta; non è ancora disponibile la fusione AI di interi archi o capitoli.
- Il diff evidenzia differenze testuali, **non** garantisce che la nuova versione sia coerente con il canone o priva di spoiler. La verifica finale spetta all'autore.
- Gli input troppo grandi vengono rifiutati, non troncati in modo silenzioso: devi ridurre il contesto prima di chiamare il modello.
- L'operazione AI richiede che il browser sia aperto e connesso.
- La selezione proposta scade se cambia la revisione del libro, la scena o il commit GitHub; ricarica il confronto.
- Per un primo recupero esplorativo puoi salvare GitHub come copia separata senza avviare alcun modello.

## Riferimenti

- [ADR 0009](../ADR/0009-scene-diff-assisted-merge.md)
- [ADR 0008](../ADR/0008-conflict-review-and-recovery.md)
- [Issue #15](https://github.com/KeyserDSoze/BookWriter/issues/15)
