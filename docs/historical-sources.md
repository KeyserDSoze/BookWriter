# Dossier storico con fonti consultate — BookWriter v0.9.0

Dalla versione 0.9.0 il **revisore storico** della Redazione multi-agente può confrontare alcuni dubbi del romanzo con **estratti di fonti effettivamente recuperati** da Wikipedia italiana. L'obiettivo è migliorare la qualità delle domande e la tracciabilità delle proposte editoriali, **non** dichiarare automaticamente che un fatto sia storicamente provato.

## Prima della revisione di un capitolo

1. Apri la **Dashboard** del libro e, nel pannello **Redazione multi-agente**, trova il capitolo che stai preparando. Espandi **Dossier storico**.
2. Digita **fino a cinque argomenti storici pubblici**, uno per riga. Esempi: `Illuminazione nelle città italiane 1848`, `Telegrafo elettrico Europa XIX secolo` oppure `Trasporti ferroviari nel 1850`. Evita nomi inventati, indizi segreti e brani inediti: queste frasi verranno cercate presso un sito pubblico.
3. Premi **Cerca fonti pubbliche**. BookWriter mostra esattamente quali argomenti saranno trasmessi a `it.wikipedia.org`; la richiesta parte **solo dopo la tua conferma**.
4. Esamina i risultati: ogni fonte mostra il titolo dell'articolo, il collegamento, l'ID della revisione e l'estratto. Quando disponibile, **Apri la revisione citata** porta alla specifica versione della voce usata nella lettura.
5. Riprendi l'autopilot. Nella chiamata dello **specialista storico** il modello riceverà il dossier di quel capitolo, non una navigazione autonoma del web. Gli altri **undici revisori** continuano a essere indipendenti, senza ricevere le ricerche storiche.

Se non vengono trovati risultati, la ricerca resta indicata come **senza riscontri**: questo non significa che la tecnologia sia impossibile né che un evento non sia mai esistito.

## Come leggere un rilievo

Per ogni rilievo lo storico produce una valutazione documentale:

- **Coerente con l'estratto**: una frase effettivamente presente nella fonte sembra compatibile con il fatto sospetto. Non vuol dire che il fatto sia certificato.
- **Potenziale contraddizione con l'estratto**: la fonte sembra dire qualcosa di diverso. Occorrono controllo del contesto e un'altra fonte indipendente.
- **Non verificato**: non sono disponibili riferimenti sufficienti o non sono pertinenti; il modello può solo segnalare il dubbio.

Le prime due valutazioni richiedono **ID della fonte e citazione testuale originale**. Dalla v0.9.2 (PR #27) il codice esige **una citazione per ciascuna fonte dichiarata**: il riferimento deve essere attivo e la frase deve comparire nell'estratto di **quella fonte**, non soltanto di un'altra presente nell'elenco. Una singola vecchia `sourceQuote` continua a essere interpretata solo se era associata a un'unica fonte. Se due revisioni provengono dalla stessa pagina Wikipedia, non vengono contate come due fonti indipendenti. Quando il giudice legge un report storico vecchio con citazioni cumulative non deve presumere che le fonti si corroborino. Un link o una frase inventata dal modello viene rifiutata. La verifica è **testuale**, non la certificazione del ragionamento storico.

Il **direttore editoriale** riceve estratti delle scene, rapporti dei revisori e dossier delle fonti citate. Può accogliere la proposta o **respingerla motivando**, ad esempio perché un articolo enciclopedico parla della tecnologia in generale ma non prova che essa fosse impossibile in quella città e in quell'anno.

Le correzioni approvate seguono il ciclo già esistente: riscrittura mirata, aggiornamento di personaggi/segreti/timeline e nuova review completa. **Nessun risultato Wikipedia modifica direttamente la prosa.**

## Contesto, riservatezza e sincronizzazione

La consultazione è anonima e usa un'API pubblica di Wikipedia italiana; non richiede account, proxy, backend o credenziali. Il browser invia **solo gli argomenti che hai digitato e confermato**, non il romanzo, le schede dei personaggi o i segreti. I risultati esterni sono trattati come **dati non attendibili**, mai come istruzioni per gli agenti.

Il dossier entra nei dati locali del libro (IndexedDB) e nei backup ZIP; dopo un eventuale congelamento può essere incluso nella repository GitHub che hai scelto di collegare. **Una repository pubblica rende visibili anche le tue ricerche**. Evita query con indizi inediti o informazioni personali.

Quando aggiorni le fonti, l'autosync viene disabilitato e la coda remota obsoleta è rimossa. Se il capitolo era **congelato**, l'aggiornamento lo riapre automaticamente, invalida i capitoli successivi e recupera la sinossi globale del punto narrativo precedente. Il giudizio finale deve essere ripetuto.

Non puoi modificare il dossier mentre l'autopilot sta lavorando o è in corso una tornata editoriale. Concludi o risolvi il ciclo prima di cambiare le fonti; pianifica le ricerche preferibilmente **prima** che il capitolo entri in review.

## Catalogo istituzionale LoC (v0.9.3)

Puoi cercare schede di possibili fonti archivistiche della Library of Congress con fino a tre query digitate e confermate dall'autore. Il catalogo viene conservato separatamente da Wikipedia e dai DOI, è visibile solo a revisore storico e direttore e **non costituisce evidenza**: nessun estratto dei documenti è stato acquisito. La sua consultazione può fallire per CORS senza modificare il libro. [Guida](institutional-archives.md), ADR 0016.

## Studi e bibliografia DOI (v0.9.1)

Se conosci l'identificativo di uno studio o di un libro, puoi aggiungerlo in **Bibliografia DOI** sotto lo stesso capitolo. BookWriter consulterà i metadati Crossref (titolo, autori, anno e pubblicazione) solo dopo la tua conferma. Non è una fonte primaria né una lettura del testo integrale: il giudice non accetterà titoli DOI come citazioni storiche. Vedi [Guida alla bibliografia DOI](crossref-bibliography.md) e ADR 0014.

## Provenienza e diritti

Le prime fonti provengono da **Wikipedia italiana**, una fonte **terziaria**. Non sostituisce fonti primarie, archivi statali, studi scientifici o bibliografia specialistica. Gli estratti riprodotti vengono attribuiti al titolo dell'articolo e ai contributori Wikipedia (licenza indicata da Wikimedia, generalmente CC BY-SA). Usa i link alle revisioni specifiche per verificare se il testo è stato successivamente modificato e segui la bibliografia originale per conferme.

Il sistema non interroga ancora automaticamente archivi istituzionali, cataloghi bibliografici, DOI/ISBN, documenti d'epoca né più fonti indipendenti. Queste capacità restano nell'[issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).

## Possibili difficoltà

- **Errore di rete / HTTP 429 / browser offline:** non vengono applicati dossier parziali; riprova manualmente in seguito.
- **Fonte non pertinente:** lascia il rilievo non verificato o chiedi al direttore di respingerlo; non usare il primo risultato come prova.
- **Citazione falsa nell'output dell'AI:** BookWriter rifiuta il report e mette il runner in errore, senza canonizzazione silenziosa.
- **Capitolo già congelato:** l'aggiornamento delle fonti riavvia deliberatamente la redazione e richiede nuova conferma di tutti i capitoli interessati.
- **Molti estratti/versioni:** il dossier limita le fonti attive e conserva le revisioni precedentemente citate fino a un limite definito; non tronca il contenuto già usato nelle decisioni.

La ricerca via Wikipedia **non utilizza crediti AI**. Le successive chiamate dello storico, del giudice e degli altri agenti sono normali chiamate al tuo provider, soggette al [budget opzionale del libro](ai-budget.md).

**Riferimenti:** [ADR 0013](../ADR/0013-historical-source-dossiers.md) · [Redazione multi-agente](editorial-board.md) · [Issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
