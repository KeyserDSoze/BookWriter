# Piano delle verifiche editoriali — v0.11.24

Il piano raccoglie **senza una nuova chiamata AI** le valutazioni che il giudice critico ha già espresso sulle correzioni alternative proposte dai revisori (v0.11.23). È una **vista locale, privata e consultiva**, non una lista di attività eseguite automaticamente.

## Dove trovarlo

Apri **Redazione multi-agente → Piano verifiche editoriali** nella tornata del capitolo corrente. Un riepilogo distingue le verifiche ancora da approfondire, le correzioni approvate dal giudice, le decisioni senza modifiche e le tornate storiche. Il filtro permette di passare fra **Da verificare**, **Correzioni approvate**, **Chiuse senza intervento**, **Tornate precedenti** e **Tutte**.

Per ciascuna voce sono visibili il capitolo/tornata, la scena, la citazione letterale, i rilievi collegati e, se presenti, la **prova mancante**, il **controllo suggerito** e il ragionamento del giudice. Non viene aggiunta una nuova inferenza alla storia: questi testi provengono dai suoi giudizi esistenti.

Lo stesso piano resta consultabile anche **dopo il congelamento**: apri **Giudizi archiviati** sotto il capitolo nella lista **Stato dei capitoli**. Le voci archiviate sono marcate come *storiche* anche quando la citazione sembra ancora valida; non autorizzano mai una riscrittura.

## Cosa significano gli stati

- **In attesa del giudice**: ci sono suggerimenti diversi sulla stessa prova, ma non esiste ancora una riconciliazione. BookWriter **non** inventa prove mancanti o futuri controlli.
- **Da approfondire: prove insufficienti**: il giudice ha dichiarato `unresolved`, quindi non può approvare la riparazione del gruppo.
- **Correzione approvata dal giudice**: il giudizio completo supera di nuovo i gate sul libro corrente. Non certifica la verità della critica e **non** indica che la modifica sia già stata applicata.
- **Nessuna modifica approvata**: il giudice ha respinto le proposte del gruppo.
- **Da rivalidare**: fonte o giudizio risultano obsoleti/non autenticati; il vecchio suggerimento rimane visibile solo per consultazione, senza autorizzazione di repair.
- **Storico**: vecchia tornata, sempre consultiva e mai automaticamente corrente.

Il piano mostra **al massimo 24 voci**, con conteggio di eventuali altre voci. Espone anche i gruppi fuori campione del giudizio (massimo sei gruppi da dodici rilievi), che rimangono **bloccati per la remediation**; non significa che non esistano altre criticità.

## Scelte private dell'autore (v0.11.25)

Per una voce `Da approfondire: prove insufficienti` corrente, con autopilot in pausa e ciclo editoriale bloccato, puoi **prendere in carico**, **respingere** o **azzerare** il controllo suggerito, con motivo privato e storico. Questa scelta **non** completa la verifica né modifica il giudizio: la voce resta `needs_evidence`. Le fonti obsolete, le tornate storiche e i check modificati non riusano autorizzazioni precedenti. [Guida dettagliata](author-editorial-verification-choices.md), ADR 0058.

## Privacy e sicurezza

Non sono salvate nuove decisioni nel libro, né cambiano ZIP, IndexedDB, sync GitHub, permessi o canone. Il piano non viene inviato a nessun agente AI, nemmeno al giudice, e i cinque lettori ciechi continuano a lavorare indipendentemente. Una citazione letterale verifica soltanto che il testo compare nella fonte, non la correttezza della critica. **Il controllo suggerito non viene eseguito** senza un intervento separato dell'autore.

Riferimenti: [ADR 0057](../ADR/0057-local-editorial-verification-plan.md), [riconciliazione editoriale](editorial-recommendation-disagreements.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
