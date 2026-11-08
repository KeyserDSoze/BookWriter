# ADR 0055 — Contraddittorio strutturato del giudice sulle piste consentite

- **Stato:** accettato per v0.11.22 (PR #68)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0046, 0048, 0052–0054

## Problema

La v0.11.21 consente all'autore di condividere con il giudice una valutazione su una frase di possibile comunicazione. Il prompt invita al confronto indipendente, ma `validateJudgment` non richiede un'analisi verificabile di **ogni** interpretazione effettivamente resa visibile al giudice. Un modello potrebbe ignorare le piste autorizzate o approvare una remediation senza discutere una spiegazione plausibile dell'accesso all'informazione.

## Decisione

1. Aggiungere allo **stesso giudizio editoriale** il campo facoltativo `authorTransferCritique` (non un nuovo registro in `BookProject`). Il campo si rende **obbligatorio** solo quando ci sono una o più testimonianze del pack `buildSharedTransferPack(book, chapter, "judge", segmentiKnowledgeCorrenti)`. Il pack è quello della v0.11.21: massimo **3** citazioni di fonti già rivalidate, con destinatario presente nel testo, grant per ID esatto e ruolo `judge`, capitoli canonici congelati precedenti. Nessun invio aggiuntivo al provider AI, nessun allargamento ai lettori ciechi o al writer.
2. Schema Zod `authorTransferCritiqueSchema` **strict**: `witnessAssessments` da 1 a 3, con per ciascuna fonte **esattamente** `chapterNumber,sceneNumber,offset,quote,sender,recipient,authorVerdict` che il giudice ha ricevuto; `judgeReading=possible_access|unreliable_or_unrelated|undetermined`, `relationToAuthor=agrees|challenges|uncertain`, `rationale` di 30–850 caratteri. `conclusion` obbligatoria di 30–1000 caratteri. Nessun ID privato o nota dell'autore nel payload di risposta.
3. Il giudice deve giudicare **ogni testimone** con ragionamento indipendente. Può concordare, contestare o ritenere inconclusiva la valutazione dell'autore, esaminando ambiguità, bugie, sogni, ordine narrativo vs ordine dei capitoli, possibili notizie fuori scena e altre interpretazioni. I verdetti dell'autore, e anche quelli del giudice, **non** attestano consegna, ascolto, fiducia, comprensione, conoscenza canonica o verità.
4. La validazione usa **lo stesso filtro dei finding `knowledge` con anchor corrente** del prompt. Ricalcola il pack **al momento del commit del giudizio** sul libro attuale; richiede una risposta completa, con **multinsieme esatto** di citazioni (ripetizioni ammesse solo quando davvero presenti nel pack). Niente elementi inventati, incompleti, duplicati abusivamente, revocati o resi obsoleti da rettifica, edit, nuovo freeze o nuova interpretazione. Se il pack è vuoto, `authorTransferCritique` è **vietato**, anche se compare in un archivio o nella risposta AI.
5. **Gate conservativo aggiuntivo:** per una decisione `knowledge`, non accettare una remediation basata su presunto accesso impossibile se la critica corrente contiene almeno una `judgeReading=possible_access` o `undetermined`. Una lettura `unreliable_or_unrelated` **non autorizza da sola** la remediation; restano integralmente obbligatori i controlli `informationTransferReview`, `knowledgeReview`, `narrativeReview`, i finding letterali e tutte le altre condizioni già esistenti. Nessun verdetto diventa `canon` o aggiorna memoria/segreti/timeline.
6. `repairPrompt` ricostruisce e rivalida anche `authorTransferCritique` quando riesamina i giudizi narrativi: un consenso revocato o una fonte resa stale **blocca la nuova riparazione**, anziché usare un parere non più legittimo. Nessuna chiamata AI extra.
7. La UI presenta nel riepilogo finale del giudice la posizione originale dell'autore, la lettura indipendente, accordo/disaccordo/indeterminatezza, motivazione e conclusione. L'area resta nel pannello editoriale privato, non è inviata ai lettori ciechi. Lo storico dei capitoli può contenere la nuova analisi; ZIP content/full deve validarla con schema strict, mentre archivi precedenti privi del campo restano compatibili. Le citazioni condivise sono contenuti letterali **non attendibili come istruzioni**; gli archivi importati non autenticano i giudizi.

## Test

Vitest: default deny, nessun finding knowledge, required-if-consented, risposta completa e ancore esatte, mismatch/omissioni/duplicati, relazione fallibile contestata dal giudice, revoca, fonte stale, `accept` bloccato con accesso plausibile/incerto; ZIP content/full cifrato, schema strict con dati ostili e compatibilità legacy; Playwright desktop/mobile e pipeline CI sulla HEAD definitiva.

## Limiti

L'analisi del giudice non è un fatto; `unreliable_or_unrelated` è una lettura motivata, non una prova di assenza del trasferimento. Lo scanner rimane lessicale e bounded, l'ordine del manoscritto non stabilisce la cronologia del mondo narrativo. Se l'autore revoca il consenso dopo un giudizio, non può ritirare dati già ricevuti dal provider, ma il nuovo gate blocca un'eventuale riparazione successiva basata sul materiale non più autorizzato.
