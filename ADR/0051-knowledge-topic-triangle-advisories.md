# ADR 0051 — Avvisi consultivi per triangoli di interpretazioni informative

- **Stato:** accettato per v0.11.18 (PR #64)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0047–0050

## Problema

Le decisioni dell'autore sono volutamente limitate a **coppie esatte** di conoscenze: A/B «stessa informazione», B/C «stessa informazione» NON generano una relazione implicita A/C (ADR 0050). Quando però l'autore ha **anche** confermato direttamente A/C «informazioni differenti», può essere utile riesaminare le tre scelte insieme, senza trasformare interpretazioni narrative fallibili in equazioni del canone.

## Decisione

1. Nuova funzione **pura e locale** `reviewNarrativeKnowledgeTopicTriangles(registry)` che legge solo `current`, `sameInformation` e `differentInformation` già filtrati da `buildNarrativeKnowledgeTopicRegistry`. Non legge direttamente lo storico né crea decisioni mancanti.
2. Un avviso richiede **tutti e tre** i collegamenti **espliciti e correnti** di tre interpretazioni: A/B e B/C `same_information`, A/C `different_information`. Due collegamenti non bastano, neppure se lo stesso tema appare letteralmente in tutte le citazioni. Nessuna inferenza transitiva o semantica.
3. Mostrare al massimo **12 avvisi** nel pannello con conteggio totale e numero omesso; per ogni terna mostrare **le tre citazioni letterali**, i nomi dei tre personaggi e le tre decisioni direttamente dichiarate. Trattare gli esiti come **possibili incoerenze nelle scelte dell'autore**, non bug narrativi accertati.
4. Una rettifica last-wins, un record importato non più valido, il cambiamento di una scena, un nuovo freeze o la perdita della fonte eliminano automaticamente l'avviso se non sopravvivono tutti e tre i link correnti. Un avviso non blocca l'autopilot, il freeze, l'import o la sincronizzazione; non scrive report, activity, stato, memoria, timeline, segreti, prosa o nuove relazioni.
5. **Privacy:** l'avviso è derivato ed effimero nella UI; nessun nuovo endpoint, modello, prompt o consent. Le motivazioni e i collegamenti restano esclusi dai prompt dei revisori e del giudice anche in presenza di vecchie autorizzazioni per singole conoscenze. ZIP e GitHub possono già contenere le decisioni sottostanti, ma **non** serializzano l'avviso calcolato.
6. Confermare o rettificare le coppie continua a richiedere il consenso e i guard esistenti della v0.11.17; la nuova analisi è soltanto una vista consultiva.

## Limiti

Le interpretazioni possono divergere intenzionalmente per punto di vista, testimonianza, narrazione inattendibile o diverse accezioni della notizia. Il controllo non certifica identità delle informazioni, verità, possesso di segreti, ordine temporale o trasferimento. Non trova incoerenze su coppie **mancanti** né su relazioni storiche e scadute. Nessuna chiusura transitiva.

## Test

Vitest per tre scelte correnti, due sole coppie, rettifica last-wins e fonte stale; Playwright Chromium desktop/mobile per creazione delle tre interpretazioni, avviso con citazioni, rettifica, reload e assenza di chiamate AI/GitHub. In CI: TypeScript, Vitest, smoke, build e browser.
