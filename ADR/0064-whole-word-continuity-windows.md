# ADR 0064 — Finestre di continuità a parola intera e offset originali

- **Stato:** accettato per v0.11.31
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063

## Contesto

La v0.11.30 seleziona correttamente scene precedenti che nominano nella prosa un'entità dichiarata nella scena corrente, anche senza tag. Tuttavia `targetedLiteralWindows` cercava sottostringhe in una copia in minuscolo, ordinando i termini per **lunghezza**. Per il nome «Ivo» poteva quindi centrare una finestra su «vivo» e perdere la menzione autentica; una conversione Unicode in minuscolo che cambia lunghezza poteva inoltre rendere inesatti gli offset originali. In una revisione editoriale, un estratto così fuorviante indebolisce la valutazione critica.

## Decisione

1. Continuare a usare `targetedLiteralWindows` come funzione locale, read-only e bounded; non introdurre nuovi DTO persistenti, schema ZIP, servizi o agenti. L'input continua a provenire dalle scene precedenti già congelate e dai match del ranking.
2. Ordinare i segnali al **call site** per provenienza: `literalEntities` della ricerca a parola intera (ADR 0063), poi `entities` strutturate, quindi `terms` lessicali. La funzione di scelta della finestra rispetta questo ordine invece di ordinare i termini per lunghezza. La priorità del focus non cambia il punteggio di ranking né la selezione delle quattro scene.
3. Cercare ogni termine come stringa **letterale regex escaped**, case-insensitive Unicode, con controlli di confine del nome che includono lettere, numeri, segni combinanti e underscore. Non accettare una sottostringa dentro parole più lunghe: `Ivo` non deve corrispondere a `vivo`; un nome composto richiede sequenza esatta. La fonte dei match è la **stringa originale UTF-16**; non calcolare offset da testo normalizzato o lowercased. Un mancato match non costituisce prova di assenza.
4. Provare al massimo **48 segnali** di lunghezza **3–100**, e preferire il primo match valido. Su scene di oltre 2.800 caratteri, centrare una finestra da 1.250 caratteri sul match e mantenere una finestra distante; senza match conservare contesto da inizio e fine. Con scene più brevi preservare la singola finestra integrale. Garantire che `text.slice(offset,offset+window.length)===window.text` per ogni finestra.
5. Aggiornare l'avviso nel pannello di rivalidazione, senza introdurre alcun dato privato in UI o prompt. Non leggere il registro degli alias, non dedurre identità, relazioni o contraddizioni dalla citazione; non ampliare i ruoli autorizzati e non modificare il requisito della citazione del segmento corrente per i finding.
6. Mantenere i limiti esistenti di 1.600 scene scansionate, 4 selezionate, 2 per capitolo, 2 finestre di 1.250 caratteri e le protezioni contro i segreti. Le finestre restano campioni **parziali**, non una revisione completa della cronologia narrativa.

## Verifiche e limiti

Vitest per `vivo/Ivo`, priorità tra nomi e termini più lunghi, nomi composti e sottostringhe, offset originali con casefold Unicode che varia lunghezza, scena lunga non taggata e isolamento della memoria privata. Playwright desktop/mobile per avviso di rivalidazione; CI con typecheck, Vitest, smoke, build, browser e deploy.

**Limite dichiarato:** la ricerca letterale non identifica automaticamente sinonimi, pseudonimi o riferimenti impliciti e può non trovare una formulazione non letterale. Non certifica problemi risolti, verifiche storiche o modifiche da applicare.
