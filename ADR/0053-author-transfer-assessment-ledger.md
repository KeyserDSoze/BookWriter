# ADR 0053 — Registro privato delle valutazioni autore sulle piste comunicative

- **Stato:** accettato per v0.11.20 (PR #66)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0046, 0047–0052

## Problema

La v0.11.19 trova *possibili* frasi di trasmissione fra due personaggi solo su richiesta dell'autore. Senza un registro delle letture umane, non è possibile distinguere una pista scartata, una meramente plausibile e una frase che l'autore considera una descrizione di comunicazione. Non è lecito convertire tali interpretazioni in dati canonici di conoscenza o autorizzazioni a riscrivere.

## Decisione

1. Aggiungere `BookProject.narrativeTransferAssessments?: NarrativeTransferAssessment[]` **append-only** (massimo **120**). Ogni entry conserva ID, `topicDecisionId` esatto, **ID delle due interpretazioni knowledge nell'ordine mittente→destinatario**, `candidateId` della citazione candidata, `verdict=author_attested_report|possible_path|dismissed`, motivazione privata di **20–650** caratteri e timestamp ISO.
2. `author_attested_report` significa solo che **secondo l'autore la frase racconta una comunicazione**; non certifica che sia accaduta, ascoltata, compresa, creduta, cronologicamente precedente né che la notizia sia vera. `possible_path` conserva un dubbio e `dismissed` registra la pista scartata. Nessuna modalità crea una comunicazione canonica.
3. Per creare una decisione occorrono `same_information` **diretto e corrente**, due conoscenze `knowledge_mention affirmed` correnti e la citazione **esatta** ancora restituita dal `previewKnowledgeTransferForPair` per quella direzione, con capitolo canonico congelato, offset, stamp e limiti dello scanner v0.11.19. Niente scelta su mere somiglianze, link `different_information`, record importati non verificati, piste escluse dal campionamento o ID inventati.
4. `buildNarrativeTransferAssessmentRegistry(book, topicDecisionId)` è **last-wins per quadrupla esatta** (topic, mittente knowledge, destinatario knowledge, candidato) anche in presenza di record obsoleti; non fa risorgere valutazioni precedenti. Rettifiche, riaperture, edit di prosa, atti knowledge sostituiti o link topic invalidati rendono la decisione solo **storica**. Non viene fatta chiusura transitiva né dedotta una relazione di apprendimento.
5. UI nel pannello **Piste comunicative della coppia**, solo dopo click dell'autore sulla preview: per ogni citazione propone **Valuta questa pista**, tre classificazioni non preselezionate, motivazione obbligatoria, conferma esplicita con avviso su ZIP/GitHub manuale. Mostra valutazione corrente e storico delle rettifiche anche obsolete; nessuna nuova ricerca esterna.
6. `recordNarrativeTransferAssessment` usa Web Locks writer/outbox, CAS `updatedAt`, impedisce salvataggi con autopilot o ciclo editoriale in esecuzione, transazione `books+activities+outbox`, disabilita autosync e svuota outbox. **Nessun nome, testo, verdict, fonte, segreto o motivazione** nei log/activity. Un annullamento o conflitto non produce effetti parziali.
7. **Privacy:** i nuovi dati rimangono **esclusi dai prompt di tutti i 12 revisori, giudice, scrittore, riparatore e condivisione knowledge precedente**, anche dove sia presente opt-in v0.11.15. Un nuovo consenso specifico e una nuova ADR sarebbero richiesti per usarli con AI. Nessun HTTP/AI nuovo. Nessun effetto su freeze, canone, memory, segreti, timeline, prospetti di costo o automatic repair.
8. ZIP content/full deve includere lo storico con schema **strict** per enum, ID, lunghezze, date e cap120; archivi precedenti privi del campo restano importabili. Le fonti **sono sempre rivalidate**: un archivio non autentica le affermazioni dell'autore. Manual push GitHub e ZIP potrebbero diffondere spoiler; avvertire l'utente.

## Limiti

Il segnale è confinato ai candidati **lessicali, bounded e nell'ordine del manoscritto** già disponibili: non dimostra cronologia della finzione, comunicazioni implicite, intenzioni o la verità del messaggio. Il giudizio dell'autore è distinto dal canone e dalle verifiche fallibili degli agenti. Una decisione su una citazione non si trasmette automaticamente ad altre citazioni/scene o personaggi.

## Verifiche

Vitest su identità/direzione/fonte corrente, last-wins, staleness, limiti, privacy; test applicazione con Web Locks/CAS/outbox, backup ZIP content/full cifrato e input ostile, Playwright desktop/mobile con scelta, salvataggio, rettifica, reload e nessuna chiamata AI/GitHub. Typecheck, smoke, build e CI PR sulla HEAD definitiva, poi Pages/CI `main` e cleanup separati.
