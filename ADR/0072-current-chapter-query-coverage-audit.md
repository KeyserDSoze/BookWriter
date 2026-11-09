# ADR 0072 — Copertura esplicita della query sulle scene correnti

- **Stato:** accettato per v0.11.39
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0065, 0069, 0070, 0071

## Problema

Il recupero mirato cross-chapter comunica già il numero di scene **precedenti** candidate, scansionate e omesse. La v0.11.38 campiona fino a sei scene **correnti** rappresentative per il giudice, ma non comunica esplicitamente quante scene correnti sono escluse, né quali contribuiscono al ranking. Il direttore può quindi sopravvalutare la copertura: `unscannedSceneCount=0` indica soltanto che tutte le scene precedenti candidate sono state scandite, **non** che le scene correnti abbiano alimentato tutte la query.

Un secondo difetto è nell'audit del freeze: `partialCoverage` guarda solo omissioni e finestre delle scene precedenti. Con 8 scene correnti, 2 scene precedenti brevi entrambe selezionate e nessuna omissione precedente, poteva risultare false malgrado **due scene correnti omesse dalla query aggregata**.

## Decisione

1. Aggiungere `CurrentQueryCoverage` al risultato **transitorio** di `retrievePriorContinuityScenes` e a `ContinuityEvidencePack`, con `scope:"chapter_sample"|"single_scene"`, `writtenSceneCount`, `queriedSceneIds` e `omittedSceneCount`. Contare le scene correnti con `text.trim()`, utilizzare gli ID esatti scelti dalla query (ADR 0071), contare come omesse le scene scritte non comprese. Nessun testo corrente aggiuntivo nel pacchetto e nessuna variazione del ranking.
2. Consentire ai quattro specialisti pertinenti e al giudice di distinguere la **query corrente** dal **campione di testimoni precedenti**; lo storico è autorizzato solo sul trigger storico. I cinque lettori ciechi non devono ricevere `currentQuery`. In `single_scene` le altre scene correnti sono omesse **intenzionalmente da quella query**, non dalla sequenza di review dell'intero capitolo.
3. In `completeContinuityRecheck`, estendere `partialCoverage` includendo `pack.currentQuery.omittedSceneCount>0`. Introdurre nel vecchio audit quattro campi **opzionali**, `currentWrittenSceneCount`, `currentQueriedSceneCount`, `currentOmittedSceneCount`, `currentQueriedSceneIds`. Non modificare i record storici preesistenti, il contratto di `retrievalMethod`, il salvataggio canonico delle scene o gli altri meccanismi di freeze.
4. Mostrare all'autore, nello storico della rivalidazione, la copertura della query corrente **solo quando i campi nuovi sono presenti**. In prompt, dare al direttore un avviso chiaro sul fatto che scene correnti omesse non hanno contribuito al ranking; in review singola non trasformare tale omissione nel giudizio che l'intero capitolo sia incompleto.
5. Mantenere invariati numero e criterio delle sei scene correnti, 48 termini, 16 nomi, 1600 candidati precedenti, massimo quattro testimoni, due finestre letterali e offset, limiti di contesto e di chiamate AI/HTTP, segreti, permessi, controlli semantici, attestazioni e decisioni.

## Verifiche e tradeoff

Testare un capitolo con 8 scene (6 selezionate, 2 omesse), il suo prompt del giudice, una query di singola scena (1 selezionata, altre 7 non pertinenti alla query dello specialista), e un freeze con **tutte le scene precedenti complete**: il solo limite della query corrente deve attivare `partialCoverage`. Testare anche un capitolo con massimo sei scene (nessuna omissione e copertura false se non ci sono altri fattori). Verificare isolamento dei cinque lettori ciechi e nessuna mutazione durante la costruzione dei pacchetti; Playwright desktop/mobile visualizza i conteggi dell'audit opzionale.

Tradeoff: alcuni ID e contatori di scene correnti appaiono ai **soli ruoli autorizzati**, aggiungendo poco testo ai prompt. I record vecchi senza campi opzionali non vengono riclassificati retroattivamente: la loro copertura storica resta com'era registrata, per compatibilità. Una query completamente coperta non equivale a certificazione di coerenza semantica.
