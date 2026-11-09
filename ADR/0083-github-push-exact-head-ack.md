# ADR 0083 — Verifica della HEAD esatta prima dell'ACK locale del push GitHub

- **Stato:** accettato per v0.11.51
- **Data:** 2026-11-09
- **Issue:** [#87](https://github.com/KeyserDSoze/BookWriter/issues/87)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0005, 0007, 0076, 0082

## Contesto

La versione 0.11.50 rende atomico in IndexedDB l'aggiornamento dei metadati `lastSyncedCommit` e dell'outbox dopo il push. Manca però una verifica esplicita della **HEAD remota dopo il PATCH**: `pushGitHubBook` invia `PATCH /git/refs/heads/<branch>` con `force:false` e ignora il payload della risposta. Una risposta HTTP 2xx con `object.sha` incoerente, oppure un'operazione che non lascia la HEAD esattamente sul commit creato, potrebbe indurre un ACK locale e la pulizia della coda anche quando il commit non è attestato sul branch.

Il lease remoto del writer AI già verifica la HEAD esatta dopo il rinnovo (ADR 0076). Il push del manoscritto deve adottare la stessa prudenza, senza introdurre tentativi di force push o supporre che un 2xx equivalga a pubblicazione.

## Decisione

1. Conservare il controllo HEAD **prima** della costruzione degli oggetti Git, i permessi PAT e i vincoli editoriali, e creare come prima `tree` e `commit` con padre `head`.
2. Eseguire una sola richiesta `PATCH force:false` su `/git/refs/heads/<branch>`, ma tipizzare la risposta e **richiedere `patched.object.sha === commit.sha`**. Se mancante, non valido o diverso: `RemoteConflict` e nessuna conferma locale. Non usare una risposta non interpretabile come prova positiva.
3. Dopo un PATCH con risposta coerente, rileggere **una volta** il ref `GET /git/ref/heads/<branch>` e confrontare con `commit.sha`. Una HEAD rimasta sul padre, già avanzata verso altro SHA, errore di rete o malformata non autorizza `persistRemoteAcknowledgment` e non deve eliminare la richiesta outbox.
4. Soltanto dopo entrambi i controlli si chiama l'ACK atomico di ADR 0082 (`books+outbox`), che rilegge il libro attuale e conserva i checkpoint nuovi. La funzione non avanza `updatedAt` per l'ACK e non altera la policy autosync.
5. **Nessun retry automatico immediato del PATCH incerto**. Dopo una risposta persa con HEAD realmente aggiornata, il successivo tentativo autosync può recuperare in sola lettura dal marker remoto `.bookwriter/sync.json` e dall'`operationId`, come già previsto. Il push manuale mantiene i messaggi espliciti di errore e richiede decisione dell'utente.
6. Aggiornare i mock GitHub di test (il vecchio mock restituiva una HEAD costante) affinché simulino il ref **effettivamente** aggiornato. In Playwright verificare sia il caso 2xx senza avanzamento, rifiutato senza ACK, sia un retry esplicito con avanzamento reale e un checkpoint scritto da un'altra scheda durante il PATCH.

## Ambito e verifiche

Vitest per risposta SHA errata/assente, HEAD non modificata o divergente, perdita di rete durante il readback, push corretto e recovery marker senza nuovi POST/PATCH. Playwright desktop/mobile con un mock di ref reale a due schede; verifiche CI, Pages e cleanup sul medesimo SHA finale. Versione 0.11.51, CHANGELOG, AGENTS, README e guida GitHub aggiornati.

**Limiti:** la rilettura HEAD prova soltanto lo stato remoto **in quell'istante**. Un altro scrittore può successivamente avanzare la HEAD: non è fencing transazionale distribuito, e GitHub/IndexedDB non condividono una transazione. Il lease AI, le divergenze fra dispositivi fisici e le modifiche manuali non cooperative rimangono nelle epic aperte.
