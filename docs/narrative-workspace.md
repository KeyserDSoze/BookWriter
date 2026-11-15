# Mondo del libro, modifiche con un prompt e consultazione

**Preparazione locale 0.20.0, non pubblicata.** Questa guida descrive le pagine **Mondo** e **Libro** e il modo in cui l'autopilot mantiene coerente il libro quando chiedi una modifica. Gli agenti (scrittore, lettori, direttore) sono in [Lettori e scrittore](editorial-profiles.md).

**Dalla 0.21.0** ogni elemento si modifica anche a mano o con «Modifica solo questo» (confronto prima/dopo, nessuna propagazione), le modifiche restano «da rivedere» finché non scegli una review nella pagina **Revisioni**, e l'AI può cercare informazioni sul web se lo consenti: vedi [Modifiche, review e ricerca web](editing-and-reviews.md). Quella descritta qui sotto è la scelta «Modifica e aggiorna il libro».

## Le schede si creano da sole

Dopo il piano dei capitoli l'autopilot fa un passo in più: **Schede narrative, eventi e timeline**. Crea personaggi principali e secondari, luoghi, oggetti rilevanti, fazioni, eventi fondamentali e una o più timeline. Le schede sono concise: contengono solo ciò che serve alla storia (funzione narrativa, personalità e motivazione, modo di parlare, background, relazioni). Durante la scrittura, dopo ogni scena, l'autopilot aggiunge schede o eventi nuovi e aggiorna quelli esistenti; ogni cambiamento crea una nuova versione e conserva la precedente. Dopo ogni scena, revisione o riconciliazione della redazione deve dire esplicitamente cosa cambia nelle schede (anche «niente»): una risposta che lo dimentica è rifiutata e ripetuta. Una scheda ancora in bozza segue la memoria narrativa; cambiare solo le relazioni crea comunque una nuova versione.

Per un libro creato prima di questa versione apri **Mondo** e premi **Genera le schede del libro**: è una chiamata AI, il testo non cambia.

Ogni scheda ha un identificativo stabile: le relazioni e gli eventi puntano all'identificativo, non al nome. Una scheda può essere **Pianificata** (non ancora nelle scene), **Scritta** o **Consolidata** (presente in un capitolo che ha superato la redazione).

### Verità e ciò che sanno i personaggi

Gli eventi distinguono ciò che accade da ciò che i personaggi sanno: per ogni personaggio coinvolto si può indicare **Sa**, **Non sa**, **Crede il falso** o **Sa e nasconde**, e segnare un evento come **Segreto**. Scrittura, specialisti e direttore ricevono queste prospettive, così un inganno voluto non viene «corretto» come errore. I cinque lettori ciechi e la rilettura dello scrittore non le vedono.

## La pagina Mondo (indirizzo `/worldbuilding`)

Una sola colonna di **sezioni chiuse** (accordion): le apri tu e il programma ricorda quali tenevi aperte, su questo dispositivo. In cima, **Cerca nel mondo** cerca in schede, eventi, memoria e modifiche: mostra e apre solo le sezioni con risultati.

- **Personaggi, Luoghi, Oggetti, Fazioni**: elenco e dettaglio su due colonne; filtra per importanza, apri una scheda per vedere attributi, relazioni (cliccabili), presenza nel libro capitolo per capitolo, eventi, stato nella memoria e versioni precedenti, oppure modificala a mano o con l'AI. Su telefono la scheda sostituisce l'elenco: **Torna all'elenco** riporta indietro.
- **Timeline ed eventi**: **Ordine della storia** (quando accadono gli eventi) e **Ordine del racconto** (come li incontra il lettore, utile per flashback e antefatti); scegli la timeline globale (una sola per libro) o un arco. Una timeline può **seguire** schede precise («Segue: …»): i loro eventi vi compaiono anche se non vi sono stati aggiunti uno per uno. Ogni evento mostra modalità, stato, coinvolti, cause ed eventi che ne dipendono, e si modifica.
- **Stato corrente**, **Cronologia della memoria** e **Memoria · Personaggi / Luoghi / Fazioni / Oggetti / Segreti**: la memoria narrativa con cui l'autopilot scrive le scene. Ogni parte e ogni voce si modifica a mano (anche i segreti, solo per te), si aggiunge ed elimina, con cronologia e ripristino. Cambiare la memoria non riscrive il testo.
- **Modifiche** e **Ricerche**: storico delle richieste con piano, controlli e ripristino; registro delle ricerche web.

### Dopo aver salvato una modifica

Sotto ogni editor (anche scene e capitoli nel Libro) compare, finché la modifica non è rivista, **Modifica salvata: non ancora rivista** con due scelte: **Rivedi e aggiorna il libro da questa modifica** (l'analisi riceve com'era prima e com'è ora, sceglie le scene da riscrivere, le riscrive e le fa rivedere, in modalità automatica o con la tua conferma; se annulli il tuo testo resta) e **Scegli una review** (apre Revisioni con l'elemento già selezionato; non per la memoria, che non ha una review propria). Nulla parte da solo.

## Cambiare il libro con un prompt

Apri una scheda, un evento, una timeline o la scheda *Modifica* di un capitolo e scrivi in **Modifica con un prompt**, per esempio:

> Elena non deve più essere fredda e razionale. Voglio che sia impulsiva ed emotiva e che reagisca prima di riflettere. Mantieni invariato il suo obiettivo principale.

Premi **Applica la modifica**. L'autopilot parte da solo e:

1. interpreta la richiesta e prepara la nuova versione della scheda;
2. cerca le scene **dirette** (citano o usano l'elemento), **indirette** (dipendono da eventi o conseguenze cambiate) e valuta se l'impatto è **globale**; ogni scena diretta è riscritta oppure dichiarata **invariata** con il motivo (se ne dimentica una, l'analisi è rifiutata e ripetuta);
3. riscrive soltanto le scene scelte, con la scheda aggiornata come riferimento e l'istruzione di non introdurre altri fatti;
4. aggiorna memoria, schede e riassunti delle scene;
5. rimanda i capitoli toccati alla redazione completa (specialisti, lettori, scrittore, direttore);
6. segna la modifica **Completata** quando quei capitoli sono di nuovo congelati.

Il banner **Modifica in corso** mostra l'avanzamento (Analisi → Riscrittura → Revisione → Completata) e il piano.

### Automatico o con conferma

In alto nella pagina Mondo scegli **Applica le modifiche: Automaticamente** (predefinito) oppure **Dopo la mia conferma**. Con la conferma l'autopilot si ferma dopo l'analisi: vedi le scene dirette, indirette, quelle da riscrivere, quelle che restano come sono e i fatti che cambiano, poi premi **Conferma il piano** o **Annulla la modifica**. Finché non decidi non cambia nulla: né la scheda, né il testo, né i capitoli congelati. Per una scena la riscrittura arriva come **bozza** da confrontare con il testo attuale: il libro cambia solo quando confermi.

### Una scena alla volta

Nella pagina **Libro** apri un capitolo, scegli **Scene**, poi **Leggi e modifica** su una scena:

> Rendi questo dialogo più teso, ma non modificare le informazioni rivelate né l'esito della scena.

L'autopilot riscrive la scena e la confronta con la versione precedente:

- **solo forma e stile**: si rivede soltanto quel capitolo; i capitoli successivi restano congelati;
- **fatti cambiati**: riscrive anche le scene successive che diventerebbero incoerenti, poi rivede il capitolo e i successivi.

Un controllo locale senza AI verifica nomi delle schede, nomi propri e numeri presenti in una sola delle due versioni: se trova differenze, la modifica è trattata come cambio dei fatti anche se il modello l'aveva giudicata di stile.

### Correggere una scheda senza riscrivere

**Modifica la scheda a mano** cambia descrizione e attributi senza toccare le scene: le prossime scene e revisioni useranno la nuova versione.

## Ripristino

In **Modifiche**, una modifica completata (o in revisione) mostra **Ripristina versione precedente**. Riporta testi delle scene, scheda (o timeline, o dati del capitolo) e memoria a prima della modifica. I capitoli il cui testo torna identico a prima ritrovano il loro congelamento e riassunto; gli altri tornano alla redazione. È possibile solo se nel frattempo scene e scheda non sono cambiate: in caso contrario il pulsante spiega il motivo e trovi comunque il **Testo precedente** da consultare. Per spazio, le copie dei testi più vecchie vengono eliminate quando superano 3 milioni di caratteri complessivi: il registro resta, il ripristino no.

## Capitoli, scene e riassunti

Nella pagina **Libro** ogni capitolo è una scheda con il suo stato (da scrivere, in scrittura, in redazione, revisione completata). Un capitolo si legge in tre modi:

- **Testo completo**: tutte le scene in ordine;
- **Scene**: per ognuna stato, riassunto, personaggi, luoghi ed eventi coinvolti (modificabili in *Chi c'è e quando*), modifiche ricevute;
- **Riassunto**: quello consolidato al congelamento del capitolo, oppure un riassunto **provvisorio** composto dai riassunti delle scene. I riassunti dicono cosa accade, non giudicano; un riassunto segnato *da aggiornare* viene riscritto dal testo prima della redazione del capitolo, mai sostituito con l'inizio della scena.

## Cosa resta nel repository

Nel formato Markdown 2 le schede restano nelle cartelle `characters/`, `locations/`, `items/`, `factions/` con i campi strutturati nel frontmatter; si aggiungono `events/`, `timelines/` (con `subjects`, le schede seguite), `changes/` (report leggibili) e `schemas/` (JSON Schema versionati). Il formato 3 aggiunge il registro leggibile delle modifiche e delle review richieste (`history/edits.md`, `reviews/manual/`). Dettagli in [formato portabile](markdown-book-format.md).

## Limiti

- Le schede, le prospettive e le analisi d'impatto sono proposte di un modello: utili, non verità certificate. La redazione e il direttore restano i controlli.
- L'indice delle presenze è lessicale e strutturale: trova nomi e collegamenti dichiarati, non significati impliciti.
- Ogni modifica costa chiamate AI (analisi, riscritture, nuova redazione); una modifica globale può costare molto.
- Il ripristino non è una transazione fra più dispositivi; valgono il blocco di scrittura e i controlli esistenti.

[ADR 0161](../ADR/0161-agents-knowledge-base-and-tracked-changes.md) · [ADR 0163](../ADR/0163-complete-reviews-living-world-and-versioned-format.md)
