# ADR 0062 — Filtri consultivi sulle serie di differenze editoriali

- **Stato:** accettato per v0.11.29
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0056–0061

## Contesto

La v0.11.28 mostra fino a 12 serie del registro cronologico, scelte per osservazione più recente. Una serie ambigua o con suggerimento riformulato può essere più vecchia delle prime 12 pur trovandosi nel campione di 240 occorrenze. Filtrare soltanto le 12 già visibili nasconderebbe un controllo che l'autore intende esaminare.

## Decisione

1. Introdurre `EditorialLedgerFocus = all | ambiguous | moved | reworded | unobserved | unverifiable` come parametro **opzionale** di `buildEditorialDiffLedger`, con default `all` retrocompatibile. Nessuna proprietà persistita nei dati dei libri e nessun nuovo canale AI.
2. Prima raccogliere al massimo **240 candidati più recenti** nello stesso ordine v0.11.28; costruire le serie con lo stesso fingerprint scena/categoria/quote. Calcolare le condizioni del focus su **tutte** le osservazioni della serie selezionata, prima di visualizzarne le ultime otto. Applicare il focus **prima** del limite di 12 serie visibili, senza ripescare dati fuori dai 240 candidati. Conservare l'ordine per osservazione più recente e la semantica di ambiguità già stabilita.
3. `ambiguous` considera soltanto ripetizioni nella medesima fonte/tornata; `moved` richiede un confronto letterale non ambiguo con offset/segmento diverso; `reworded` richiede parole `missingEvidence/nextCheck` differenti su confronto attendibile; `unverifiable` segnala un archivio incoerente o un giudizio corrente non rivalidato. Non confondere un giudice assente con giudizio falsificato.
4. `unobserved` segnala soltanto serie prive di match nei **gruppi correnti effettivamente campionati**, e soltanto se il ciclo è attivo, appartiene allo stesso capitolo e questo non è frozen. Se non ci sono report, significa soltanto campione vuoto, non assenza nel manoscritto. Nessuno di questi focus produce `resolved`, autorizzazione di repair, voto sul canone o tracciamento semantico.
5. Conservare `totalThreads` come totale delle serie nel campione, distinguendo `matchingThreads`, `filteredOutThreads` e `omittedThreads` (matching oltre 12); mantenere invariati gli altri contatori di omissioni e report fuori campione. Le opzioni senza corrispondenze spiegano che zero non prova risoluzione.
6. UI con select nativa accessibile nella regione **Registro differenze editoriali capitolo N**, stato descrittivo e nessuna azione di scrittura. Lo stato del filtro è effimero in React e non entra in IndexedDB/ZIP/GitHub, AI prompt, log o API. Privacy delle scelte `editorialVerificationChoices` e gate `validateJudgment` invariati.

## Verifiche e limiti

Vitest per compatibilità della vista `all`, vecchi giudizi stale, cambi di parola, citazioni spostate, filtro su serie ambigua fuori dalle prime 12, privacy e freeze. Playwright desktop/mobile per filtro delle serie congelate, riformulazione e citazione non osservata. CI TypeScript, npm lock, smoke, build ed e2e.

**Limite:** è una navigazione su campione testuale e sui giudizi fallibili. Non è una verifica semantica delle contraddizioni, una lista di fix accertati o una ricerca nello storico completo.
