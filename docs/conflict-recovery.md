# Confrontare e recuperare versioni del libro

**Funzione prevista dalla PR #14 (v0.6.0).** Disponibile dalla sezione **Archivio → Confronto e recupero delle versioni**. Riferimento tecnico: `ADR/0008-conflict-review-and-recovery.md`.

## Quando usare questa schermata

- GitHub ha un commit diverso da quello noto al browser e l'autosync si è bloccato.
- Hai modificato lo stesso libro da due browser e vuoi vedere cosa manca nelle versioni.
- Vuoi leggere il manoscritto già salvato online senza sovrascrivere quello locale.

Prima metti in **pausa** l'autopilot. Il libro deve essere collegato alla repository corretta e il PAT fine-grained deve essere presente nelle impostazioni locali.

## Procedura

1. In **Archivio**, seleziona il libro e premi **Confronta locale e GitHub**.
2. Controlla il commit GitHub visualizzato. Il sistema prova a leggere anche la versione precedentemente sincronizzata (baseline) per distinguere le modifiche locali, le modifiche GitHub e quelle fatte su entrambe.
3. Apri i dettagli delle differenze. Le sezioni includono brief, vincoli, idee, capitoli e **singole scene**, personaggi, luoghi, fazioni, oggetti, **segreti**, timeline e memoria corrente.
4. Per ogni differenza scegli **Mantieni la versione locale** (valore predefinito) oppure **Usa la versione GitHub**. Leggi la preview o espandi **Mostra tutto il contenuto** prima di selezionare.
5. Se vuoi semplicemente recuperare il remoto, premi **Salva GitHub come copia separata**. Appare un nuovo libro indipendente in IndexedDB; l'originale non cambia.
6. Se vuoi una versione combinata, premi **Applica scelte con doppio backup** e conferma. Il browser verifica che **né il commit GitHub né il libro locale** siano cambiati dopo l'anteprima.
7. Il salvataggio crea in **una transazione** due copie autonome, una locale e una GitHub, e applica le scelte al libro principale. Le copie avranno ID diversi e nessuna repository collegata, così non rischiano di fare un push sulla repository del romanzo originale.
8. Il libro principale passa allo stato **pausato** e l'autosync viene **disattivato**. Rileggi scene, cronologia, segreti e vincoli; se il risultato va bene, esegui un **push manuale** in Archivio e solo dopo riattiva l'autosync.

## Come funziona il confronto

| Origine | Significato |
| --- | --- |
| Modifica locale | Solo il browser è diverso dalla baseline comune |
| Modifica GitHub | Solo la repository è diversa dalla baseline |
| Entrambe modificate | Sia browser sia GitHub sono differenti dalla baseline |
| Diverse — baseline non disponibile | Due versioni differenti senza antenato verificabile |

Non viene fatta una fusione automatica di due testi all'interno della stessa scena. Quando entrambe le versioni contengono passaggi utili, puoi leggerle interamente e usare il normale intervento sull'autopilot per chiedere una riscrittura ragionata dopo aver creato le copie di sicurezza.

La selezione di una versione **assente** può eliminare una scena o una voce del canone dal libro principale. Il contenuto precedente resta recuperabile nelle copie di sicurezza.

## Protezione dei dati

- Il confronto e il ripristino non fanno **POST o PATCH** sulla repository GitHub; i dati remoti non vengono modificati da questa schermata.
- Il commit remoto viene riletto per verificarne lo SHA prima del salvataggio. Se è cambiato, devi ricaricare il confronto.
- Il sistema verifica anche timestamp locale, repository collegata, SHA di baseline e Web Locks delle altre schede; nessun overwrite silenzioso.
- La creazione delle due copie, la sostituzione del libro principale, l'audit e la cancellazione della vecchia coda autosync avvengono in un'unica transazione IndexedDB.
- Le credenziali restano nello storage delle impostazioni, non sono copiate nei progetti o nei file canon.
- **IndexedDB non sostituisce un backup esterno.** Dopo il recupero scarica da Archivio uno ZIP dei contenuti. Se desideri conservare anche le chiavi AI, usa il backup completo cifrato con password.

## Limiti

Non è un diff parola-per-parola e non risolve automaticamente i conflitti con editor GitHub esterni o con dispositivi che non hanno mai sincronizzato il proprio stato. Un commit che avanza **dopo** la verifica del confronto non è perso: un successivo push viene bloccato dal controllo SHA e dovrai ripetere il processo.

## Sviluppi successivi

Diff testuale più granulare, fusione AI assistita con consenso, snapshot ZIP remoti, archivio storico con checksum e recupero guidato dei conflitti offline.
