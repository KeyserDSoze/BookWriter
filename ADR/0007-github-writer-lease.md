# ADR 0007 — Coordinamento della scrittura AI con un lease GitHub fast-forward-only

- **Stato:** Accettato per v0.5.0 (prima implementazione)
- **Data:** 2026-11-05
- **Issue:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10)
- **PR:** [#12](https://github.com/KeyserDSoze/BookWriter/pull/12)
- **Predecessori:** ADR 0005, 0006

## Contesto

L'autosync v0.4.0 dispone di lock tra tab dello stesso origin (Web Locks), ma non coordina due dispositivi con IndexedDB differenti. Due istanze di autopilot possono altrimenti pagare lo stesso lavoro AI, scrivere testi incompatibili e incontrare conflitti Git solo dopo la generazione.

## Decisione

1. Ogni sessione AI per un libro collegato a GitHub deve **acquisire un lease remoto prima di impostare `running` o chiamare un modello**. Libri completamente locali continuano a funzionare senza GitHub.
2. Il lease è un documento JSON senza segreti in `.bookwriter/lease.json` sul ramo separato `bookwriter-lock/<bookId>`. Contiene schemaVersion, bookId, sessionId effimera (UUID), stato `active|released`, acquiredAt, renewedAt, expiresAt. Non contiene PAT, chiavi AI, dati personali o prosa.
3. Il primo client crea la branch con Git Data API (`POST /git/refs`). Rinnovo, rilascio e takeover producono un nuovo commit **discendente** dal precedente HEAD e aggiornano la branch con `PATCH ... force:false`. Due aggiornamenti concorrenti dallo stesso parent non possono entrambi avanzare in modo fast-forward.
4. Il lease dura **120 secondi**, con heartbeat ogni **25 secondi**. Se il browser viene sospeso, GitHub non risponde o il lease è già scaduto, l'autopilot **si interrompe**; non può proseguire in modo non verificato.
5. Prima di ogni chiamata AI, immediatamente dopo aver ricevuto l'output, e prima di canonizzare il risultato in IndexedDB, la sessione ricontrolla da GitHub che `HEAD` della branch sia ancora associato alla sua sessionId e il lease sia attivo. Un risultato calcolato dopo aver perso ownership **non viene canonizzato**.
6. Web Locks `bookwriter:writer:<bookId>` previene la scrittura simultanea da più schede **dello stesso browser**. Per libri collegati, l'assenza del supporto Web Locks **impedisce l'avvio**, anziché procedere senza protezione.
7. Lock ancora attivo: nessun takeover automatico. Lock scaduto: aspettare **60 secondi aggiuntivi** e richiedere un intervento umano esplicito in Archivio. Il recupero crea un commit successivo `active`, poi `released`; l'utente può quindi avviare una nuova sessione.
8. L'acquisizione o il rinnovo falliti vengono riportati all'autore in modo comprensibile; non viene spesa un'altra chiamata AI. Il rilascio in `finally` è best effort: dopo crash il TTL e recupero manuale restano necessari.
9. Il lease non modifica il canon `main`; si conserva la protezione `force:false` e il controllo SHA della sincronizzazione narrativa, senza tentativi di merge automatico.

## Conseguenze

- Riduce i casi di doppio autopilot sullo stesso manoscritto su dispositivi differenti, anche quando ogni dispositivo ha il proprio IndexedDB.
- L'acquisizione richiede un PAT autorizzato, rete e repository inizializzata. Un libro collegato non può avviare AI offline: **fail closed**.
- L'uso di GitHub come coordinatore ha latenza e limiti di frequenza. Il browser sospeso può lasciar scadere il lease; nessuna promessa di esecuzione con tab chiusa.
- La protezione è **best effort**, non un lock transazionale di database: l'orologio locale determina la scadenza e tra l'ultimo check remoto e la scrittura IndexedDB resta un intervallo non atomico. Il recupero è quindi manuale e conservativo, non automatico. Operatori con permessi GitHub possono modificare/forzare la branch al di fuori del client.
- Il lease coordina l'**AI**, non offre ancora merge delle modifiche manuali da diversi dispositivi. Il canon Git resta sotto controllo SHA. Scritture concorrenti di un editor esterno devono essere risolte in modo esplicito.
- L'outbox autosync può lavorare durante la sessione, ma non sostituisce la verifica ownership prima delle operazioni AI; in caso di divergenza del canon il push si blocca.
- Il prossimo hardening dovrà includere gestione centralizzata del tempo affidabile, fencing anche sulle scritture locali/manuali e preview dei conflitti base/locale/remoto.

## Verifiche

Test di due client concorrenti su ref non esistente, rinnovo, rilascio, recupero di lease scaduto, perdita del lock durante il modello, `PATCH force:false` e assenza di PAT nel marker. CI desktop/mobile obbligatoria.

## Riferimenti

- [GitHub REST Git references](https://docs.github.com/en/rest/git/refs) — create, read, update; `force:false` verifica fast-forward.
- [GitHub Git commits](https://docs.github.com/en/rest/git/commits)
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
