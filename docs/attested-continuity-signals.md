# Tracce di continuità da verificare — v0.11.6

Nel pannello **Redazione multi-agente → Indice eventi candidati → Tracce di continuità da verificare**, BookWriter confronta sul dispositivo le sole annotazioni «Annota come avvenuto» dell'autore ancora valide.

Mostra possibili punti da riesaminare **senza dire che siano errori**:

- Un personaggio compare come autore di un'azione dopo una menzione di morte in un capitolo precedente.
- Lo stesso nome appare in due menzioni di morte, in assenza di una menzione attestata «risorge» tra le due.
- Due scene con eventi attestati dichiarano date `YYYY-MM-DD` valide in ordine inverso rispetto ai capitoli.

Per ogni coppia vengono mostrati nome, capitoli, scene, citazioni letterali, offset, date (se presenti), motivi dell'autore e spiegazione del confronto. La vista è consultiva: sogni, flashback, menzogne, resurrezioni, omonimi e personaggi narrativamente ambigui sono possibili spiegazioni. Una resurrezione testuale attestata interrompe la sola regola lessicale sulla morte; non ne prova la fondatezza.

## Cosa **non** fa

Non modifica la prosa né memoria, oggetti, segreti o timeline, non riapre capitoli, non produce remediation né invia informazioni aggiuntive ai revisori, al giudice o ai cinque lettori ciechi. Non avvia chiamate AI, HTTP o nuove sincronizzazioni. L'autore deve decidere se una sequenza è davvero incoerente e correggerla con gli strumenti editoriali ordinari.

Il confronto considera **solo attestazioni correnti**, anche se non presenti nelle prime 80 menzioni consultive dell'indice. Le rettifiche e i freeze superati non riattivano automaticamente segnali. La visualizzazione è limitata a 40 segnali con conteggio delle omissioni.

Per le date sono ammesse soltanto stringhe `YYYY-MM-DD` validamente formate; una data di scena è un metadato attuale, non una data autenticata al momento dell'annotazione. L'ordine del capitolo non dimostra quello cronologico (flashback); il nome identico non dimostra identità, né nomi differenti escludono alias. La mancanza di segnali non prova che il romanzo sia coerente.

Consulta [ADR 0039](../ADR/0039-attested-cross-chapter-continuity-hints.md), [registro degli eventi](narrative-event-ledger.md), [guida alle decisioni](narrative-event-decisions.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
