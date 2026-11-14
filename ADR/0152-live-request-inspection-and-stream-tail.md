# ADR 0152 — Ispezione della richiesta in corso e coda streaming compatta

- Stato: accettato
- Data: 2026-11-14
- Versione: 0.13.2
- Integra ADR 0134, 0136 e 0138; non modifica i gate canonici.

## Contesto

Il provider può inviare solo reasoning prima della risposta. Con ispezione disattivata i conteggi aumentano ma il testo resta nascosto per scelta di privacy. Le anteprime precedenti non seguivano la nuova scrittura; l'ispezione di un task in corso leggeva soltanto il prompt salvato all'avvio. Il riquadro fisso mostrava metadati ma non il testo.

## Decisione

1. Conservare il consenso esplicito `inspectAiRequests`, default OFF e non retroattivo. Offrire un collegamento alle impostazioni da Attività e dal riquadro compatto, senza attivarlo automaticamente. Disattivazione o cancellazione delle tracce azzerano anche i testi volatili e impediscono di registrare il resto delle richieste già partite; non ricostruire i delta precedenti riattivando il consenso.
2. In Attività, dopo **Ispeziona richiesta e risposta**, associare la lettura locale già fenced per libro/task allo stream dello **stesso** task. Prompt system/user ispezionabili, reasoning realmente trasmesso separato dalla risposta. Risposta progressiva consultabile senza ricliccare; autoscroll sospeso quando l'autore risale e riattivabile con **Segui il testo in arrivo**. L'esito dell'Activity, non il testo ricevuto, determina se la risposta è stata applicata.
3. Registrare separatamente gli stream delle richieste anticipate della redazione, senza perdere i delta quando il runner passa al revisore successivo. Cache volatile bounded degli ultimi task terminati; il riquadro globale segue solo la richiesta consumata dal runner. Nessuna condivisione degli input tra i modelli.
4. Al termine della risposta del provider salvare, con consenso, anche output non ancora validati e frammenti di richieste interrotte/fallite nello store locale `meta`, **mai in `Activity.output`**. La persistenza diagnostica finale è best-effort e non deve mascherare errore o usage del provider. Nessuna scrittura IndexedDB per singolo delta; i testi restano esclusi da ZIP/GitHub/outbox. Non garantire conservazione dei delta dopo crash prima dell'assestamento della richiesta.
5. Nel riquadro fisso: titolo del task, stato reale, contatori e ultime **cinque righe visuali** della risposta, oppure del reasoning finché non arriva risposta. Coda mobile di max 4.000 caratteri per canale, altezza max 100px e sfumatura superiore solo in overflow, senza animazioni obbligatorie. Testo come plain text, nessun HTML del provider. Link ad Attività; pannello contenuto nel viewport mobile, riducibile alla sola testata per liberare i controlli sottostanti senza fermare il runner.
6. Restano i limiti delle trascrizioni: 120.000 caratteri per system/user/risposta, 20.000 per reasoning, con avvisi espliciti. La piccola coda continua a mostrare i caratteri nuovi anche oltre quei limiti; non spacciare l'anteprima limitata per una trascrizione integrale. Il testo è disponibile soltanto nella scheda che gestisce la richiesta; nessuna trasmissione aggiuntiva tra schede o dispositivi.

## Verifiche e limiti

- Vitest: opt-in/off, identità libro/task, richieste parallele, passaggio del focus senza reset, limiti/coda, revoca, risposte JSON e parziali, nessun output canonico prematuro.
- Playwright desktop/mobile: mock SSE controllato, reasoning prima del testo, autoscroll e lettura del passato, sfumatura e cinque righe, richiesta ispezionabile prima/dopo conclusione e reload, consenso assente e revoca.
- Nessun provider fisico certificato, chiamata AI aggiuntiva, retry nuovo, token inventato, modifica a budget, lease, CAS, freeze o canone. CI/deploy restano verifiche separate.
