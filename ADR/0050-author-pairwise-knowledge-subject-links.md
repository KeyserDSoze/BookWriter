# ADR 0050 — Identità dell'informazione confermata dall'autore fra due personaggi

- **Stato:** accettato per v0.11.17 (PR #63)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0011 e 0042–0049

## Problema

Le v0.11.14–0.11.16 permettono all'autore di attestare le menzioni di conoscenza, interpretarle, scegliere chi può leggerne una breve citazione e annotare separatamente quando un personaggio possa sapere qualcosa. Però «Mara scopre che la lettera è falsa» ed «Elio apprende che la lettera è falsa» potrebbero riferirsi alla **stessa** informazione oppure a due rivelazioni diverse, sogni, errori, menzogne o omonimie. La somiglianza lessicale **non** prova identità del contenuto e l'ordine dei capitoli **non** prova un trasferimento informativo o una cronologia lineare.

## Decisione

1. Aggiungere `BookProject.narrativeKnowledgeTopicDecisions?: NarrativeKnowledgeTopicDecision[]` append-only (max **120**). Ogni record conserva ID, **due ID distinti di `NarrativeKnowledgeDecision` in ordine lessicografico canonico**, `verdict=same_information|different_information`, `rationale` 20–650 caratteri, `decidedAt` ISO. **L'utente conferma la relazione**, non il rilevatore o il giudice AI.
2. Le due fonti devono essere decisioni knowledge **entrambe correnti**, ancorate individualmente a menzioni `knowledge_mention` `affirmed` in scene canoniche congelate con quote/offset e stamp attuali. Devono appartenere a **personaggi dal nome letterale differente** (normalizzazione Unicode/case). Il sistema non identifica automaticamente alias e non accetta collegamenti di due decisioni dello stesso personaggio.
3. `buildNarrativeKnowledgeTopicRegistry` è **last-wins per coppia esatta non ordinata di ID**, compreso un successivo record errato/stale; non fa risorgere collegamenti precedenti. Se una delle fonti viene riaperta, riscritta, riattestata, respinta o la conoscenza viene rettificata, l'intera relazione diventa **storica/non corrente**; solo un nuovo atto manuale potrà collegare le nuove fonti.
4. Il registro conserva sia conferme `same_information` sia smentite `different_information`, e mostra **entrambe le citazioni reali** e, se presenti, le due annotazioni temporali correnti della v0.11.16. Questi tempi sono etichette relative alle **rispettive scene**, non una prova del prima/dopo nella storia. **Nessuna chiusura transitiva**: se A condivide il tema con B e B con C, il sistema non deduce A con C. Non si inferisce scambio, conoscenza effettiva, identità del personaggio, successione temporale o verità della notizia; non si scrive nel canone.
5. UI nel registro privato delle conoscenze: scelta di due menzioni di personaggi diversi, citazioni visibili, due verdict con motivazione, conferma esplicita, vista delle relazioni correnti e storico completo con record stale. `recordNarrativeKnowledgeTopicDecision` usa Web Locks writer+outbox, CAS `updatedAt`, blocco autopilot/redazione in corso, transazione atomica `books+activities+outbox`, autosync GitHub OFF e outbox cancellata. **Nessun motivo, segreto, nome o testo citato** finisce nei log attività.
6. **Privacy:** i nuovi collegamenti, le motivazioni e il campo `narrativeKnowledgeTopicDecisions` **non** sono inclusi in prompt dei 12 revisori, giudice, scrittore o riparatore e **non** sono automaticamente autorizzati dal consenso knowledge v0.11.15. Un futuro protocollo di condivisione richiederà **nuovo consenso specifico per l'identità del contenuto** e difese per ruolo. Nessuna nuova chiamata AI/HTTP o modifica automatica di timeline, memoria, segreti, personaggi o prosa.
7. ZIP `content/full` conserva lo storico con schema **strict** (ID, ordine canonico, enum, motivo, timestamp, max120) e compatibilità legacy. Un archivio strutturalmente valido **non autentica l'autore**; in lettura le fonti vengono rivalidate. L'esportazione ZIP e il push GitHub manuale potrebbero divulgare dati privati; l'interfaccia avverte.

## Limiti

Un legame `same_information` è un'**interpretazione esplicita dell'autore**, non una verifica semantica o una certificazione che due personaggi abbiano ricevuto una comunicazione. `different_information` nega solo quella coppia, non tutte le somiglianze. L'attuale indice di menzioni dirette è lessicale e non trova tutte le conoscenze del romanzo. Identità della notizia, cronologia della storia e trasmissione sono **tre relazioni separate** e nessuna viene dedotta automaticamente dalle altre. L'audit locale non autentica crittograficamente l'autore.

## Test

Vitest su due/tre personaggi, ID e nomi validi, no self-link/alias/transitività, coppia invertita, last-wins, fonte stale e riattestazione, annotazioni temporali solo consultive, privacy con vecchi consensi AI. Test application Web Locks/CAS/outbox/autosync/log. ZIP content/full, cifratura, enum/ordine canonico/ID ostili, backward-compatible. Playwright desktop/mobile con due attestazioni, due scelte knowledge, relazione, rettifica, reload, invalidazione della fonte, nessuna richiesta AI/GitHub e nessun overflow.
