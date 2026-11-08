# Confronto delle verifiche dopo una nuova revisione — v0.11.27

Quando riapri un capitolo già congelato e la nuova redazione inizia a produrre report, BookWriter può mostrare **in parallelo** i suggerimenti che erano rimasti irrisolti nei vecchi giudizi e le prove letterali emerse nella nuova tornata.

## Dove compare

Apri **Redazione multi-agente** con un capitolo riaperto. Se esistono giudizi precedenti con verifiche irrisolte, compare **Confronto verifiche storiche e nuova revisione**. Apri una voce per leggere la vecchia citazione, la prova che mancava, il controllo suggerito dal vecchio giudice, l'eventuale nuovo suggerimento e le note private dell'autore associabili allo storico.

La vista distingue:

- **Stessa citazione, stessa posizione:** testo, scena, categoria e posizione letterale corrispondono. Non dimostra che il problema sia lo stesso.
- **Stessa citazione, posizione differente:** il testo sembra spostato; è solo una pista, non un allineamento semantico.
- **Più corrispondenze:** non c'è una candidata univoca.
- **Non individuato nel campione corrente:** potrebbe mancare una verifica oppure il passo è stato riscritto. **Non significa risolto**.
- **Fonte storica non confrontabile:** il vecchio report non ha riferimenti sufficientemente coerenti.

Se il nuovo giudice si è espresso e il suo giudizio passa le validazioni correnti, la vista indica se la prova mancante e il controllo suggerito sono formulati **con le stesse parole o diversamente**. Questo non certifica una correzione, né un consenso.

## Note dell'autore

Una scelta storica di presa in carico, rifiuto o reset può comparire accanto al vecchio suggerimento, **ma rimane storica**: non diventa mai una decisione sulla nuova tornata. Le note sono associate solo tramite identificativi e snapshot letterali compatibili; poiché la riapertura cancella `frozenAt`, non è sempre possibile confermare con certezza da quale congelazione provenga una nota. Se ci sono ambiguità, il sistema non mostra la motivazione come associata a quel controllo. Uno ZIP importato continua ad azzerare le scelte che erano attive.

## Cronologia di più revisioni (v0.11.28)

Per vedere l'evoluzione di un capitolo **oltre il confronto fra archivio e tornata corrente**, consulta il [Registro delle differenze editoriali](editorial-diff-ledger.md) in **Stato dei capitoli**. Raggruppa solo citazioni letterali, segnala le ambiguità e non chiude mai un problema automaticamente. Le tue note private restano fuori dal registro.

## Limiti e privacy

Il confronto è completamente **locale e read-only**, senza salvataggi, chiamate AI, ricerche, task, editing, freeze o sincronizzazione automatica. Esamina massimo 24 controlli storici e soltanto i gruppi di prova correnti già compresi nei limiti della redazione; segnala espressamente i gruppi non esaminati. Non invia vecchie note ai revisori, al giudice, ai lettori ciechi o al writer. La lettura rimane **responsabilità dell'autore** e non sostituisce i gate di continuità, segreti, timeline o storico.

Riferimenti: [ADR 0060](../ADR/0060-editorial-archive-revision-comparison.md), [note sugli archivi](frozen-editorial-verification-annotations.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
