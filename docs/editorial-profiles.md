# Lettori, scrittore e direttore: gli agenti del libro

**Preparazione locale 0.20.0, non pubblicata.** Apri il libro e poi **Modelli e redazione → scheda Redazione** (pannello «Lettori e scrittore del libro»). Il pannello ha quattro schede: **Scrittore**, **Lettori**, **Direttore** e **Ciclo**. In alto il flusso mostra in ordine chi scrive, chi rilegge, chi decide e quanti cicli sono ammessi; il segno **Modifiche non salvate** ricorda che le bozze non sono ancora attive.

## Parti dal workflow esistente

Senza personalizzazioni restano i cinque lettori attuali: genere, generalista, critico/scettico, relazioni, misteri/promesse. La redazione completa conserva sette specialisti più cinque lettori; quella leggera conserva la sua composizione standard. Non serve creare uno scrittore per ottenere il comportamento precedente.

Puoi modificare nome e template dei lettori, aggiungerne fino a **dieci**, rimuovere quelli aggiunti o disattivarli. I cinque lettori standard non si eliminano: si modificano o si disattivano (se in un libro ne manca uno, torna disattivato). Almeno uno deve restare attivo. Il panel personalizzato si usa sia nella valutazione iniziale delle idee sia nei nuovi cicli dei capitoli. In modalità leggera i lettori personalizzati attivi **non sono ridotti a uno**: considera le chiamate aggiuntive.

## Scegli lo scrittore

1. Premi **Aggiungi scrittore**. Puoi conservarne fino a **sei**, ma se ne usa soltanto uno alla volta.
2. Cambia nome e **Prompt di scrittura**. Per esempio:

   > Mostra attraverso gesti, azioni e dialoghi. Evita spiegazioni ridondanti e dettagli senza funzione. Non aggiungere informazioni solo per spiegare tutto; conserva però ciò che serve a capire la scena.

3. Scegli **Forza del criterio**: **Flessibile**, **Bilanciata** oppure **Vincolo forte**. È un'indicazione al modello, non una garanzia automatica di qualità.
4. Scrivi un distinto **Prompt di revisione dello scrittore**, per esempio:

   > Individua spiegazioni superflue ed emozioni dichiarate invece di mostrate. Cita il passaggio preciso e valuta se serve nel contesto. Non chiedere tagli per semplice gusto personale.

5. Se vuoi una chat di rilettura aggiuntiva per ogni segmento, attiva **Aggiungi la rilettura indipendente dello scrittore**.
6. Seleziona il profilo in **Scrittore da usare**. Gli altri rimangono nella libreria del libro senza essere inviati ai modelli.

Il prompt di scrittura guida stesura, controllo di scena e revisione. Il giudice e le correzioni editoriali usano quello conservato nel ciclo. Il prompt di rilettura va soltanto alla nuova review dello scrittore. Scegliere **Standard — stile già indicato nel libro** non attiva nessuno scrittore, ma lascia le eventuali personalizzazioni dei lettori; **Usa workflow standard** elimina invece l'intera configurazione personalizzata, dopo conferma.

## La checklist delle regole narrative

Ogni scrittore ha una **checklist** (fino a 20 regole). Un nuovo scrittore parte con quattro regole modificabili: «Applicare rigorosamente Show, Don't Tell» (obbligatoria), «Mantenere coerente la voce dei personaggi», «Evitare ripetizioni e ridondanze», «Verificare la continuità narrativa» (consultive). Per ogni regola scrivi un'etichetta e **Come verificarla**, poi scegli **Obbligatoria** oppure lasciala consultiva.

**Nei libri nuovi** la casella *Checklist dello scrittore in ogni revisione (consigliata)*, attiva per impostazione predefinita, crea già lo scrittore «mostra, non spiegare» con la rilettura attiva e le quattro regole **tutte consultive**: rendere obbligatoria una regola (che può fermare un capitolo) resta una tua scelta. Togliendo la spunta il libro parte con il workflow standard.

- La scrittura riceve le regole da rispettare.
- La rilettura dello scrittore le verifica **una per una** su ogni segmento e registra per ciascuna *rispettata*, *non rispettata* o *non pertinente*; ogni violazione ha un rilievo con la citazione esatta del testo. Una checklist incompleta o incoerente viene rifiutata.
- Nel pannello Redazione, per ogni tornata, vedi i controlli fatti (✓, ✗, –) e i rilievi collegati alle regole.
- Se il direttore respinge la correzione di una regola **obbligatoria**, il capitolo **non** viene congelato: l'autopilot si ferma e spiega quale regola resta violata. Decidi tu: riparti con un'indicazione dal pannello Redazione oppure rendi la regola consultiva.
- Il direttore non si fida della checklist dello scrittore: per ogni regola obbligatoria verificata nella tornata deve dichiarare, motivandolo, se il testo la rispetta. Una violazione che nessuna correzione accettata risolve blocca il congelamento allo stesso modo.

Una regola obbligatoria richiede la rilettura dello scrittore: se la disattivi, le regole diventano consultive.

## Il direttore editoriale

Nella scheda **Direttore** puoi attivare **Linee guida personalizzate per il direttore**, per esempio privilegiare ritmo e tensione o respingere i rilievi di gusto. Le linee guida si **aggiungono** al contratto fisso: citazioni verificate, decisione su ogni rilievo, controllo delle fonti e regole obbligatorie restano. Le ricevono solo le chiamate del direttore.

## Il ciclo di revisione

Nella scheda **Ciclo** scegli fino a **1, 2 o 3 cicli** di revisione per capitolo (3 è il massimo e il predefinito). Se dopo l'ultimo ciclo i problemi restano, il capitolo si ferma e chiede una decisione umana: nessuna approvazione silenziosa e nessun ciclo infinito.

Ogni salvataggio assegna una **versione** agli agenti cambiati (v1, v2…), visibile nelle schede del pannello e nei file Markdown.

## Salva consapevolmente

Le modifiche sono bozze fino a **Salva profili del libro** e alla conferma. Il dialogo spiega l'invio ai provider e il possibile aumento dei costi. Il salvataggio:

- non avvia AI, non pubblica su GitHub e non riscrive il manoscritto;
- registra un'attività generica senza i template, disattiva autosync e svuota la coda pendente;
- entra nel **registro delle modifiche** del libro con la versione prima e dopo in chiaro: dalla cronologia puoi confrontarle e ripristinare quella precedente (è un nuovo salvataggio, non una review);
- rifiuta una revisione obsoleta o un writer occupato, senza perdere il testo digitato;
- è bloccato con autopilot attivo o panel iniziale delle idee già parzialmente svolto.

**Ricarica profili salvati** scarta soltanto le bozze del modulo dopo conferma. In caso di conflitto controlla la versione ricaricata prima di decidere un nuovo salvataggio; non c'è retry automatico.

Un ciclo di capitolo iniziato conserva una copia esatta dei profili, anche nelle tornate successive. Cambiare la libreria vale per le scene da scrivere e per i **nuovi** cicli, non modifica rapporti o giudizi già creati. Per una nuova review di un capitolo usa il normale percorso supervisionato di riapertura, con le sue conseguenze a valle.

## Review indipendente, non approvazione automatica

I lettori e lo scrittore-revisore vedono il proprio template e il contesto pubblico consentito, senza memoria dei segreti, dossier privati o rapporti degli altri. La rilettura è una nuova richiesta, non il seguito della chat di scrittura. Può usare lo stesso modello configurato: non certifica diversità o indipendenza semantica.

Lo scrittore-revisore usa la route **Specialisti del capitolo** (`chapterAudit`); i lettori aggiuntivi usano **Lettori del capitolo** (`chapterReaders`). Non vengono creati endpoint o modelli nascosti.

Con sei lettori e uno scrittore-revisore la redazione completa ha **14 review per segmento**, poi giudice e sinossi. Il direttore può respingere anche lo scrittore: i template non eliminano citazioni letterali, validazione, controlli di fonti/continuità, remediation approvate, nuova tornata e gate del freeze. Massimo 18 ruoli × 40 segmenti; prompt o giudizi troppo grandi fermano il task senza troncamento.

## Cartelle e template portabili

Le cartelle base non sono un limite: puoi preparare nel repository documenti come `research/private/notes.md`, `chapters/001-arrivo/notes.md` o altre cartelle Markdown sicure. Vengono conservati come dati, **non** eseguiti né aggiunti automaticamente ai prompt. Non c'è ancora un file manager generale nell'interfaccia. Vedi [contratto e limiti](markdown-book-format.md).

La proiezione formato 2 aggiunge:

```text
profiles/readers/bookwriter-<id>.md
profiles/writers/bookwriter-<id>.md
profiles/director/bookwriter-director.md   # solo con linee guida personalizzate
profiles/board.md                          # solo se i cicli sono meno di tre
reviews/chapters/NNN-titolo/archive-NNN-round-NNN.md
reviews/chapters/NNN-titolo/current-round-NNN.md
```

Un lettore ha frontmatter `type: reader_profile`, `id`, `role`, `name`, `enabled`; il corpo è il template. Uno scrittore ha `type: writer_profile`, `id`, `name`, `strength`, `selected`, `review_enabled`, `review_prompt` e, se presenti, `rules` come lista di righe `id | obbligatoria|consultiva | etichetta | come verificarla`; il corpo è il prompt di scrittura. Il direttore ha `type: director_profile` e il corpo con le linee guida; `profiles/board.md` ha `type: editorial_board` e `max_rounds`. `version` è informativa. Usa il sottoinsieme YAML documentato: stringhe semplici o quotate, non oggetti annidati. I cinque template standard sono esportati anche senza personalizzazione. I rapporti per tornata includono la checklist dello scrittore.

Importare solo Markdown **non attiva i profili** e non ricostruisce review operative dai rapporti. In CMS, **Carica template Markdown del libro** legge i documenti conservati come una bozza visibile. Controlla i testi e poi salva con conferma se vuoi usarli. Una cancellazione del dialogo non attiva nulla. JSON e ZIP conservano invece la configurazione applicativa e gli snapshot completi dei cicli; un archivio non autentica l'autore o i giudizi.

## Riservatezza e limiti

Template, rapporti e originali sono dati del libro e possono contenere informazioni riservate. Non inserire API key o PAT. ZIP e push manuali li possono divulgare, anche nella cronologia Git; usa repository private. Nessuna nuova informazione va al profilo cloud. Gli originali Markdown possono conservare versioni e note precedenti.

Restano i tetti di 1.200 documenti, 2 MiB/file, 12 MiB sorgente e 12 MiB per push, includendo snapshot/originali: le copie e gli archivi consumano spazio. Test sintetici desktop/mobile e provider simulati, non certificazione di qualità letteraria o prova su Book.Bot reale. [ADR 0160](../ADR/0160-extensible-book-folders-and-editorial-profile-cms.md) · [ADR 0161](../ADR/0161-agents-knowledge-base-and-tracked-changes.md) · [Mondo del libro e modifiche](narrative-workspace.md).
