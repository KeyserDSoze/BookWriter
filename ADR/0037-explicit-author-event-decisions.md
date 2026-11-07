# ADR 0037 — Decisioni esplicite dell'autore sulle menzioni di eventi

- **Stato:** Accettato per v0.11.4 (PR #50)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0032 (citazioni letterali), ADR 0033–0035 (rivalidazione cross-chapter), ADR 0036 (eventi candidati)

## Problema

La v0.11.3 mostra solo frasi candidate, come «Mara consegna la chiave a Elio», senza un modo controllato per distinguere fatti narrativi voluti dall'autore da menzogne, dialoghi o ricordi inaffidabili. Promuovere automaticamente ogni menzione a «evento vero» produrrebbe falsi canon, spoiler e revisioni errate. L'autore deve poter **confermare, respingere e ritirare** una singola interpretazione in modo tracciato e invalido in caso di mutazione del testo.

## Decisione

1. `Chapter.authorEventDecisions?` è uno storico locale **append-only** (massimo 120 decisioni per capitolo). Ogni record conserva ID, scene/chapter ID, `kind`, frase esatta, offset, soggetto, dettaglio, destinatario eventuale, `verdict=confirmed|rejected|withdrawn`, motivazione di 24–400 caratteri, data, `sourceFrozenAt` e impronta dell'**intero** testo di scena. Nessun agente, estrattore o import può dichiarare una decisione senza conferma esplicita nell'interfaccia.
2. Il dominio verifica che la menzione proposta corrisponda **esattamente** a un candidato ancora estratto da una scena `canon` **congelata**. Lo storico è convalidato e limitato; un record malformato fallisce chiuso. La decisione attiva è l'ultima per scena/kind/offset/quote, solo se l'intera scena e il `frozenAt` corrispondono. La fingerprint è una **checksum non crittografica a due canali**, sufficiente a rilevare modifiche ordinarie ma non ad autenticare persone o opporsi a contraffazioni deliberate. Riaprire il capitolo rende obsolete le dichiarazioni; riconfermare richiede una nuova azione.
3. `confirmedAuthorNarrativeEvents` produce **solo le dichiarazioni positive correnti** del capitolo congelato, prive della motivazione (che può contenere dettagli riservati); lo stato è `author_confirmed_interpretation`, non evento tecnicamente attestato. I soli campioni pubblici cross-chapter delle scene precedenti possono aggiungerle ai quattro specialisti della continuità (storico solo per dossier storico) e al direttore. I cinque lettori ciechi NON ricevono dichiarazioni né note dell'autore. Le `eventCandidates` non confermate restano non affidabili e ogni finding cita sempre il segmento corrente.
4. La decisione avviene tramite consenso e motivazione espliciti, **Web Locks writer e GitHub-outbox**, CAS su `updatedAt`, transazione IndexedDB atomica per book+activity+outbox. Nessuna chiamata AI/rete immediata. Autosync disabilitato e outbox cancellata, senza pubblicare una revisione non approvata. Un semplice rifiuto di una menzione non ancora canonica non invalida capitoli. **Una nuova conferma o la revoca di una conferma** marca i capitoli successivi già scritti con `author_event_attestation`, li priva del freeze/sinossi, preserva la scena d'origine congelata e ripristina la sinossi cumulativa fino all'origine. La prima review di valle viene riaperta in pausa, non avviata automaticamente. La prosa NON viene modificata.
5. ZIP legacy sono compatibili (campo opzionale). Lo schema import è `strict` per ogni elemento, massimo 120. Le decisioni importate sono conservate nello storico con `importedUnverified=true`, e **non** diventano attive nel canone locale prima di una nuova conferma. Un ZIP non è una firma di provenienza. I futuri sync cross-device dovranno gestire versioni e conflitti di dichiarazioni senza superare questa regola.
6. UI redazione: ciascuna delle prime 30 menzioni indicizzate permette una decisione, con motivazione e conferma esplicita. Mostra stato attuale, avvertenze e storico. Non confondere la frase testuale con la sua interpretazione; proteggi running/editorial cycle e consenti rivalidazioni nell'ordine.

## Rischi e limiti

- La decisione è **un'interpretazione dichiarata dall'autore**, non prova crittografica di identità, autenticità storica, correttezza psicologica o assenza di errori. La fingerprint non è una firma e un backup modificato ad arte può contenere dichiarazioni false: gli import sono perciò non verificati e richiedono una nuova conferma locale.
- Un evento confermato non aggiorna direttamente `memory.secrets`, possesso oggetti, timeline, né crea un registro semantico completo di stati o cause. Serve da testimonianza umana attiva per future review; un motore di stato canonico richiederà ADR separate e controlli sulle inferenze. Possibili menzioni fuori dalle prime 30 non sono ancora attestabili via UI finché non esiste paginazione.
- Motivazione autore non viene inviata ai modelli in `confirmedAuthorNarrativeEvents`; tuttavia lo storico rimane parte del libro e potrebbe essere incluso in un backup o repository GitHub autorizzati. Non copiare segreti non necessari nel campo motivazione.
- L'azione di conferma di una fonte nel primo capitolo può invalidare molte review: è un costo prevedibile, non una correzione automatica. Il controllo budget e l'avvio manuale della redazione restano obbligatori.

## Gate

Vitest: conferma, rifiuto, revoca e storico append-only, citazioni e fingerprint, re-freeze e modifica laterale, non-leak delle motivazioni, controllo Web Locks/CAS/outbox, conservazione del freeze sorgente, rewind di valle, ZIP che rende non affidabili le dichiarazioni importate. Playwright desktop/mobile: consenso autore, marker di valle e assenza di rete. `npm ci`, TypeScript, Vitest, smoke, build, Playwright sulla HEAD PR prima del merge; poi CI su main, Pages e cleanup sul commit di merge.
