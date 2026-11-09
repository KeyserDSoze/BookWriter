# ADR 0076 — Rinnovo del lease GitHub confermato dalla HEAD esatta

- **Stato:** accettato per v0.11.44
- **Data:** 2026-11-09
- **Issue di consegna:** [#80](https://github.com/KeyserDSoze/BookWriter/issues/80)
- **Epic aperte:** [#10](https://github.com/KeyserDSoze/BookWriter/issues/10), [#6](https://github.com/KeyserDSoze/BookWriter/issues/6), [#3](https://github.com/KeyserDSoze/BookWriter/issues/3)
- **Precedenti:** ADR 0007, 0075

## Problema

Il rinnovo crea un commit sulla branch di lock e tenta un `PATCH force:false`. La gestione preesistente inghiottiva gli errori `RemoteWriterLost`, inclusi i 409/422 di conflitto, e poi chiamava `assertWriterLease`. Quest'ultima verifica soltanto `sessionId`/scadenza corrente, non **l'effettiva installazione del commit di rinnovo**. La vecchia HEAD rimane di proprietà della stessa sessione per alcuni secondi e poteva far ritornare successo, pur senza aver esteso il TTL.

## Decisione

1. Dopo `writeLease` e l'unico PATCH non forzato, sia con ACK riuscito sia con eccezione `RemoteWriterLost`, rileggere il riferimento e il documento remoto con i **due GET già usati da `assertWriterLease`**. Non aggiungere richieste o retry incondizionati.
2. Accettare il rinnovo soltanto se `confirmed.headSha === commit` **e** `confirmed.sessionId === current.sessionId` **e** il lease è ancora `active` e non scaduto. Qualunque differenza, 404, risposta non valida, errore o lease non attivo => `RemoteWriterLost`. Non usare la sola proprietà della vecchia sessione come attestazione del rinnovo.
3. Con ACK del PATCH perso *dopo* l'effettivo aggiornamento GitHub, una nuova lettura con HEAD identica è una conferma idempotente: ritornare l'handle aggiornato. Con errore *prima* dell'aggiornamento, 409/422 o HEAD estranea, fallire chiuso e lasciare che `writer-guard` abortisca il modello quando possibile.
4. Gli errori diversi da `RemoteWriterLost` restano immediatamente propagati. Non cambiare CAS `force:false`, né commit o lease v1, TTL 120s, heartbeat 25s, takeover 60s, controllo di clock, token, configurazione, outbox, canon o ZIP.

## Verifiche e compromessi

Vitest con mock di GitHub: PATCH 409, disconnessione prima/dopo applicazione, stessa vecchia sessione ancora attiva, SHA esatta sulla branch, normale rinnovo/release e assenza di token nelle richieste persistite. TypeScript, smoke, build, Playwright desktop/mobile e Pages sulla HEAD di `main`.

Questa misura conferma **la singola operazione di rinnovo**, non la proprietà permanente: un altro client può modificare il lock dopo la verifica. Ogni guardia AI deve ancora verificare ownership prima/dopo chiamate e checkpoint, restano finestre non atomiche e controlli non distribuiti per editor manuali. Non affermare di aver realizzato fencing transazionale o un orologio server affidabile.
