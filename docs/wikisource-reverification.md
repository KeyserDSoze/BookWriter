# Wikisource — riverifica remota delle fonti v0.9.7

La **riverifica** risponde a una domanda specifica: «Il breve estratto presente nel dossier corrisponde ancora al wikitesto che MediaWiki restituisce per quel numero di revisione?». **Non** risponde a: «Il testo storico è vero?», «L'opera è autentica?» o «Posso pubblicarla senza permesso?».

## Passi nell'interfaccia

Apri **Redazione multi-agente → Trascrizioni Wikisource** in un capitolo con una fonte attiva `itwsr:`. Accanto all'estratto è disponibile il comando **Riverifica revisione online**.

1. Un dialogo chiede il consenso per leggere dall'API Wikisource **il solo ID numerico pubblico della revisione**. Nessuna query, citazione, testo del romanzo, segreto, chiave AI, hash o PAT viene inviata.
2. BookWriter recupera il wikitesto dell'esatta revisione e confronta **ID pagina, titolo, revisione, timestamp, SHA-256, lunghezza e frammento alla stessa posizione** con quanto salvato nel dossier.
3. Se coincidono, compare **Confronto remoto riuscito** con l'ora del controllo. Lo stato è **temporaneo, solo nella schermata**: non viene conservato in IndexedDB, GitHub o nei backup. Ricaricando la pagina occorre verificare nuovamente.
4. Se c'è una discrepanza compare un **avviso di discordanza**. Non significa necessariamente che il documento sia falso: una pagina rinominata o un backup modificato possono richiedere indagini. Per evitare correzioni narrative basate su una fonte dubbia, è disponibile **Escludi fonte discordante**.
5. Il secondo comando richiede **un'altra conferma**. Solo allora la fonte viene disattivata dalle nuove review; rimangono lo snapshot e i report precedenti, consultabili per audit. L'autosync si disabilita e, se il capitolo era congelato, vengono invalidate le approvazioni di quel capitolo e dei successivi. Non viene modificata la prosa.
6. Per sostituire la fonte, ripeti la ricerca e il consenso originale, ottenendo un nuovo snapshot `itwsr:`. Nessun ID o hash viene sovrascritto silenziosamente.

**In caso di errore di rete, API 429, CORS, risposta malformata o contenuto non disponibile**, BookWriter non dichiara nessun esito positivo o negativo. Il libro non viene modificato. Ritenta quando il servizio torna disponibile.

## Provenienza e diritti

Lo SHA-256 è un'impronta locale del **wikitesto restituito dall'API**, non una firma di Wikisource e neppure una verifica indipendente di un'edizione d'epoca. Anche quando il confronto riesce, controlla personalmente l'opera originale, contesto, attribuzione, cronologia, eventuali trasclusioni e copyright. `work_rights_not_verified` rimane sempre valido.

Gli estratti archiviati in precedenza sono mantenuti per audit; i vecchi `itws:` della v0.9.5 non possiedono prova sulla revisione e non possono essere riverificati come `itwsr:` senza una nuova ricerca consensuale.

In particolare il controllo non è eseguito in automatico prima di ogni review e non garantisce una disponibilità continua di MediaWiki. Le verifiche automatiche nei test sono simulate e non assicurano accesso reale a CORS.

Per maggiori dettagli: [ADR 0020](../ADR/0020-wikisource-remote-reverification.md), [guida alle trascrizioni revisionate](wikisource-transcriptions.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
