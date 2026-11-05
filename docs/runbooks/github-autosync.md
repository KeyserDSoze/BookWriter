# Runbook — Autosync GitHub

**Versione:** v0.4.0 · **ADR:** 0006 · **Issue:** #3 / #10

## Prima attivazione

1. Collega una repository GitHub privata per libro da **Archivio**. Salva un PAT fine-grained con permesso `Contents: read/write` solo sulle repository necessarie.
2. Con autopilot in pausa, premi **Sincronizza su GitHub**. Deve apparire un commit SHA valido.
3. Attiva **Sincronizzazione automatica ai checkpoint**. Il consenso è per singolo libro, non globale.
4. Dopo un outline, una review di scena, un consolidamento o una revisione il sistema scrive in IndexedDB e inserisce un'operazione nella coda `outbox`. Il browser prova a inviarla mentre la pagina è aperta.
5. Controlla lo stato in Dashboard o Archivio: **in coda**, **invio in corso**, **sincronizzato**, **bloccato**.

## Errori e azioni

| Stato / errore | Significato | Azione |
| --- | --- | --- |
| `In attesa` | Checkpoint salvato localmente, non ancora su GitHub | Lasciare la pagina aperta e la connessione attiva |
| `Riprova dopo` | Errore temporaneo, fino a 6 tentativi con intervalli crescenti | Verificare rete; non eliminare IndexedDB |
| `HTTP 401` | Token revocato o non valido | Sostituire PAT e premere **Riprova sincronizzazione** |
| `HTTP 403` | Permessi, limiti API o blocco del provider | Controllare Contents R/W e restrizioni del token; poi riprovare |
| `HTTP 404` | Repository o branch non trovato con quel PAT | Verificare nome e autorizzazioni; non collegare una repo diversa senza migrazione |
| `PUBBLICA` | Libro in repository pubblica senza consenso | Preferire repository privata; in caso contrario autorizzare esplicitamente la pubblicazione |
| `Conflitto remoto` | HEAD GitHub cambiato rispetto al commit noto | **Non** premere retry ripetutamente; salvare ZIP locale e verificare il commit remoto. La risoluzione visuale è futura |
| `Web Locks assente` | Browser senza lock tra tab dello stesso origin | Autosync non viene attivato; usare sync manuale |
| `Interrotto durante il commit` | Esito rete incerto | Alla ripresa si verifica il marker dell'ultimo commit; non creare manualmente un force push |

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
