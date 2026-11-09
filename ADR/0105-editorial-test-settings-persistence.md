# ADR 0105 — L'E2E non deve ricaricare prima della persistenza delle impostazioni AI

- **Stato:** accettato per v0.11.73
- **Data:** 2026-11-10
- **Issue:** [#110](https://github.com/KeyserDSoze/BookWriter/issues/110)
- **Epic:** [#6](https://github.com/KeyserDSoze/BookWriter/issues/6) e [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Contesto:** [ADR 0098](0098-grapheme-safe-editorial-segmentation.md), [guida](../docs/editorial-unicode-ci-reliability.md)

## Contesto

La suite `editorial-grapheme-segmentation.spec.ts` verifica che un grafema ZWJ sul limite dei 10.000 caratteri non venga spezzato tra i primi due prompt dei revisori. In run CI diversi si è fermata con **zero richieste** su desktop o mobile, mentre la review e le verifiche di testo della suite continuavano a passare altrove. Il test cliccava `Salva impostazioni` e chiamava subito `page.reload()`.

Nel frontend `App` chiama `void saveEndpointSettings()`, funzione asincrona che cifra la chiave mock con WebCrypto prima di attendere `saveSettings` in IndexedDB. Il `click` di Playwright attende l'evento, **non il completamento del Promise asincrono del callback**. Il reload può interrompere il salvataggio, producendo un input non configurato per il runner prima di `callModel`.

## Decisione

1. Attendere il messaggio UI **esatto** `Impostazioni salvate in IndexedDB.`, prodotto soltanto dopo il commit locale.
2. Controllare prima e dopo il reload che in `settings/global` sia registrato il model ID di test e che il profilo OpenAI abbia un secret cifrato **presente** (ritorno booleano; nessun valore segreto esposto). Un successo del click da solo non basta.
3. Conservare senza modifiche l'invariante centrale `first + second === sceneText`, i limiti di 10k, il controllo dei surrogati e il conteggio dei prompt, oltre alla diagnostica del runner in caso di fail. **Non** introdurre sleep, timeout maggiori o fallback sulla segmentazione.
4. Non modificare l'app, l'uso della chiave, la politica dei segreti, la Web Lock o la transazione di salvataggio: è una race tra azioni del **test**, non una prova che un salvataggio in produzione completato sia andato perso.

## Verifica e limiti

Verificare test, typecheck, smoke, build, EPUBCheck, E2E desktop/mobile e Pages/Cleanup su main; richiedere almeno una seconda run indipendente della suite prima di chiudere #110. Un test verde non prova che altre possibili flakiness siano impossibili: se emergono diverse cause aprire issue dedicate, con log privi di credenziali.
