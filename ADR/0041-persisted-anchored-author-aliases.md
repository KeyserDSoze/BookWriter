# ADR 0041 — Decisioni alias motivate e ancorate alle attestazioni dell'autore

- **Stato:** accettato per v0.11.8 (PR #54)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0037–0040

## Contesto

La v0.11.7 consente una sola anteprima effimera di due nomi narrativi, ma al reload perde la scelta, impedendo una consultazione stabile delle ipotesi motivate. Una persistenza ingenua per soli nomi introdurrebbe il rischio che alias invalidati da una rettifica o riapertura vengano trattati nuovamente come validi, e che import ostili modifichino i fatti del canone o i contesti dei revisori.

## Decisione

1. Aggiungere `BookProject.narrativeAliasDecisions?` **opzionale e append-only**, massimo 120 record: `id, firstName, secondName, firstEventDecisionId, secondEventDecisionId, verdict, rationale, decidedAt`. `linked` indica soltanto l'interpretazione consultiva dell'autore; `separated` ne esclude la coppia, non certifica che i personaggi siano distinti. Motivazione obbligatoria di 12–500 caratteri, nomi di massimo 60, diversi ignorando NFC e casefold italiano.
2. Al momento della decisione, selezionare **due nomi presenti in attestazioni `affirmed` correnti** e salvare gli ID dei **due record evento fonte**. Una coppia rimane corrente soltanto se entrambi gli ID compaiono tuttora nel ledger rivalidato, con gli stessi nomi letterali. Cambio freeze, modifiche prosa, scene draft, rettifica e rifiuto della fonte invalidano il link. Niente riattivazione automatica su una nuova attestazione con nome/testo simili.
3. L'ultima decisione per **coppia non ordinata** prevale sempre: una rettifica stale non lascia riapparire un vecchio `linked`. Lo storico non viene cancellato e non costituisce autenticazione dell'autore, soprattutto se proveniente da ZIP/import.
4. Scrittura soltanto su azione esplicita e conferma browser: Web Locks `bookwriter:writer:<id>` e `bookwriter:github-outbox`, CAS `updatedAt`, transazione unica books+activities+outbox; disattivare autosync e svuotare la coda GitHub, senza chiamate ai modelli o push automatico. Bloccare durante autopilot e redazione attiva.
5. Schema backup ZIP opzionale, **strict** per i record alias, massimi e valori enumerati; versioni precedenti senza alias restano compatibili, copie importate mantengono audit ma perdono permessi GitHub. Non è autenticazione crittografica, né prova di legame.
6. Nei confronti locali della v0.11.6–0.11.7, aggiungere le sole coppie **`linked` correnti** come `identityBasis=saved_alias`, con motivazione associata. Nessuna chiusura transitiva tra coppie, niente deduzione degli alias, nessuna nuova sorgente di segreti. Ordinare i segnali **`literal_name` prima di `saved_alias` prima di `alias_preview`**, sempre massimo 40 e omissioni contate. Un preview sulla coppia già salvata non genera doppioni.
7. L'interfaccia mostra azione motivata per confermare/escludere e storico con correnti e obsolete. Non cambiare identità canoniche, memoria, segreti, timeline, inventari, testo, freeze, review, giudice o prompt dei cinque lettori ciechi. Un sistema di vera identità canonica richiederà ADR distinta e validazione semantica.

## Verifica

Unit test su fonti inesistenti o stale, rettifiche, freeze modificati, quota 120, limite 40, motivazione, transazione CAS/outbox e isolamento canone. ZIP round-trip + input manomesso, versioni precedenti senza campo. Playwright desktop/mobile su conferma, reload, revoca e nessuna rete. La UI non presenta attestazioni e alias come fatti accertati.

## Limiti

Una coppia linkata non prova identità, eventi, ordine causale, possessioni o conoscenza. Gli ID e i timbri fonte sono ancore locali di freschezza, non firme digitali. Una revisione delle scene può lasciare storico consultabile ma non attivo; solo una nuova decisione esplicita può ripristinare un'ipotesi.
