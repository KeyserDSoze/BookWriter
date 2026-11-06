# ADR 0026 — Divergenze documentali tracciate, non contraddizioni storiche certificate

- **Stato:** Accettato per v0.10.3 (PR #38)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0011, 0013, 0015, 0019, 0022–0025

## Contesto

Il revisore storico dispone di snapshot documentali recuperati o trascritti con diverse garanzie epistemiche. La verifica attuale di `sourceEvidence` garantisce solo la presenza letterale della citazione nel frammento associato; non stabilisce se due documenti descrivono lo stesso evento o se una divergenza sia reale. Un LLM può leggere periodi, luoghi ed edizioni incompatibili e scambiarli per un conflitto.

## Decisione

1. Aggiungiamo `HistoricalAssessment=conflicting_excerpts` come **segnalazione del modello** e `sourcePositions: [{sourceId,position,rationale}]` con `position=supports|disputes|unclear`. Servono 2–3 documenti attivi, indipendenti secondo le identità canoniche già usate da `validateHistoricalClaim`; una frase letterale verificata per ciascuno, una posizione motivata per ogni ID, almeno una `supports` e una `disputes`. Le schede DOI, catalogo LoC e IIIF non sono citabili.
2. I validatori runtime verificano soltanto forma, fonte attiva, quote e indipendenza documentale, non la coerenza **semantica** delle posizioni. Ripetizioni della stessa pagina/revisione o dello stesso item LoC non contano come conferma indipendente, anche fra OCR e trascrizioni.
3. Solo lo storico riceve fonti e istruzioni per formulare ipotesi; gli altri undici revisori rimangono isolati. Il direttore riceve `sourcePositions`, `sourceEvidence`, gli estratti e il contesto: può **respingere** la segnalazione o richiedere una remediation, motivando. Una discordanza non è mai una riscrittura automatica né una fonte di canon.
4. La UI distingue `conflicting_excerpts` dalle altre tre valutazioni, mostra per ID la posizione proposta e un avviso che la citazione esatta non certifica il conflitto. I report esistenti restano invariati e leggibili; nessuna migrazione IndexedDB, ZIP o GitHub.
5. Nessun nuovo GET, servizio terzo o invio del romanzo alla ricerca pubblica. Si usano solo estratti presenti nel dossier approvato e già trasmessi all'agente storico durante la review standard.

## Non-obiettivi e limiti

- Non si classificano automaticamente gli eventi per anno, geografia, edizione o autorità del documento. Non si dimostra la verità storica, indipendenza archivistica reale, licenza, pubblico dominio o corrispondenza OCR/scansione.
- La coppia `supports`/`disputes` è un giudizio linguistico *proposto* da un modello; anche citazioni valide possono risultare compatibili nel contesto.
- Non viene effettuata alcuna verifica live delle fonti prima di un nuovo giudizio; il refresh e la revoca volontaria seguono le regole già esistenti.

## Accettazione

- Rifiuto di quote inventate, fonti non attive, posizioni mancanti, stesse revisioni e classificazioni non motivate.
- UI chiara, isolamenti agenti, giudice libero di respingere e nessuna scrittura autonoma di prosa/canon.
- Typecheck, Vitest, smoke, build e Playwright desktop/mobile sull'HEAD della PR prima del merge.
