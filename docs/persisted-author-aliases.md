# Registro degli alias motivati — v0.11.8

Le annotazioni sui nomi narrativi possono ora sopravvivere al reload, **senza diventare parte del canone**. Apri un libro con almeno due attestazioni narrative correnti, poi **Redazione multi-agente → Indice eventi candidati → Tracce di continuità da verificare**.

1. Scegli due nomi diversi fra quelli individuati nelle attestazioni dell'autore ancora valide.
2. Scrivi una motivazione di **12–500 caratteri** nella casella «Motivazione decisione alias».
3. Premi **Registra legame motivato** o **Escludi legame motivato**, poi conferma il dialogo. Le due operazioni scrivono sempre una nuova riga nello storico; non cancellano decisioni vecchie.
4. Apri **Registro alias motivati** per vedere collegamenti ancora attivi, esclusioni e audit superati. Le piste con legame registrato mostrano l'etichetta «Alias motivato in registro» e la ragione dell'autore.

Ogni decisione è vincolata agli ID di **due attestazioni specifiche** (citazioni di scene canoniche in capitoli congelati). Se una delle attestazioni viene respinta, rettificata, la scena cambia o il capitolo viene riaperto/ricongelato, il legame non è più corrente; la vecchia interpretazione non può ritornare valida da sola. L'ultima decisione su una coppia di nomi prevale, anche quando diventa storica.

Al salvataggio la sincronizzazione GitHub automatica viene **disabilitata** e la coda svuotata. La decisione è locale finché l'autore non esegue volontariamente un export o sync. Gli ZIP contenuto/completi salvano lo storico con validazione rigorosa e senza credenziali nel contenuto; gli import non autenticano l'autore.

I confronti storici mantengono priorità alle menzioni di un **identico nome letterale**; le coppie alias motivate sono aggiunte soltanto negli slot residui (massimo 40 piste con omissioni dichiarate). Un'anteprima temporanea rimane distinta e non sostituisce la registrazione motivata. Le coppie sono indipendenti, non viene dedotta una catena A=B=C.

**Nessuna identità canonica, segreto, inventario, timeline o scena viene modificata.** L'app non conosce automaticamente chi è davvero una persona in un romanzo e non trasmette questi audit ai 12 agenti: per la verità narrativa serve la revisione critica e il consenso dell'autore.

Riferimenti: [ADR 0041](../ADR/0041-persisted-anchored-author-aliases.md), [anteprima alias](explicit-alias-preview.md), [decisioni sugli eventi](narrative-event-decisions.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
