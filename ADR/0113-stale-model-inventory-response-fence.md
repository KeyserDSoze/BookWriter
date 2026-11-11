# ADR 0113 — Fencing delle risposte del catalogo modelli dopo modifiche locali

- Stato: accettato
- Data: 2026-11-11
- Issue: #119, epic #6
- Ambito: SPA locale; lettura esplicita `GET /models`, senza modifiche al canone o ai segreti persistiti

## Contesto

La #118 ha limitato e convalidato i cataloghi restituiti dai provider, ma il callback di `App.discoverModels` conserva un vecchio `EndpointProfile` durante `await decryptLocal` e `await fetchModels`. Dopo modifica di `baseUrl`, chiave o modelli manuali, la risposta vecchia potrebbe ancora aggiornare `endpoint.models` del profilo attuale. Anche due click consecutivi possono terminare fuori ordine.

## Decisione

1. Catturare al click **l'istanza corrente** del profilo e la credenziale draft in sola memoria. Ogni modifica locale del profilo React genera un oggetto nuovo: un ID uguale non costituisce una prova di continuità. La credenziale draft deve risultare invariata. Non scrivere stringhe di chiavi in log, storage aggiuntivo, query URL o audit.
2. Numerare monotonicamente, per endpoint e per scheda, i click `Leggi /models`. Una risposta può committare solo se il numero coincide con quello dell'ultimo click per il medesimo endpoint e se il profilo originario risulta ancora corrente.
3. Usare un wrapper sincrono per gli update di `settings` e `keyDrafts` che mantiene due ref React aggiornati **prima** del batch di rendering. Dopo ogni `await` potenzialmente significativo rivalidare la richiesta contro i ref. Nessuna funzione di aggiornamento React effettua notifiche, fetch o side effect; la modifica finale viene composta prima del setter, senza gap `await` tra gate e commit.
4. Su risposta obsoleta non cambiare modelli, modello globale, attività o credenziali: mostrare un avviso italiano se è ancora l'ultima richiesta. Risposte di richieste più vecchie sono ignorate senza sovrascrivere l'avviso della nuova. Nessun retry implicito.
5. Conservare l'inserimento manuale. I modelli sono dati informativi non una garanzia di chiamabilità. Non aggiungere backend, sincronizzazione automatica multi-tab o funzionalità di ricerca senza consenso.

## Prove e limiti

Vitest: snapshot valido, draft cambiato, ID inalterato ma profilo sostituito, rimozione e numerazione. Playwright desktop/mobile: endpoint e chiave cambiati con risposta in ritardo, rimozione, cataloghi concorrenti e modelli inseriti manualmente. Anche su risposta 200 nessun risultato stale deve sovrascrivere lo stato.

La protezione è **intra-tab**, non una transazione distribuita con IndexedDB o impostazioni su altro dispositivo. Il controllo a oggetti immutabili dipende dall'invariante che le mutazioni delle impostazioni passino da `setSettings` e sostituiscano il profilo modificato; evitare in futuro la modifica diretta di oggetti React. Il backend del provider resta non attendibile come in #118.
