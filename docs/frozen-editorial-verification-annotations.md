# Annotazioni sui controlli dei capitoli congelati — v0.11.26

BookWriter conserva le valutazioni del giudice anche dopo il congelamento di un capitolo. Ora puoi aggiungere **una nota privata dell'autore** sui controlli storici per i quali il giudice aveva dichiarato **prove insufficienti**. Non devi riaprire la redazione per annotarli.

## Dove si trova

Apri il libro, entra in **Redazione multi-agente → Stato dei capitoli**, espandi il capitolo e scegli **Giudizi archiviati**. Nel **Piano verifiche editoriali** apri una voce contrassegnata **Storico: non autorizza interventi**. Quando il suggerimento è strutturalmente coerente e il giudice aveva lasciato il dubbio irrisolto, compare **Annotazione storica dell'autore**.

Con autopilot fermo e nessun ciclo editoriale attivo, inserisci una motivazione privata di 20–500 caratteri. Puoi **Prendere in carico**, **Respingere il suggerimento** o **Azzerare una scelta precedente**. Ogni operazione richiede conferma; le decisioni vengono registrate nello storico, senza cancellare le precedenti.

## Che cosa fa (e non fa)

- La nota **non** cambia lo stato storico del controllo e **non** riapre il capitolo. Anche dopo una presa in carico resta `archived` e non diventa una remediation approvata.
- Non esegue verifiche, ricerche web o richieste AI, non modifica scene, timeline, memoria, segreti o prosa.
- Sono annotabili solo controlli con `unresolved`, `reject_all` e finding effettivamente collegati alla stessa prova archiviata. Un report legacy senza prova o un giudizio approvato rimane consultabile ma **non** annotabile.
- Le vecchie decisioni sono legate alla **specifica congelazione**, non solo al numero della tornata: dopo riapertura e nuovo freeze o modifica del suggerimento, l'annotazione precedente **non** torna attiva per errore.
- Il piano mostra massimo 24 voci e indica eventuali omissioni: l'assenza di un controllo visualizzato non dimostra che il capitolo sia privo di problemi.

## Privacy e backup

Si riusa il registro privato `editorialVerificationChoices` (massimo 160 voci). Il salvataggio usa Web Locks e verifica che il libro non sia cambiato, disattiva l'autosync GitHub, cancella la coda e registra soltanto un'attività generica senza contenuti del romanzo o scelte. Non invia note ai dodici agenti revisori, al giudice, al writer o alla riparazione.

I backup ZIP content/full, anche cifrati, conservano le note. **L'import azzera sempre le scelte ancora attive**, perché un archivio non autentica chi le abbia scritte. ZIP e push manuali possono comunque contenere spoiler.

**Questa funzionalità registra soltanto intenzioni o valutazioni private su vecchi suggerimenti.** Per riaprire, correggere o verificare nuovamente un capitolo, occorre il flusso editoriale separato già esistente.

Riferimenti: [ADR 0059](../ADR/0059-frozen-editorial-verification-annotations.md), [scelte correnti](author-editorial-verification-choices.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
