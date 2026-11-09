# ADR 0073 — Visibilità del campionamento lessicale delle scene correnti lunghe

- **Stato:** accettato per v0.11.40
- **Data:** 2026-11-09
- **Issue di consegna:** [#76](https://github.com/KeyserDSoze/BookWriter/issues/76)
- **Epic correlate:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20), [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedenti:** ADR 0068, 0069, 0071, 0072

## Problema

Nell'audit v0.11.39 il numero di scene correnti incluse nella query aggregata è trasparente: ogni scena omessa è contata. Tuttavia `balancedQueryTerms` applica `scanWords` alla concatenazione `scene.text + " " + scene.title + " " + scene.objective`, campionata a massimo **16.000 caratteri** per scena; le scene incluse ma più lunghe sono lette **solo parzialmente dal ranking lessicale**. `partialCoverage=false` restava possibile anche con una scena corrente lunga, due testimoni precedenti brevi entrambi selezionati e nessuna scena corrente esclusa. L'audit suggeriva così un'assenza di limiti non giustificata.

## Decisione

1. Riutilizzare **esattamente** la stringa lessicale usata da `balancedQueryTerms` per rilevare `length>MAX_SCAN_CHARS`. Aggiungere `lexicallyTruncatedSceneIds` e `lexicallyTruncatedSceneCount` in `CurrentQueryCoverage`. Non esaminare scene non selezionate per la query, non aggiungere prosa o chiamate al provider. `scope=single_scene` usa soltanto la scena specifica; una scena esclusa dalla query aggregata non viene erroneamente etichettata come lessicalmente analizzata.
2. Estendere `partialCoverage` del freeze a `pack.currentQuery.lexicallyTruncatedSceneCount>0`. Memorizzare due campi **opzionali** nel `ContinuityRecheckAudit` e mostrarli all'autore soltanto se presenti, mantenendo compatibilità con vecchie storie e snapshot.
3. Aggiornare gli avvisi dei prompt dei quattro specialisti autorizzati e del direttore: il dato indica una **porzione lessicale non letta dal ranking**, non un mancato controllo degli altri segmenti e non una contraddizione confermata. Non esporre il nuovo dato ai cinque lettori ciechi. Nessuna riparazione canonica automatica.
4. In `continuityAuditSchema` del ZIP **rigoroso**, la nuova coppia deve essere presente insieme o assente insieme (legacy). Se presente richiede anche il gruppo precedente di copertura corrente; conteggio e lunghezza della lista devono coincidere, senza duplicati, con massimo **6** ID tutti presenti in `currentQueriedSceneIds`. Continuare a rifiutare payload alterati e campi ignoti, mantenendo `.strict()`.
5. Conservare il metodo `local_structured_lexical_v1`, il budget massimo di 6 scene correnti nella query aggregata, 48 termini/16 nomi, 1600 candidate precedenti, quattro scene selezionate e due per capitolo, finestre letterali originali, tutti i permessi e nessuna richiesta AI/HTTP aggiuntiva.

## Test e limiti

Vitest su scena con input lessicale appena oltre 16k (inclusi title e objective), soglia esatta, scena lunga esclusa dal campione aggregato, singola scena esplicita, director prompt, privacy, freeze con tutti i testimoni precedenti completi e nessuna mutazione. Test ZIP con coppia opzionale valida, ZIP 0.11.39 e legacy, duplicati, ID esterni e coppia incompleta; Playwright desktop/mobile sulle avvertenze e sui contatori persistiti. CI e Pages sulla stessa HEAD.

**Tradeoff:** un campo numerico in più aiuta a interpretare la **parzialità lessicale**, senza rendere esaustiva la ricerca o certificare alcun evento del romanzo. È possibile che altri controlli indipendenti leggano segmenti non analizzati da questa query: mantenere la distinzione.
