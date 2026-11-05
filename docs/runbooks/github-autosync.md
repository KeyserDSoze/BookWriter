# Runbook — Autosync GitHub

**Versione:** v0.4.0 · **ADR:** 0006 · **Issue:** #3 / #10

## Prima attivazione

1. Collega una repository GitHub privata per libro da **Archivio**. Salva un PAT fine-grained con permesso `Contents: read/write` solo sulle repository necessarie.
2. Con autopilot in pausa, premi **Sincronizza su GitHub**. Deve apparire un commit SHA valido.
3. Attiva **Sincronizzazione automatica ai checkpoint**. Il consenso è per singolo libro, non globale.
4. Dopo un outline, una review di scena, un consolidamento o una revisione il sistema scrive in IndexedDB e inserisce un'operazione nella coda `outbox`. Il browser prova a inviarla mentre la pagina è aperta.
5. Controlla lo stato in Dashboard o Archivio: **in coda**, **invio in corso**, **sincronizzato**, **bloccato**.

## Scrittura simultanea e recupero lease

- Una sessione AI collegata a GitHub acquisisce prima un lease sul ramo separato `bookwriter-lock/<bookId>`. In Archivio sono visibili lo stato, la sessione e la scadenza.
- **Libro già in scrittura:** non forzare il lock. Apri l'altro dispositivo e interrompi correttamente l'autopilot, quindi riprova.
- **Browser chiuso o interrotto:** attendi la scadenza (120 secondi dall'ultimo rinnovo) e altri 60 secondi di margine. Solo allora si attiva **Recupera lease scaduto**; verifica prima che l'altra scheda non stia ancora scrivendo.
- **GitHub offline:** non avviare il runner. Il salvataggio locale resta disponibile e puoi esportare un backup ZIP; le nuove chiamate AI sul libro collegato rimangono bloccate.
- **Lock perso durante la chiamata AI:** l'autopilot si ferma, l'eventuale risposta viene scartata e il risultato non viene canonizzato.
- **Nessun PAT sul nuovo dispositivo:** salva nuovamente il PAT nel vault locale prima di avviare il libro.
- Il lease protegge le **sessioni AI**. Edizioni manuali e canon remoto continuano ad avere il blocco per commit SHA; in caso di conflitto conservare entrambe le copie e non eseguire `force push`.

## Errori e azioni

| Stato / errore | Significato | Azione |
| --- | --- | --- |
| `In attesa` | Checkpoint salvato localmente, non ancora su GitHub | Lasciare la pagina aperta e la connessione attiva |
| `Riprova dopo` | Errore temporaneo, fino a 6 tentativi con intervalli crescenti | Verificare rete; non eliminare IndexedDB |
| `HTTP 401` | Token revocato o non valido | Sostituire PAT e premere **Riprova sincronizzazione** |
| `HTTP 403` | Permessi, limiti API o blocco del provider | Controllare Contents R/W e restrizioni del token; poi riprovare |
| `HTTP 404` | Repository o branch non trovato con quel PAT | Verificare nome e autorizzazioni; non collegare una repo diversa senza migrazione |
| `PUBBLICA` | Libro in repository pubblica senza consenso | Preferire repository privata; in caso contrario autorizzare esplicitamente la pubblicazione |
| `Conflitto remoto` | HEAD GitHub cambiato rispetto al commit noto | **Non** premere retry ripetutamente. Metti in pausa l'autopilot, apri **Archivio → Confronto e recupero delle versioni**, salva entrambe le copie e applica le scelte esplicite; poi fai il push manuale. |
| `Web Locks assente` | Browser senza lock tra tab dello stesso origin | Autosync non viene attivato; usare sync manuale |
| `Interrotto durante il commit` | Esito rete incerto | Alla ripresa si verifica il marker dell'ultimo commit; non creare manualmente un force push |

## Risoluzione di conflitti del canon

Dalla v0.6.0 puoi confrontare il libro locale con l'ultima versione GitHub, scegliendo per scene, personaggi, oggetti, timeline e segreti. Se disponibile, il confronto classifica le modifiche rispetto alla baseline.

Prima del ripristino il sistema verifica che HEAD GitHub e la versione locale non siano cambiati e crea **due backup IndexedDB** in transazione, poi disattiva autosync. **Nessun push avviene durante il recupero.** Leggi `docs/conflict-recovery.md` e scarica uno ZIP per backup esterno.

## Recupero dopo chiusura browser

- Non presumere che un task AI o il sync lavori mentre il browser è chiuso o sospeso.
- Alla riapertura la coda IndexedDB persiste; la procedura di retry parte solo dopo recupero della pagina e dei permessi.
- Per vedere lo stato reale, confrontare **ultimo commit GitHub** e l'assenza della coda (nessuna modifica in attesa).
- In caso di dubbio sul database locale, esportare un ZIP **content-only** prima di qualunque ripristino da GitHub.
- Il libro su GitHub viene ripristinato da `.bookwriter/project.json` con lo storico `.bookwriter/activities.json`; le chiavi API e PAT **non** vengono recuperati da questi file.

## Concorrenza

- Più tab dello stesso browser: un Web Lock serializza i push automatici.
- Più browser/dispositivi: non ancora supportata la scrittura simultanea. Non avviare due autopilot sullo stesso libro finché issue #10 non sarà completata.
- Se `HEAD` è divergente, l'outbox blocca e conserva gli aggiornamenti locali. Non usare `git push --force`.

## Dati sensibili

Il manoscritto e i segreti narrativi sono testo in chiaro nel repository. Solo la repository **privata** evita l'accesso pubblico, e chi ha permessi al repository potrà comunque leggere il contenuto. Il PAT è locale e cifrato in IndexedDB con Web Crypto; uno script malevolo sullo stesso origin può comunque usarlo. Il backup completo con chiavi va cifrato con passphrase.
