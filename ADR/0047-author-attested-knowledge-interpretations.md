# ADR 0047 — Registro privato delle conoscenze interpretate dall'autore

- **Stato:** proposto per v0.11.14
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0037–0038, 0041–0046

## Problema

La v0.11.13 confronta passaggi letterali di informazioni fra personaggi e lascia a un giudice AI, fallibile, la distinzione tra comunicazione, sapere e menzogna. Mancava un modo per **conservare la specifica interpretazione motivata dell'autore** su una menzione di conoscenza senza confonderla con il canone, con la memoria dei segreti o con l'analisi automatica.

Una lista libera di «chi sa cosa» senza fonte e versione potrebbe diventare obsoleta dopo la riapertura o modifica dei capitoli. L'invio automatico ai modelli potrebbe inoltre esporre segreti o spoiler a lettori ciechi e agenti non autorizzati.

## Decisione

1. Introdurre l'opzionale `BookProject.narrativeKnowledgeDecisions?: NarrativeKnowledgeDecision[]` (max **160**, append-only) con `id,sourceEventDecisionId,actorName,verdict,rationale,decidedAt`. I verdetti sono **`learned_directly`**, **`reported_by_other`** e **`still_secret`**. La motivazione è obbligatoria (12–500 caratteri) e ogni decisione rimane nello storico delle rettifiche. Il nome del personaggio (max 60) è tratto dalla fonte; non è inseribile liberamente.
2. L'autore può decidere **solo su un `NarrativeEventDecision` `affirmed` corrente con `candidate.kind=knowledge_mention`**, proveniente dalla medesima scena canonica congelata. Il dominio rivalida mediante `buildNarrativeEventLedger`: quote/offset, freeze, `sceneTextStamp`, ultima decisione attestante e attore corrente. Nessuna classificazione è autorizzata da menzioni non attestate, respinte, inventate o obsolete. Il timbro non è una firma crittografica e nessun archivio autentica l'autore.
3. L'ultima interpretazione per **esatto `sourceEventDecisionId`** prevale, anche se una successiva viene poi invalidata. Le interpretazioni precedenti non risorgono, né vengono agganciate automaticamente a una nuova attestazione dopo re-freeze/riattestazione. `buildNarrativeKnowledgeRegistry` espone solo record correnti con fonte realmente corrente e conta quelli superati/stale. L'ordine per capitolo/scena/offset rende l'audit leggibile. Non vengono inferiti alias, equivalenza fra personaggi, catene transitive di comunicazione o stato effettivo del sapere.
4. `recordNarrativeKnowledgeDecision` esige interazione esplicita e conferma UI; usa gli stessi **Web Locks** del writer e dell'outbox, confronto CAS su `updatedAt`, blocco se autopilot è running o il ciclo editoriale non è `blocked`, e transazione atomica `books+activities+outbox`. Disabilita `remote.autoSync` e cancella la coda GitHub, senza push né rete. Il log attività contiene solo stato e ID fonte, **mai la motivazione o la notizia privata**. Il dato può comunque essere esportato e sincronizzato **manualmente**, anche verso un repository pubblico: avvertire l'autore prima del salvataggio.
5. **Tranche volutamente read-only rispetto all'AI:** il nuovo registro non entra in `reviewerPrompt`, `adjudicationPrompt` o altri prompt. I 5 lettori ciechi e tutti gli altri agenti restano senza questi nuovi dati; nessuna modifica automatica della memoria canonica, `memory.secrets`, timeline, inventario o prosa. Per usare un'interpretazione ai fini della revisione serviranno un nuovo protocollo di consenso e un contesto esplicitamente ristretto in un'ADR successiva.
6. Dashboard: scelta fra menzioni `knowledge_mention` attestate e correnti, tre verdetti con motivazione, conferma forte, registro corrente e storico compresi gli elementi stale. ZIP `content/full` valida `narrativeKnowledgeDecisionSchema` **strict** con id, enum, lunghezze, ISO timestamp e max160, accettando archivi legacy senza il campo. Import strutturalmente valido non attribuisce verità o autenticità: i riferimenti sono sempre rivalidati localmente.

## Limiti

Non è un grafo esaustivo delle conoscenze. Le menzioni candidate sono selezionate da regex italiane limitate a formule tipo «Mara scopre che…» (80 eventi/1600 scene, 20k caratteri per scena); comunicazioni indirette, deduzioni e segreti non menzionati esplicitamente **non** possono ancora essere classificati in questo registro. Anche «ancora segreto» è una **interpretazione dell'autore**, non un aggiornamento effettivo della memoria `secrets`. Lo stato originale `affirmed` attesta una menzione e non la verità della frase. Nessuna chiamata AI aggiuntiva o cambiamento delle policy editoriali.

## Test

Vitest dominio: fonti `knowledge_mention` attestate, altri tipi esclusi, freeze/stamp/riattestazione stale, rettifiche append-only, tag/limiti e no side effect. Applicazione: lock/CAS, stop running, audit, log senza rationale, autosync off + outbox vuoto. Backup ZIP chiaro e full cifrato con round-trip, schema hostile strict, ID falsi non correnti. Test privacy su prompt dei 12 revisori/giudice. Playwright desktop/mobile: annotazione evento, due classificazioni, storico, reload, invalidazione dopo modifica fonte, nessuna AI/HTTP e layout mobile.
