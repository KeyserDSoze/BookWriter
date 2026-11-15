# Formato portabile del libro — profili Markdown 1 e 2

**Implementazione locale 0.20.0; include le preparazioni 0.18.0 e 0.19.0, non ancora pubblicate.** Questo è un contratto dei dati, non un motore AI e non uno standard internazionale. Riprende le convenzioni di cartelle e frontmatter di [Book.Bot](https://github.com/KeyserDSoze/Book.Bot/tree/f49441134a96d8f8285d4dc6a91f5721361c2612), senza copiarne romanzo, personaggi, strumenti o workflow. Lo stesso libro può essere scritto a mano, da BookWriter o da un'altra IA. Il formato 2 aggiunge profili e review leggibili, senza cambiare il contratto di capitoli e scene del formato 1.

## Cartelle

```text
book.md
context.md                         # eventuali indicazioni aggiuntive
chapters/
  001-arrivo/
    chapter.md
    001-il-molo.md                 # una scena narrativa, detta anche paragrafo
    002-la-nave.md
characters/mara.md
locations/porto.md
factions/*.md
items/*.md
secrets/*.md
secrets/reveal-plan.md             # piano delle rivelazioni, non inferito
timeline/events.md
timelines/timeline-*.md            # timeline strutturate (formato 2)
events/*.md                        # eventi della knowledge base (formato 2)
state/current.md
guidelines/style.md                # oppure guidelines/writing-style.md
reviews/synopsis.md                # sinossi del libro, se disponibile
reviews/summary-001.md             # sintesi del capitolo, se disponibile
reviews/*.md                      # note e sinossi ulteriori dell'autore
profiles/readers/*.md              # template, non attivi per il solo import
profiles/writers/*.md
profiles/director/*.md             # linee guida del direttore, se presenti
profiles/board.md                  # cicli massimi, se meno di tre
reviews/chapters/NNN-titolo/*.md    # rapporti per tornata (formato 2)
reviews/manual/AAAA-MM-GG-id.md    # review richieste dall'autore (formato 3)
history/edits.md                   # registro leggibile delle modifiche (formato 3)
changes/*.md                       # report leggibili delle modifiche via prompt
schemas/*.schema.json              # JSON Schema generati (non Markdown)
research/private/notes.md          # esempio di cartella aggiuntiva
.bookwriter/                       # facoltativa per leggere un libro esterno
```

I numeri hanno tre cifre nei percorsi e sono interi 1–200 nei metadati. Non occorre che siano consecutivi, ma non possono ripetersi nello stesso capitolo o fra capitoli. Gli ID sono stabili: cambiare un titolo non deve cambiare l'ID. Nei file importati si conserva anche il percorso originale; per i libri nuovi il percorso viene costruito da numero e titolo. I percorsi usano lettere ASCII, cifre, trattini e underscore; i testi e i titoli possono usare Unicode.

**Queste sono cartelle base, non un elenco chiuso.** Altri Markdown, anche `chapters/001-arrivo/notes.md` o sottocartelle, sono conservati esattamente senza diventare scene, memoria o prompt. Massimo 8 componenti per percorso, 100 caratteri per componente e 300 totali; niente componenti nascosti, traversal o caratteri URL codificati. File chiamati `chapter.md` o `NNN-scena.md` sotto chapters devono seguire il contratto strutturale: percorsi ambigui sono rifiutati, non nascosti come note. La UI non è un file manager generale: puoi aggiungere i documenti nel repository esterno.

## Esempio minimo scritto a mano

`book.md`:

```markdown
---
type: book
id: book:porto
title: Il porto
language: it-IT
canon: draft
genre: mistero
---

Una navigatrice arriva in un porto sconosciuto.
```

`chapters/001-arrivo/chapter.md`:

```markdown
---
type: chapter
id: chapter:arrivo
number: 1
title: Arrivo
canon: draft
---

# Obiettivo narrativo

Presentare il porto e il problema della protagonista.
```

`chapters/001-arrivo/001-il-molo.md`:

```markdown
---
type: scene
id: scene:arrivo:molo
chapter: chapter:arrivo
number: 1
title: Il molo
canon: draft
pov: character:mara
characters:
  - character:mara
locations: [location:porto]
factions: []
---

Mara scese sul molo. Il vento era cessato.
```

`characters/mara.md`:

```markdown
---
type: character
id: character:mara
name: Mara
canon: canon
---

Una navigatrice. Qui si può scrivere liberamente la sua scheda.
```

`locations/porto.md`:

```markdown
---
type: location
id: location:porto
name: Porto
canon: canon
---

Un porto immaginario.
```

## Campi e significato

- **Libro:** `type: book`, `id: book:...`, `title`; facoltativi `language`, `genre`, `canon`, `audience`. Il corpo completo è la premessa, anche con più sezioni Markdown: non è una sintesi generata dal programma.
- **Capitolo:** `type: chapter`, `id: chapter:...`, `number`, `title`, `canon`; il corpo completo è il piano/obiettivo narrativo. `pov` e `summary` sono facoltativi.
- **Scena:** `type: scene`, `id: scene:...`, `chapter` uguale all'ID del capitolo nella stessa cartella, `number`, `title`, `canon: planned|draft|canon`. Il corpo è **solo la prosa originale**, senza intestazioni o terminatori aggiunti da BookWriter. Conserva spazi, a capo e Unicode. Una intestazione scritta dall'autore fa parte del testo.
- **Scena, facoltativi:** `pov`, `date` (stringa), `objective`, `summary`; liste `characters`, `locations`, `factions`, `items`, `secret_refs`. I riferimenti devono puntare a schede presenti con lo stesso ID, rispettivamente `character:`, `location:`, `faction:`, `item:`, `secret:`. Non vengono indovinati alias o biografie. BookWriter crea una scheda vuota quando esporta una menzione già presente nei suoi metadati ma senza scheda in memoria: nessuna informazione narrativa viene inventata.
- **Schede:** `type: character|location|faction|item|secret`, `id` con il prefisso corrispondente e `name` (accettato anche `title`); corpo libero, importato nella memoria della categoria. I nomi devono essere univoci nella categoria.
- **Stato e cronologia:** il corpo di `state/current.md` è lo stato corrente; quello di `timeline/events.md` viene conservato come una voce Markdown della timeline. Nuove timeline generate da BookWriter sono liste leggibili. Si legge anche il vecchio `timelines/main.md`.
- **Riassunti:** `reviews/synopsis.md` contiene il riassunto del libro; `reviews/summary-NNN.md` ha `type: chapter_summary`, `chapter: chapter:...` e corpo uguale al riassunto del capitolo. Il medesimo riassunto può essere nel frontmatter `summary` del capitolo, ma se entrambi sono presenti devono coincidere. Le scene hanno `summary` facoltativo nel frontmatter. Non si chiamano modelli per creare riassunti mancanti.

### Profilo YAML ammesso

Frontmatter UTF-8 delimitato da `---`, campi semplici, stringhe nude o quotate, numeri, booleani, `null` e liste di stringhe, in linea o come `  - valore`. Le stringhe quotate da BookWriter usano la sintassi JSON, che è anche YAML valida. Per caratteri speciali, `#` o `: ` usare le virgolette; niente commenti a fine valore. Sono ammessi commenti su una riga separata. CRLF è accettato; la prosa non viene normalizzata.

**Non è un interprete YAML generale:** niente oggetti annidati, tag, anchor, alias, chiavi duplicate o `__proto__/constructor/prototype`. Testi lunghi e strutturati vanno nel corpo Markdown, non in oggetti di frontmatter. Un formato non supportato dà errore, non viene reinterpretato o troncato. `type: paragraph` e `viewpoint` sono alias di lettura legacy; le nuove scritture usano `scene` e `pov`.

Questa regola vale per i documenti core e il caricamento esplicito dei template. Documenti in cartelle estese non strutturali sono invece **opachi**: il loro eventuale YAML annidato è conservato come testo, senza essere interpretato o attivato. Un file nuovo non ottiene semantica dal solo `type` scritto nel suo corpo.

### Profili e rapporti — formato 2

`profiles/readers/` e `profiles/writers/` contengono i template leggibili; `reviews/chapters/` contiene rapporti aggregati per tornata, con il giudizio quando presente. Il JSON resta necessario per il recupero lossless delle strutture operative. Importare questi Markdown non crea un ciclo, un freeze o un profilo attivo. **Carica template Markdown del libro** prepara una bozza nel CMS; solo un successivo **Salva profili del libro** confermato la attiva. [Guida al CMS e campi dei template](editorial-profiles.md).

### Schede strutturate, eventi e timeline — formato 2

Quando il libro ha una knowledge base ([guida](narrative-workspace.md)), le schede in `characters/`, `locations/`, `items/`, `factions/` aggiungono al frontmatter campi piatti: `importance: main|secondary|minor`, `summary`, `status: draft|validated`, `version`, `aliases` (lista), un campo `attr_<chiave>` per ogni attributo (per esempio `attr_speech`, `attr_personality`) e `relations` come lista di righe `tipo | id-della-scheda | nota`. Il corpo resta lo stato nella memoria narrativa. Una scheda pianificata senza memoria ha `knowledge_only: true` e corpo vuoto: all'import non crea voci di memoria inventate.

```markdown
---
type: "character"
id: "character:elena"
name: "Elena"
canon: "canon"
importance: "main"
summary: "Investigatrice protagonista."
status: "draft"
version: 1
aliases: ["Elena Voss"]
attr_speech: "Frasi brevi, domande dirette"
relations: ["alleato | character:markus"]
---

Investigatrice, cerca il fratello.
```

Scritto a mano, le liste possono usare anche la forma `  - valore`.

Un evento in `events/*.md` ha `type: event`, `id: event:...`, `title`, `story_order` (posizione nella cronologia della storia), `narration: scene|flashback|foreshadowing|offscreen|backstory`, facoltativi `when` e `chapter`, `secret`, liste `involves` (ID delle schede), `causes` (ID di eventi precedenti), `scenes` (ID delle scene), `timelines` (ID) e `perspectives` come righe `knows|unaware|believes_false|conceals | id-della-scheda | nota`; il corpo è la sintesi. Una timeline in `timelines/timeline-*.md` ha `type: timeline`, `id: timeline:...`, `title`, `kind: global|arc|event` (al massimo una `global`), facoltativa la lista `subjects` (ID delle schede che la timeline segue, massimo 12) e la descrizione nel corpo. Gli ID già presenti nei Markdown restano stabili: BookWriter traduce relazioni ed eventi verso quegli ID. Riferimenti a schede, eventi, scene o timeline inesistenti, cause circolari e nomi duplicati **fanno fallire l'import**, senza correzioni silenziose; le schede importate hanno origine `imported`.

`changes/*.md` contiene i report leggibili delle modifiche richieste con un prompt (richiesta, piano, scene dirette/indirette, controlli locali): sono storia per chi legge, non vengono reimportati come operazioni attive. `schemas/*.schema.json` contiene JSON Schema (draft 2020-12) generati dagli stessi validatori dell'app per knowledge base, scheda, evento, timeline, profili editoriali e operazione di modifica, con `x-bookwriter-schema-version`. Servono a validare i dati con altri strumenti; non sono Markdown e non sono letti come testo del libro.

Le proiezioni del formato 2 dichiarano `markdownFormat: 2` nel manifest. Lettura e verifica delle proiezioni formato 1 e legacy restano disponibili: la sola aggiunta dei template standard non rende incongruente un vecchio export.

### Registro delle modifiche e review richieste — formato 3

Il formato 3 (`markdownFormat: 3`, quello delle nuove proiezioni) è il formato 2 più due documenti di sola lettura: `history/edits.md` (`type: edit_history`, una riga per modifica manuale o AI, dalla più recente, con elemento, campi, tipo, origine, stato di review ed eventuale richiesta) e un file per review in `reviews/manual/` (`type: manual_review`, con ambito, modalità, chi rilegge, stato, esito, elementi controllati, rilievi e correzioni), più gli schemi `schemas/book-edit.schema.json` e `schemas/manual-review.schema.json`. Le copie complete prima/dopo restano solo in `.bookwriter/project.json`. Reimportati, questi documenti restano note opache: non ricreano modifiche, stati o review.

Il controllo dello snapshot usa il formato scritto nel manifest, quindi una repository in formato 2 resta leggibile e passa al 3 al primo push. Le app fino alla 0.21 non leggono il formato 3 (si fermano senza scrivere). Indipendentemente dal Markdown, il JSON del libro dichiara `formatVersion`: un libro con una versione più recente di quella che l'app conosce non viene importato né sovrascritto.

## Importazione e modifiche esterne

In **Archivio → Trova le repository del PAT**, un `book.md` valido senza JSON viene riconosciuto come libro Markdown. Il clic **Apri o importa** legge l'albero e i blob alla stessa HEAD, valida il libro e crea una copia locale senza cambiare quelli esistenti. Il titolo non identifica il libro: un UUID locale deterministico deriva da repository, ramo e ID testuale del libro. Due importazioni della stessa origine non sovrascrivono né duplicano il record. Prima del commit la HEAD viene ricontrollata.

L'importazione tiene il libro **in pausa**. `canon` nei file non diventa un freeze BookWriter, un giudizio, un consenso AI o un'autorizzazione di pubblicazione. Non vengono importati strumenti, workflow, impostazioni provider, consensi o conversazioni. La destinazione resta collegata alla HEAD letta, senza autosync. Il primo push esplicito può aggiungere lo snapshot BookWriter **solo dopo i normali gate editoriali** e verificando tutti gli originali; non basta il successo dell'importazione.

Se esiste `.bookwriter/project.json`, si confrontano le impronte Git dei Markdown reali con la proiezione del JSON (anche nel formato legacy). Scene aggiunte/rimosse, schede o documenti gestiti modificati producono un **blocco esplicito**, non una scelta automatica del JSON. In Archivio si può scegliere **Importa Markdown come copia separata**, con conferma: nuovo ID, nessun collegamento remoto, freeze, giudizio, audit task o consenso ereditato. Originale e GitHub restano intatti. Non è un merge o un rewind. Anche un fast-forward incongruente fallisce invece di perdere le modifiche esterne.

Se lo snapshot o il manifest è mancante/corrotto, ma `book.md` è leggibile, viene proposta soltanto la copia Markdown separata: non si dichiara riuscito il confronto né si ripristinano dati interni non verificabili.

Gli snapshot legacy senza manifest **e senza book.md** restano recuperabili come solo JSON: non esistono Markdown da confrontare e non si certifica una coerenza inesistente. Eliminare il manifest lasciando i Markdown non disabilita il controllo.

## Conservazione, riservatezza e limiti

- I documenti importati ammessi sono conservati in `BookProject.markdownSource`, inclusi nei backup ZIP e nello snapshot del libro. Le chiavi semplici aggiuntive e i documenti narrativi non mappati, per esempio una sinossi analitica in `reviews/`, sopravvivono al push; non vengono automaticamente inviati ai modelli. I documenti originali restano conservati anche quando il testo di lavoro evolve: **possono contenere vecchie versioni e note private**. Le rimozioni nel modello non fanno riapparire file narrativi vecchi.
- Solo premessa, stile, prosa e memoria mappati seguono i normali contesti per ruolo. Non ampliare i contesti dei cinque lettori ciechi. Nessun documento o nota del libro entra nel profilo cloud.
- Si leggono anche cartelle Markdown estese sicure, non file tecnici `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SYSTEM_PROMPT.md`, README/licenze/changelog, directory tools/scripts/node_modules/dist/oauth/assets, immagini o `.bookwriter/conversations`. Niente URL remoti seguiti. Gli altri file restano nel repository, senza essere importati o eseguiti. Nuove note Markdown ammesse partecipano al controllo di divergenza dal JSON, ma non diventano automaticamente istruzioni applicative.
- Massimo **1.200 documenti**, **2 MiB UTF-8 per documento**, **12 MiB complessivi** (anche per la mappa JSON degli originali), **64 KiB di frontmatter**, albero massimo 20.000 entry non troncato. Per compatibilità con il backup: corpo del piano di capitolo massimo 20.000 unità UTF-16, prosa di scena massimo 2.000.000, riassunto in frontmatter massimo 6.000. No symlink, submodule o path traversal nei documenti. Il trasporto GitHub ha una deadline totale di 20 secondi per richiesta e lettura del corpo limitata. Un rate limit o un errore interrompe l'operazione senza salvataggi parziali. Un libro grande può richiedere molte GET; non ci sono fetch o retry AI impliciti.
- I limiti del push restano **12 MiB per operazione**, includendo snapshot e originali: la duplicazione può raggiungerli prima. Nessuna cancellazione o compressione silenziosa. ZIP e repository contengono prosa e segreti in chiaro; repository privata raccomandata.
- Il collegamento a una repository vuota resta il commit tecnico neutro: questa modifica standardizza i dati, **non** pubblica bozze al collegamento e non aggira la redazione.

Test con manoscritti **sintetici** e GitHub simulato, desktop/mobile. Non è una prova di importazione dell'intero Book.Bot reale, né garantisce ogni variante YAML o l'interpretazione narrativa di un'altra IA. [ADR 0159](../ADR/0159-portable-markdown-book-contract.md) · [ADR 0161](../ADR/0161-agents-knowledge-base-and-tracked-changes.md).
