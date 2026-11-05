# ADR 0011 — Redazione AI indipendente, sentenze motivate e congelamento del capitolo

- **Stato:** Accettato per la prima versione v0.8.0 (PR #19, CI in verifica)
- **Data:** 2026-11-05
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **PR:** [#19](https://github.com/KeyserDSoze/BookWriter/pull/19)
- **Dipendenze:** ADR 0005–0010, soprattutto ADR 0007 (lease) e ADR 0008–0009 (review/fusioni)

## Problema

In v0.7.1 la fase `review` per ogni singola scena **riscriveva automaticamente** la prosa e canonizzava. Questo non è sufficiente per la coerenza globale di un romanzo: non verifica con un panel indipendente se i segreti sono anticipati, se la cronologia regge, se il dialogo rispetta la voce di ciascun personaggio o se sono stati introdotti possibili anacronismi; un unico modello può concordare con ogni rilievo anche quando il suggerimento è sbagliato.

## Decisione: redazione dopo ogni capitolo completo

Il controllo preliminare della singola scena rimane, ma **non autorizza l'avanzamento al capitolo successivo**. Quando tutte le scene del capitolo sono state scritte e consolidate, il runner entra in `phase:chapterReview` e crea un `ChapterEditorialCycle` persistente.

**Ogni revisore è una chiamata separata** a `chat/completions` con istruzioni specifiche e un prompt costruito indipendentemente. Non c'è un'unica conversazione che simula più personaggi; le conclusioni di un revisore non vengono mostrate agli altri, tranne a un direttore editoriale finale. La "chat privata" è ricostruita da un breve `memoryNote` dello stesso ruolo per segmento e per tornata, non da una sessione server-side permanente.

### Panel di dodici revisioni

1. Sette specialisti: **coerenza/causalità**, **segreti/indizi/spoiler**, **timeline**, **plausibilità storica**, **voce/dialogo/personaggi**, **stile/lingua/POV**, **struttura/ritmo/payoff**.
2. Cinque lettori: **lettore esperto del genere**, **generalista**, **scettico**, **appassionato dei personaggi**, **lettore di misteri**.
3. I lettori sono intenzionalmente **ciechi ai segreti privati**, ai dossier dei personaggi e alla scaletta futura. Vedono solo prosa esaminata, stile, pubblico e sinossi pubblica dei capitoli precedenti. Gli specialisti hanno invece memoria canonica pertinente; il revisore dei segreti riceve anche l'intero registro privato dei segreti.
4. Ogni ruolo produce un JSON validato con esito, sintesi, note private e rilievi. Ogni rilievo obbliga a fornire **scena, categoria, severità, prova testuale, ragione e remediation proposta**. Un report `pass` con problemi, o un `issues` senza rilievi, è rifiutato.

### Segmentazione e contesto

- Il testo completo del capitolo è suddiviso in segmenti **senza perdere caratteri**; ciascun revisore riceve ogni segmento in una chiamata diversa. In una storia lunga ci sono quindi **12 × N** chiamate per un capitolo di N segmenti, più direttore, eventuali correzioni, riconsolidamento e sinossi. I costi AI possono essere elevati.
- Le schede di contesto includono sinossi globale aggiornata a ogni capitolo congelato, sinossi dei capitoli precedenti, vincoli dell'autore, personaggi e luoghi pertinenti, timeline e dati privati **solo dove autorizzati**.
- I riferimenti ai personaggi vengono scelti tramite menzioni nel testo e riferimenti di scena. La copertura semantica completa e il retrieval per entità sono lavori futuri.
- I precedenti capitoli molto lunghi vengono rappresentati dalla **sinossi globale progressiva**, non dall'infinita ripetizione del manoscritto. Le note dei revisori sono brevi e separate per ruolo. I grandi registri privati che superano il limite del prompt causano **arresto esplicito**, non truncation silenziosa: una compattazione automatica specialistica richiede un'altra milestone.
- Il limite di 40 segmenti impedisce che un capitolo enorme consumi risorse browser in modo incontrollato; il capitolo va diviso o gestito tramite un meccanismo di compattazione futuro.

### Direttore responsabile

Dopo **tutti e dodici i revisori**, il direttore riceve i soli report strutturati e giudica **ogni ID di rilievo una volta sola**. Può `accept` oppure `reject`; per ogni decisione deve spiegare il *perché*. Un `accept` deve inoltre fornire una remediation **specifica**. Il software valida che nessun rilievo sia omesso, duplicato o inventato: se la decisione è incompleta, la fase fallisce ed è ripetibile dal checkpoint.

Il direttore **non** ha il potere di dichiarare un capitolo congelato mentre esistono remediation accettate. Se non accetta alcun problema, il capitolo può avanzare alla sinossi e al congelamento; i rigetti restano registrati con motivazione, anche quando il revisore aveva espresso un voto negativo. Questo è un **consenso risolto criticamente**, non un voto di maggioranza né una finta unanimità.

### Correzioni e nuovo giro

- Una remediation accettata seleziona una scena precisa, non l'intero romanzo. Il revisionista vede solo i rilievi accettati, i vincoli e la scena da cambiare. Non deve applicare suggerimenti respinti.
- Ogni scena modificata conserva il proprio ID, ma ritorna `draft` durante la correzione. I sommari obsoleti della scena vengono azzerati.
- Quando le correzioni di quel giro sono finite, l'agente di consolidamento riconcilia per segmenti **personaggi, segreti, oggetti, luoghi e timeline**. Si ripete l'intero panel di dodici, anche sui punti che sembravano già a posto.
- Si ammettono **massimo tre tornate di remediation automatiche**. Se restano correzioni accolte dopo la terza tornata, `stage:blocked` e `status:paused`; i rapporti rimangono leggibili e l'autore deve dare nuove istruzioni. Nessun “pass” artificiale al raggiungimento del limite.
- La UI permette di rilasciare una nuova tornata **solo per intervento esplicito dell'autore**, salvando il nuovo vincolo persistente e i rapporti precedenti.

### Congelamento e retroazioni

- Quando non rimangono correzioni accettate, l'agente `summarize` produce sinossi progressive del capitolo e del libro per ciascun segmento. Solo dopo l'ultima sintesi vengono assegnati `chapter.frozenAt`, `chapter.summary` e `book.bookSummary`, archiviando tutti i rapporti e le sentenze.
- Il runner prosegue al capitolo successivo **solo dopo** il congelamento. Nessun autosync di prosa e nessun push manuale sono permessi se c'è un capitolo già iniziato ma non congelato o una redazione attiva. I soli checkpoint di outline e di congelamento sono candidati a sincronizzazione.
- Un autore può riaprire un capitolo congelato. L'operazione prende Web Locks, disattiva autosync, elimina la coda obsoleta, annota l'azione e **invalida il congelamento e le sinossi di quel capitolo e dei successivi**. Le revisioni retroattive dell'autopilot invalidano anch'esse le approvazioni dei capitoli dipendenti; ciascuno dovrà affrontare nuovamente il panel prima di proseguire.
- L'archivio dei giudizi è parte di `BookProject`/IndexedDB e viene salvato negli ZIP e nella proiezione GitHub alle normali milestone; non contiene API key o PAT.
- La UI mostra per ogni ruolo le prove testuali, la remediation proposta, la decisione e la motivazione dell'editor, e separa capitoli congelati, in review e non ancora completi.

## Sicurezza, epistemica e limiti

- **Accuratezza storica:** il revisore può segnalare un anacronismo sospetto o proporre una verifica; non dispone di fonti storiche esterne, quindi **non può certificare** un fatto. La revisione con citazioni esterne verificabili richiederà un connettore e un ADR a parte.
- **Consumo crediti:** una tornata può implicare decine/centinaia di chiamate e il ledger v0.7.1 mostra solo token effettivamente riportati, non un tetto economico. Budget e preflight sono issue #17. Non eseguire test su provider reali senza consenso.
- **Limiti di contesto:** la memoria privata troppo ampia blocca la chiamata con errore descrittivo; non è ancora disponibile una compattazione automatica affidabile di tutte le entità/segreti.
- **Lettori ciechi:** una sinossi pubblica aggiornata dal modello potrebbe comunque contenere uno spoiler generato erroneamente; la verifica umana e il controllo dei prompt restano necessari.
- **Indipendenza:** le chat sono richieste stateless distinte, non agenti server-side in background. Possono usare lo stesso modello/endpoint se l'autore lo configura; è possibile configurare separatamente le route `chapterAudit`, `chapterReaders`, `chapterJudge`, `chapterRepair` e `summarize`.
- **Continuità in sospensione:** il browser mobile in background non garantisce generazione continua; il ciclo riprende dal prossimo rapporto checkpointato al ritorno.
- **Casi non risolti:** valutazione umana di rilievi critici, retrieval semantico della memoria, release del freeze su versioni parallele e fact-checking storico certificato sono attività future. Nessun force push.

## Gate di rilascio

1. Unit test dei dodici ruoli, prompt ciechi ai segreti, segmentation lossless, schema findings, sentenza completa, rigetti motivati, remediation accettate e limite tre cicli.
2. Vitest end-to-end del runner locale: 12 report → giudice → riassunto → freeze; e report critico → remediation → nuovo panel → freeze; e tre cicli senza soluzione → stop autore.
3. Test del blocco di autosync e push per capitoli non congelati; riapertura con invalidazione dei successori e conservazione dei giudizi.
4. Playwright desktop/mobile su stato dei ruoli, progressi, storico, congelamento e riapertura.
5. TypeScript, Vitest, smoke, Vite build, Playwright desktop/mobile verdi sulla HEAD della PR. Nessun test con provider a pagamento senza consenso.

**Esito:** un capitolo congelato è un risultato di un processo tracciabile, non una semplice proprietà dichiarata dal modello.
