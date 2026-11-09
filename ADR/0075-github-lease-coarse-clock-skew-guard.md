# ADR 0075 — Guardrail conservativo contro clock skew macroscopico del lease GitHub

- **Stato:** accettato per v0.11.42
- **Data:** 2026-11-09
- **Issue consegnata:** [#78](https://github.com/KeyserDSoze/BookWriter/issues/78)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10) e [#6](https://github.com/KeyserDSoze/BookWriter/issues/6)
- **Precedenti:** ADR 0007, 0074

## Contesto

Il writer lease del browser usa `Date.now()` per confrontare `expiresAt` e il margine di takeover. Un dispositivo con orologio alterato di ore può valutare un lock remoto attivo come già recuperabile. La soluzione ideale sarebbe una lettura autorevole del tempo GitHub, ma **l'header HTTP `Date` non è CORS-safelisted e non figura nell'allowlist esposta dalla REST API di GitHub**, quindi è invisibile al JavaScript della SPA senza esplicita modifica del server. Rendere obbligatorio `Date` bloccherebbe l'autopilot in produzione. Non introduciamo proxy, backend o un ulteriore servizio di tempo, che aprirebbe problemi di credenziali, privacy e affidabilità.

## Decisione

1. Conservare invariati payload lease v1, TTL 120s, rinnovo 25s, recovery manuale con 60s di grace, Web Locks, verifica ownership prima/dopo AI e CAS GitHub `force:false`.
2. Sfruttare l'header **CORS-esposto** `X-RateLimit-Reset` delle risposte REST GitHub come limite temporale **approssimativo**. Per il rate limit primario il reset è previsto nella finestra di circa 60 minuti, dunque il clock locale è considerato plausibile soltanto fra `reset−65 minuti` e `reset+5 minuti`. È un controllo di anomalia macroscopica, non un timestamp UTC server affidabile al secondo.
3. Prima di utilizzare una risposta REST riuscita per lease, acquisizione, rinnovo, release, ispezione o takeover, verificare il reset come numero intero positivo e il confronto con `Date.now()`. Header mancante, dato invalido o skew chiaramente fuori finestra => `RemoteWriterLost` leggibile, nessuna chiamata modello o scrittura sulla branch. **Chiarimento v0.11.43, issue #79:** anche il **404 atteso** di assenza branch deve superare lo stesso controllo prima di poter affermare che il lock non esiste; il successivo GET dell'HEAD remoto resta obbligatorio per creare un lease.
4. Non modificare gli errori espliciti HTTP 401, 403, 409, 422, 404; non aggiungere token negli URL, letture di segreti, chiamate esterne extra o stati persistiti. L'Archivio rende esplicito che la verifica è **approssimativa**, senza promessa di sincronizzazione del dispositivo.
5. Test con header indipendente dall'orologio locale, skew +24h e −24h, header nullo e malformato, lease già presente e branch assente, acquisizione/rinnovo/rilascio normali. Playwright desktop/mobile con mock dell'header esposto e del clock alterato. Aggiornare docs/AGENTS e issue col risultato verificato.

## Chiarimento UI v0.11.43

L'Archivio tratta la verifica del lock come tre stati espliciti: in corso, verificato (inclusa assenza effettiva) e non verificabile. Su errore scarta il precedente risultato invece di mostrarlo come attuale, e ignora risposte di richieste precedenti arrivate in ritardo. Ciò non modifica il lease distribuito né introduce chiamate aggiuntive. I test includono 404 con header CORS assente o alterato e ripristino successivo, su browser desktop/mobile.

## Rischi residui

La finestra di rate limit varia in base all'account/endpoint ed è volutamente larga. Può **non rilevare skew di pochi o decine di minuti** e non impedisce ogni takeover prematuro. Una risposta GitHub senza header esposto interrompe l'autopilot, di proposito, non deve attivare un fallback più debole. Per maggiore garanzia temporale occorrono un orologio server attendibile accessibile alla SPA o una strategia di fencing più forte: **issue #10 resta aperta**, come restano gli scenari di editor manuali concorrenti. Il controllo non costituisce un coordinatore distribuito transazionale.
