# ADR 0166 — Rinnovo del blocco: lettura in ritardo e perdita davvero avvenuta

- Stato: accettato, preparazione locale
- Data: 2026-11-17
- Versione preparata: 0.30.0
- Integra ADR 0007 (writer lease), 0076 (rinnovo attestato dal commit esatto) e 0164.

## Problema

A fine di un compito dell'autopilot, durante una redazione lunga, è comparso: «Rinnovo del lease GitHub non confermato: scrittura sospesa. Il ramo non punta al commit richiesto». Il rinnovo scrive un commit sul ramo `bookwriter-lock/<libro>` con `PATCH force:false` e poi rilegge il ramo: se non vede esattamente quel commit (ADR 0076) il lavoro si ferma e la richiesta AI in corso viene abortita (e può essere addebitata). Il messaggio non diceva cosa era stato letto, e copriva due situazioni molto diverse:

1. **un'altra sessione ha preso il blocco** (un altro browser o dispositivo scrive lo stesso libro): perdita vera, si ferma;
2. **GitHub accetta il PATCH ma la lettura subito dopo mostra ancora il commit precedente** (ritardo di lettura dopo scrittura, breve e raro): non si è perso nulla, il blocco è ancora nostro.

Con un solo caso sporadico non si può dire quale dei due sia accaduto; il codice però non poteva distinguerli e abbatteva il lavoro in entrambi.

## Decisioni

1. **Si rilegge, non si riscrive.** Dopo un PATCH *accettato*, se la lettura mostra la nostra sessione con un commit diverso, si ripete la sola lettura fino a tre volte (0,6 s, 1,5 s, 3 s; `leaseTuning.readbackDelaysMs`). Mai un secondo PATCH, mai `force`. Se la lettura mostra un'**altra sessione** non si aspetta: è una perdita.
2. **Un rinnovo non confermato non è un rinnovo riuscito, ma può non fermare il lavoro.** Se dopo le riletture il blocco è ancora della nostra sessione, `active` e con più di 50 secondi di validità, `renewWriterLease` lancia `LeaseRenewalMissed` (sottoclasse di `RemoteWriterLost`) con l'handle del blocco com'è (scadenza **vecchia**: nulla è dato per esteso). `withWriterGuard` lo tollera, tiene quell'handle e riprova al battito successivo (25 s). Le verifiche prima e dopo ogni chiamata AI (`assertWriterLease`) restano identiche. Con meno di 50 secondi di validità, o per qualunque altro esito, è `RemoteWriterLost` e il lavoro si ferma come prima. Un altro dispositivo può subentrare solo a scadenza + 60 s: con questa soglia ne restano almeno 110 s di margine.
3. **Il messaggio dice cosa è stato letto** (senza credenziali, solo identificativi accorciati): «il blocco è passato a un'altra sessione (xxxxxxxx, rinnovato alle HH:MM:SS)…», «il ramo mostra ancora il commit precedente (abc1234 invece di def5678) dopo N letture; il blocco è ancora tuo fino alle HH:MM», «rilasciato», «scaduto», «il ramo non esiste più». Gli errori del PATCH (409/422/rete) restano come prima: nessuna tolleranza, nessuna rilettura ripetuta.

## Cosa non cambia

Fast-forward `force:false`, conferma esatta del commit quando la lettura è coerente, controllo del clock, TTL 120 s, battito 25 s, margine di 60 s, recupero esplicito, sostituzione immediata del proprio blocco (ADR 0164).

## Limiti

- Non è provato che il caso dell'autore fosse una lettura in ritardo: senza il messaggio nuovo non si può saperlo. Se compare «passato a un'altra sessione» un altro browser o dispositivo sta davvero scrivendo il libro (ad esempio una pagina vecchia rimasta aperta altrove).
- Una lettura in ritardo che dura oltre ~5 secondi e un blocco con meno di 50 secondi di validità fermano comunque il lavoro.
- Provato con GitHub simulato (letture in ritardo, scrittura estranea subito dopo il rinnovo, scadenza vicina), non con GitHub reale.

## Verifiche

Vitest: lettura in ritardo risolta rileggendo (un solo PATCH), lettura che resta indietro con blocco valido (`LeaseRenewalMissed`, handle con scadenza vecchia, battito successivo riuscito), altra sessione (nessuna attesa, messaggio, `assertWriterLease` fallisce), blocco vicino alla scadenza (perdita); guardia: il rinnovo mancato non abortisce il lavoro e il battito dopo lo conferma, un blocco perso abortisce la richiesta in corso. Verificato che togliendo la tolleranza o le riletture i test falliscono.
