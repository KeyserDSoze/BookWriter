# ADR 0033 — Catena di rivalidazione dopo modifiche retroattive

- **Stato:** Accettato per v0.11.0 (PR #46)
- **Data:** 2026-11-06
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0011 (redazione a 12 agenti), ADR 0032 (citazione letterale), ADR 0031 (CI riproducibile)

## Problema

La riapertura manuale di un capitolo e la revisione retroattiva dell'autopilot invalidano già `frozenAt`, `summary`, `bookSummaryAtFreeze` dei capitoli successivi e impediscono il push. Tuttavia i revisori dei capitoli di valle ricevevano essenzialmente riassunti precedenti e non una traccia strutturata di quale capitolo fosse cambiato; i rapporti di revisione potevano ignorare passaggi cruciali dei capitoli iniziali. La perdita di un'approvazione non basta a dimostrare che la continuità sia stata ricontrollata.

## Decisione

1. A ogni riapertura manuale (`author_reopen`) e al calcolo delle scene interessate da una revisione retroattiva (`retroactive_revision`), salvare su ciascun **capitolo successivo già scritto** un `continuityRecheck`: ID/numero dell'origine, causa, timestamp e ID delle scene all'origine. Nessun frammento di romanzo, timeline privata o segreto viene duplicato nel marker. Se sono in corso più riaperture, la **più antica per numero di capitolo** prevale, per non nascondere la modifica più a monte. Svuotare la precedente attestazione di review completata mentre il capitolo torna da verificare.
2. Durante le nuove review, i quattro specialisti `continuity`, `timeline`, `secrets`, `characterVoice` ricevono un **campione tracciabile di scene pubbliche già scritte e congelate** del capitolo originario e dell'ultimo predecessore (quando diverso). Ogni campione contiene ID capitolo/scena, numero, eventuale data esplicita, riferimenti dichiarati a personaggi/luoghi/oggetti/fazioni, e fino a due finestre letterali con offset e indicazione `complete|partial`. Per capitolo di provenienza si selezionano al massimo due scene, privilegiando gli ID modificati e i riferimenti espliciti; il totale è limitato a quattro scene, con conteggio di quelle omesse. Per scene lunghe si conservano solo due finestre letterali, **non** un testo composto presentato come citazione continua.
3. I cinque lettori ciechi mantengono il contesto precedente: **non ricevono** il pacchetto di dipendenze, `secret_refs`, la memoria privata o futuri capitoli. Il direttore critico riceve lo stesso campione identificato, ma non deve prenderlo come istruzione né dichiarare verificata tutta la continuità. Il gate v0.10.9 per `finding.evidence` resta limitato al **segmento corrente**: il revisore cita il passo a valle e indica origine/contesto nella motivazione, non spaccia una scena precedente per una prova tratta da quella letta.
4. Il dominio `assertPriorChaptersFrozen` impedisce la review e il nuovo congelamento del capitolo di valle finché i predecessori non sono tutti scritti, canonici e congelati. L'autopilot sceglie il primo capitolo pronto nell'ordine narrativo. Al congelamento della nuova review, `completeContinuityRecheck` registra data, sorgente e ID delle scene campionate come `lastContinuityReview` e libera il marker pendente. Questo è un **audit della review**, non una certificazione semantica che ogni evento sia coerente.
5. Il pannello redazione segnala i capitoli in attesa di rivalidazione e mostra, sui capitoli nuovamente congelati, origine, data e limiti dei campioni. La riapertura conserva Web Locks, CAS, audit, outbox svuotata, autosync disabilitato, vincoli autore e rewind delle sinossi.

## Limiti e privacy

- Campionamento bounded = **copertura non esaustiva**. Gli estratti sono solo scene pubbliche precedenti: possono non includere un dettaglio rilevante. Le informazioni non presenti non diventano fatti falsi, e il software non rileva deterministicamente contraddizioni semantiche.
- Alcuni segreti narrativi potrebbero comparire nella prosa **già pubblicata**, che è legittimo leggere per specialisti della continuità e direttore. Non vengono copiati valori di `memory.secrets` nel campione né forniti ai cinque lettori. Resta la limitazione preesistente della memoria globale di libro nelle revisioni retroattive.
- Nessun nuovo servizio di ricerca, storage remoto, chiamata AI aggiuntiva, sincronizzazione automatica o obbligo di immagazzinare testo storico duplicato. I dati del marker sono opzionali per vecchi ZIP/report e non vengono riempiti retroattivamente.
- Riaperture derivanti da altre interfacce del dossier storico potranno essere unificate con questo meccanismo in un intervento successivo; questa tranche copre le due vie editoriale/retcon, senza affermare che ogni importazione generi un marker.

## Verifiche di accettazione

- Vitest su selezione bounded, priorità scene, finestre/offset esatti, disclosure parziale, assenza di testi futuri e di segreti privati, prompt dei quattro specialisti contro lettori ciechi, origine più antica, gate predecessori congelati, audit dopo il nuovo freeze e origine mancante.
- Test IndexedDB/Web Locks/outbox sulla riapertura e marker a valle; Playwright desktop/mobile su badge UI, origini, freeze e assenza fetch.
- CI PR finale npm ci, typecheck, Vitest, smoke, build, Playwright desktop/mobile; poi merge e verifica CI `main`, deploy Pages e cleanup sull'esatto merge SHA.
