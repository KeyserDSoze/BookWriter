# BookWriter v0.9.9 — estratti OCR da file Library of Congress

La sezione **Estratti OCR istituzionali** può consultare un file di **testo semplice** legato a una scheda LoC già ispezionata e approvata dall'autore. La citazione viene letta realmente dal browser, non inventata dagli agenti. Non significa però che la Library abbia autenticato la trascrizione, che l'OCR sia accurato o che il testo sia libero da copyright.

## Uso

1. In **Redazione multi-agente → Archivi istituzionali**, esegui una ricerca con query pubbliche e approva il consenso.
2. Premi **Verifica accesso e diritti della scheda**. I metadati indicano se vi sono collegamenti digitali/testuali, possibili restrizioni e avvisi sul riuso.
3. Apri **Estratti OCR istituzionali**. Sono selezionabili solo schede con una **ispezione attiva**, collegamenti testuali e nessun accesso esplicitamente ristretto. Questo non certifica un permesso né garantisce un file compatibile.
4. Indica una base **valutata personalmente dall'autore** (pubblico dominio o permesso) e una motivazione documentabile (16–280 caratteri); spunta la dichiarazione. Il dialogo finale espone l'ID del documento, il possibile invio del frammento a modelli AI, ZIP e GitHub e la necessità di controllare l'OCR. Senza conferma, nessuna richiesta.
5. BookWriter legge soltanto il JSON della singola scheda e, se trovato, **un file .txt** sotto l'host istituzionale tile.loc.gov e il percorso storage-services/service o storage-services/master. Nessun PDF, HTML, OCR di siti terzi o immagine viene scaricato.
6. Conserva una riga letterale di massimo 900 caratteri, il file e la pagina d'origine, **SHA-256 del contenuto**, lunghezza, posizione e data consultazione. La citazione è disponibile con ID lococr:itemId:timestamp:hash16; un rapporto storico deve associare una frase esatta a ogni fonte tramite sourceEvidence. Solo storico e giudice vedono lo snapshot, mai gli altri 11 revisori.
7. Il giudice può rigettare la correzione: una frase presente nell'OCR non dimostra che l'originale sia autentico né che il fatto narrato sia vero.

## Limiti, privacy, diritti e versioni

La [Library of Congress](https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/) avverte esplicitamente che visualizzare un'opera sul sito non autorizza automaticamente il riutilizzo. I diritti sono **dichiarati dall'autore** e restano **non verificati dal software**. L'OCR può contenere errori, trascrizioni derivate, attribuzioni inesatte e diritti di terzi. Ogni opera richiede controllo autonomo di licenza, edizione, fonte, qualità della trascrizione e giurisdizione.

Le richieste sono due GET al massimo, con host fissi LoC e nessuna query del romanzo, scena, memoria, segreto, credenziale o token. Limite 240 KB per il JSON e 160 KB per il file di testo, timeout 12 secondi per chiamata, lettura streaming limitata, nessun redirect, cookie o referrer. Errore CORS/429/JSON, assenza di file ammissibili e dimensione eccessiva **non producono dati parziali**. La disponibilità CORS reale non è garantita dai test mock.

Nel libro IndexedDB/ZIP sono salvati solo **brevi passaggi** e la provenienza; l'estratto potrà essere sincronizzato su una repository GitHub scelta dall'autore (possibilmente pubblica). Non archiviare testi di terzi senza aver verificato la base legale. L'importazione di JSON modificati non autentica crittograficamente il digest: per quello serve una nuova consultazione controllata.

Sono conservati fino a 40 snapshot storici e al massimo quattro documenti OCR attivi. Se cambia la scheda o l'ispezione, gli estratti precedenti rimangono per audit ma non entrano nei nuovi report. Un OCR e una trascrizione manuale dello **stesso documento** non diventano due fonti indipendenti. Quando un capitolo era già frozen, la nuova fonte riapre quel capitolo e invalida i successivi senza cancellare la prosa; autosync viene disattivato.

La funzione non esegue il confronto visivo con il manoscritto o la scansione originale e non fornisce interpretazioni giuridiche automatiche. Per dettagli: [ADR 0022](../ADR/0022-loc-author-attested-ocr-evidence.md), [guide agli archivi](institutional-item-inspection.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
