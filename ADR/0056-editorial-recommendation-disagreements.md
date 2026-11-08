# ADR 0056 — Divergenze tra raccomandazioni editoriali: riconciliazione critica

- **Stato:** accettato per v0.11.23 (PR in preparazione)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0045–0046, 0052–0055

## Problema

La redazione multi-agente produce report indipendenti e il giudice può accettare o respingere ogni finding. Due revisori possono però proporre **rimedi diversi per l'esatta stessa citazione** e il giudice non è ancora obbligato a riconciliare esplicitamente le opzioni. L'assenza di rilievi da parte di un altro revisore **non** equivale a un voto contrario: ha visto il testo con un compito diverso. Nemmeno due rimedi differenti attestano automaticamente un conflitto di fatto.

## Decisione

1. `buildEditorialRecommendationDisagreements({reports},chapter)` raggruppa solo finding **con evidenceAnchor attualmente validata**, di **ruoli differenti**, sulla stessa scena, indice segmento, offset, citazione esatta (NFC) e **categoria letterale** casefold. Sono pertinenti soltanto gruppi con almeno **due remediation differenti** dopo la normalizzazione di spazi e maiuscole. Un report `pass` non conta come opposizione, sinonimi/alias non generano gruppi, e la presenza di un gruppo **non** prova incompatibilità semantica.
2. Solo i primi **6 gruppi** di massimo **12 finding ciascuno** vengono presentati al giudice; ordinamento deterministico per segmento, scena e ID. Il report dichiara `omittedGroupCount`, `oversizedGroupCount` e `unreviewableFindingIds`. Tutte le `accept` riferite ai finding dei gruppi non analizzati sono **bloccate**; non è consentito inferire che nessun gruppo esista nel resto del capitolo o approvare silenziosamente un caso fuori campione.
3. Aggiungere al **giudizio editoriale**, senza nuovi permessi e senza nuovo campo top-level nel libro, `recommendationReconciliations?` con 1 voce **per ciascun gruppo** effettivamente mostrato (min2/max12 ID di finding esatti, schema Zod **strict**, massimo6). `resolution=choose_one|reject_all|compatible_changes`; `evidenceAssessment=adequate_for_selected_edits|unresolved`; `rationale` 30–850 caratteri, `missingEvidence` e `nextCheck` 24–600 ciascuno.
4. Le scelte devono corrispondere alle decisioni reali del giudice: `choose_one` esattamente 1 `accept`, `reject_all` 0, `compatible_changes` almeno 2. Se `unresolved`, 0 `accept`, in ogni caso. Il giudice deve spiegare come interpreta le **alternative proposte**, quali prove *mancano* e quale controllo umano o testuale futuro potrebbe risolvere il dubbio. Il campo `nextCheck` è **solo una proposta**, non un'esecuzione automatica né una nuova chiamata AI. Ogni `accept` resta vincolata ai gate preesistenti (ancore narrative, conflitti, knowledge, fonti storiche, privacy, testimoni e authorTransferCritique).
5. `adjudicationPrompt` presenta esclusivamente questi gruppi limitati come **dati narrativi non attendibili**, non come istruzioni né come confronto fra ruoli ai fini di un voto. `validateJudgment` ricalcola i gruppi sul capitolo **corrente**, esige copertura completa e gruppi/ID identici (ordine degli ID irrilevante), e vieta il campo se i gruppi non esistono o sono diventati stale. Un report importato non autentica il giudice o la prova.
6. `repairPrompt` ricalcola e revalida la riconciliazione salvata anche per rilievi **di stile o voce** (non soltanto `narrativeConflict`), così editing del testo, modifica dei report, resume o ZIP non permettono di aggirare il gate durante una riparazione successiva. Il giudice non autorizza nuove mutazioni a memoria, timeline, segreti o canon automaticamente.
7. Nel pannello **Redazione multi-agente** si vedono per ogni gruppo la stessa fonte letterale, i ruoli, le diverse proposte, il ragionamento del giudice, la prova mancante e il controllo suggerito. Anche prima del giudizio si vedono le opzioni da confrontare. Se la copertura è parziale si presenta un avviso e si blocca la remediation di quei finding. Un archivio ZIP content/full valida il nuovo campo strict nei giudizi attivi e archiviati; gli archivi legacy rimangono compatibili.
8. Non cambiano il numero di revisori, il principio di lettura cieca, i consensi di condivisione delle conoscenze, le chiamate AI o HTTP, la raccolta e la persistenza dei segreti, la cronologia o i criteri di freeze. La nuova struttura incrementa il testo della **chiamata già prevista al giudice**; non fornisce nuovi segreti ai cinque lettori ciechi. I testi dei revisori sono dati non attendibili come istruzioni.

## Verifiche

Vitest su raggruppamento letterale senza falsi dissent, selezione `choose_one`, `reject_all`, `compatible_changes`, insufficienza delle prove, input duplicati/ostili, fonti stale, overflow e validazione prima del repair; ZIP content/full cifrato strict e legacy; Playwright desktop/mobile su visualizzazione delle alternative e del controllo mancante, CI build/typecheck/smoke completa.

## Limite

Il confronto **non** dimostra che due agenti abbiano opinioni opposte sul medesimo fatto: osserva soltanto rimedi diversi che condividono la stessa prova. `missingEvidence` e `nextCheck` sono spiegazioni fallibili del giudice, non un elenco di obblighi o prove del canone.
