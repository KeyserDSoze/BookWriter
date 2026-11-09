# ADR 0101 — Rivalidare il dossier storico live ai gate editoriali

- **Stato:** accettato per v0.11.69
- **Data:** 2026-11-09
- **Issue:** [#106](https://github.com/KeyserDSoze/BookWriter/issues/106)
- **Epic:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20) e [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Precedenti:** [ADR 0099](0099-complete-editorial-review-checkpoint-gate.md), [ADR 0100](0100-author-confirmed-editorial-checkpoint-recovery.md)
- **Manuale:** [docs/editorial-historical-source-freshness.md](../docs/editorial-historical-source-freshness.md)

## Problema

I dodici rapporti di un capitolo sono verificati rispetto al testo canonico corrente (#104), tramite indici, ruoli, quote e checksum non crittografica. Tuttavia il **dossier storico** può evolvere indipendentemente dal testo: l'autore può escludere un estratto, una nuova revisione può ritirare quella citata, una trascrizione può cambiare, o una relazione tra due fonti può mostrare che non sono indipendenti. Se il giudice o un prompt di remediation assumessero ancora attendibili quelle vecchie citazioni, potrebbe essere proposta una correzione su **prove documentali non più attive**, pur con tutte le quote della scena ancora valide.

## Decisione

1. Esporre `assertCurrentHistoricalReviewSources(chapter, cycle)` come gate puro del dominio. Ogni rapporto di ruolo `historical` viene rivalidato attraverso l'esistente `validateHistoricalClaim(finding.historical, chapter.historicalDossier)`: controlli di fonte attiva, ID e testo letterale, revisioni, relazioni di derivazione/dipendenza, contesto delle divergenze e insiemi autorizzati. Un finding `historical` attribuito a qualunque altro ruolo viene rifiutato. Non inventare firme o ulteriori richieste a provider.
2. Collegare il gate a `assertEditorialReviewCoverage` dopo i controlli sulla matrice e sulla prosa. Ogni transizione al prossimo reviewer e al giudice/freeze utilizza già tale controllo, quindi il cambiamento del dossier invalida un **checkpoint anche con testo invariato**; il blocco precede la richiesta al modello e il recupero supervisionato #105 può archiviare il ciclo e ricominciare.
3. Eseguire inoltre il medesimo controllo in `adjudicationPrompt` quando chiamato direttamente, in `validateJudgment` prima di applicare un verdetto con capitolo live, e in `repairPrompt` anche dopo resume/import per qualsiasi remediation esistente. L'applicazione richiama già `repairPrompt` **prima** di invocare l'LLM e **al momento del commit**: la seconda chiamata intercetta fonti disattivate durante la risposta.
4. Conservare la distinzione epistemica: `unverified` senza fonte indica un'ipotesi documentale, mai una verifica; `consistent_with_excerpt`, `contradicts_excerpt` e `conflicting_excerpts` sono interpretazioni del modello, **non** fatti accertati. Una fonte attiva/citazione letterale da sola non dimostra il merito della critica. Il giudice continua a motivare accettazioni e rifiuti, l'autore supervisiona le remediation. Non introdurre conclusioni storiche automatiche né uso di documenti privati senza consenso.

## Verifiche e conseguenze

Vitest confronta un intero ciclo di dodici rapporti prima/dopo il ritiro della revisione citata, un estratto modificato sullo stesso sourceId, un report `unverified` senza prova, ruoli non autorizzati e un giudizio/repair importato con fonte stale. Playwright desktop/mobile inietta una matrice `12×1` ancora completa con impronta canonica corretta ma fonte del revisore storico sostituita: il runner **non deve contattare il provider**, non può congelare, e deve mostrare il recupero supervisionato.

I checkpoint con citazioni divenute inattive richiederanno una nuova review guidata dall'autore, non la manipolazione dei vecchi report. Non è una certificazione dell'indipendenza delle fonti quando i dati dichiarati sono falsi, né della verità storica, né una soluzione a contestazioni epistemologiche; restano aperte le epic #20/#23.
