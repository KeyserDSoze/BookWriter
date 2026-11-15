# Modifiche, review e ricerca web — guida

Questa guida descrive come modificare il libro a mano o con l'AI, come scegliere se e quando far controllare le modifiche e come permettere all'AI di cercare informazioni sul web. Decisioni e limiti: [ADR 0162](../ADR/0162-web-research-full-editing-and-author-controlled-reviews.md).

## Principio: salvare non è validare

Ogni modifica, tua o dell'AI, viene salvata subito e registrata, ma resta **«Da rivedere»** finché non scegli tu cosa farne. Nessuna review parte da sola dopo un salvataggio. Una review vale solo per la versione esatta che ha letto: se l'elemento cambia ancora, torna da rivedere.

Stati che vedi accanto agli elementi: *Da rivedere*, *Analisi in coda*, *Review in coda*, *Review in corso*, *Review superata*, *Problemi trovati*, *Review saltata*.

## Modificare a mano

- **Scene** (pagina Libro): il pulsante *Modifica* accanto a ogni scena apre l'editor di titolo, obiettivo, testo e riassunto. *Salva senza review* (o Ctrl+S) salva. Se nel frattempo la scena è cambiata (autopilot, altra scheda) il salvataggio è rifiutato e il testo che hai scritto resta lì: *Sostituisci comunque con la mia versione* lo applica dopo una tua scelta esplicita.
- **Una scena da scrivere** può essere scritta da te: diventa parte del libro e, se era la prossima che l'autopilot avrebbe scritto, la memoria narrativa si aggiorna dal tuo testo senza riscriverlo.
- **Capitoli** (scheda *Modifica* del capitolo): titolo, scopo e riassunto; aggiungi, sposta (anche in un altro capitolo) ed elimina scene; sposta, aggiungi o elimina capitoli. La struttura non si cambia mentre è in corso una revisione.
- **Schede ed eventi** (pagina Mondo): tutti i campi, relazioni, nuove schede, eliminazione; per gli eventi chi è coinvolto, cause, scene, timeline e «chi sa cosa», e le frecce per spostarli nell'ordine della storia. In *Timeline* crei, rinomini ed elimini le timeline e aggiungi eventi.

Puoi modificare anche **mentre l'autopilot lavora**: la tua modifica vince sempre. Se il modello stava lavorando su una versione ormai superata, la sua risposta viene scartata (resta nelle Attività, con i token) e il passo viene rifatto sulla versione nuova; dopo 5 ripetizioni di fila l'autopilot si mette in pausa.

**Capitoli già revisionati.** Restano congelati, così il libro va avanti, ma compaiono come *Modificato dopo la revisione*: la validazione precedente non copre più il testo cambiato finché non la rifai. I riassunti non più allineati sono segnati *da aggiornare*.

## Modificare con l'AI: due scelte

- **Modifica solo questo**: descrivi cosa cambiare (in una scena puoi anche selezionare un passaggio e chiedere di riscrivere solo quello). L'AI propone una nuova versione, che vedi come confronto (tolto/aggiunto). Niente cambia finché non premi *Applica questa modifica*; nessuna review automatica. Per un capitolo puoi cambiare i dati o il testo di tutte le scene (una chiamata per scena, ogni scena si applica o si scarta). Se l'AI cita una scheda che non esiste, la proposta è rifiutata.
- **Modifica e aggiorna il libro**: la modifica tracciata già esistente: analisi d'impatto, riscrittura delle scene collegate e nuova redazione dei capitoli toccati ([guida](narrative-workspace.md)).

## Cronologia, confronto e ripristino

Ogni elemento ha la sua *Cronologia delle modifiche*: chi l'ha fatta (manuale o AI, con la richiesta), quando, che tipo di cambiamento, stato di review, *Confronta* e *Ripristina com'era prima*. Il ripristino è una nuova modifica: la storia non si riscrive mai. Le copie più vecchie si alleggeriscono quando lo storico supera 3 milioni di caratteri (lo vedi indicato).

## La pagina Revisioni

Si apre dalla barra laterale o dal pulsante **Revisioni** nella barra di stato (anche su telefono).

1. **Modifiche da rivedere**: un elemento per riga, con stato, origine, tipo di cambiamento e *Cosa è cambiato*. Seleziona quelle da controllare insieme.
2. **Cosa fare**:
   - *Analizza impatto*: una chiamata AI che elenca le possibili conseguenze con un livello di rischio, senza controllare né cambiare il testo. Da lì puoi preparare una review sugli elementi a rischio.
   - *Review mirata*: solo gli elementi selezionati.
   - *Review estesa*: anche gli elementi collegati (scene successive, scene in cui compare la scheda, eventi dipendenti).
   - *Review completa*: ogni scena scritta del libro.
3. **Come**: *Solo controllo* (rapporto, testo invariato), *Proposte da approvare* (scene corrette che applichi tu) o *Correzioni automatiche* (applicate alle scene della review, ancora da rivedere e annullabili dalla cronologia).
4. La stima delle chiamate AI è mostrata prima; per review grandi o automatiche viene chiesta conferma. *Salta la review* segna le modifiche scelte come «Review saltata».

La review la esegue l'autopilot prima di qualunque altro passo, con budget, registro e vista in diretta. Se l'autopilot era fermo, alla fine il libro torna in pausa (o completato). *Annulla la review* riporta le modifiche «da rivedere» e scarta l'eventuale risposta in arrivo.

Il verificatore usa la checklist dello scrittore e le linee guida del direttore, le scene vicine e le schede pertinenti; ogni problema su un testo cita alla lettera la scena. Una scena oltre 60 000 caratteri non viene troncata: è indicata come non controllabile. Una review superata non è un giudizio di qualità letteraria.

## Ricerca web dell'AI

In **Modelli e redazione → Ricerca web dell'AI**, per ogni libro (spenta finché non la attivi, con conferma):

- **Con che cosa cercare**: un *modello di ricerca* che naviga davvero (per esempio Perplexity Sonar, un modello OpenRouter «:online», un modello OpenAI «search»), scelto qui o nel router («Ricerca web»); oppure *Wikipedia* italiana o inglese, gratuita e senza chiave. Un modello normale non va usato: risponderebbe a memoria.
- **Chi può cercare**: ideazione e piano, scrittura, specialisti, direttore, review su richiesta. I cinque lettori ciechi e la rilettura dello scrittore non cercano mai.
- **Limiti**: domande per compito (1–6), giri di ricerca per compito (1–3), riuso dei risultati già trovati (mai, 7, 30, 90 giorni).
- **Prova una ricerca** esegue una query con le impostazioni salvate.

Quando gli manca un'informazione verificabile, il modello chiede una ricerca; l'app esegue le query, le registra e ripete lo stesso compito con i risultati, presentati come dati esterni **non verificati**. Le domande che citano i tuoi segreti non partono (filtro delle fughe evidenti, non un anonimizzatore: nomi, luoghi ed epoche possono uscire). Ogni ricerca con il modello è una chiamata AI a pagamento. Il registro (pagina Mondo → *Ricerche*) mostra domanda, motivo, compito, servizio e fonti; i risultati non diventano fatti del canone né fonti del dossier storico. Importando un libro (ZIP o GitHub) la ricerca torna spenta.

## Dove finiscono i dati

Modifiche, review, impostazioni e registro delle ricerche sono nel libro: IndexedDB, backup ZIP e `.bookwriter/project.json` su GitHub (validati con schemi rigidi all'import). Le review in corso non riprendono da un archivio importato. Nulla di questo entra nel profilo cloud.
