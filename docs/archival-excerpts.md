# Estratti da originali consultati dall'autore — v0.9.4

L'interfaccia **Dashboard → Redazione multi-agente → Estratti da originali consultati dall'autore** permette di associare a un capitolo **brevi trascrizioni di documenti che hai letto personalmente** presso la Library of Congress. Non è una funzione di download, OCR, controllo licenze o autenticazione storica autonoma.

## Procedura

1. Prima di avviare il ciclo editoriale, cerca una scheda LoC nell'area **Archivi istituzionali**. La richiesta di ricerca necessita del tuo consenso e invia soltanto gli argomenti pubblici immessi.
2. Apri manualmente la pagina del documento sul sito istituzionale. Leggi l'originale e verifica data, attribuzione, pagina, eventuali limitazioni di uso e che l'estratto sia fedele. Non assumere che la scheda sia fonte primaria certificata.
3. Nel pannello «Estratti» seleziona la scheda attiva, indica pagina/folio/collocazione, eventuale data o edizione e **trascrivi** soltanto un breve passaggio pertinente (24–1200 caratteri).
4. Seleziona una base dei diritti: **pubblico dominio** che hai verificato oppure **permesso/licenza** già ottenuti. Inserisci un riferimento testuale per spiegare la scelta. Se non conosci lo stato dei diritti, **non archiviare il testo**.
5. Spunta la dichiarazione sull'originale e sui diritti. Prima del salvataggio vedrai tutti i campi e la trascrizione nel dialogo di conferma. È un'operazione **locale, senza ulteriori chiamate all'archivio**.
6. Durante la review lo specialista storico potrà associare a un rilievo una citazione letterale dell'estratto, usando il nuovo ID `locex:...`; il software verifica soltanto che sia presente nel testo che hai inserito. Il direttore editoriale valuterà contesto, incertezza e remediation; non dovrà presumere di aver letto l'originale. Gli altri undici agenti non ricevono gli estratti.

**Distinzione fondamentale:** `loc:...` rappresenta una **scheda di catalogo**, che non può essere prova in un finding storico. `locex:...` rappresenta una **trascrizione dichiarata dall'autore**, con testo e collocazione. Anche una citazione corretta da `locex` non autentica l'originale: l'app non controlla che il contenuto o la data coincidano con ciò che è pubblicato dal sito.

## Versioni, sicurezza e pubblicazione

Il capitolo mantiene fino a 40 snapshot di trascrizioni, dei quali un massimo di cinque attivi. Sostituire una trascrizione conserva la versione precedente ma ne disattiva la citazione nei nuovi report. Quando il catalogo si aggiorna, le trascrizioni associate a una scheda che non è più attiva rimangono conservate ma **non sono citabili** nelle nuove analisi.

Il testo e i metadati entrano nel dossier locale, nei backup ZIP e nel libro eventualmente sincronizzato su GitHub. **Una repository pubblica pubblicherà gli estratti e le dichiarazioni dei diritti**. Durante le nuove chiamate AI della redazione il testo selezionato può essere inviato all'endpoint AI configurato dall'autore. La scelta dell'endpoint e il suo trattamento dei dati rimangono responsabilità dell'autore; controlla sempre prima eventuali informazioni riservate.

Una nuova trascrizione in un capitolo congelato invalida il freeze di quel capitolo e dei successivi, recupera la sinossi precedente quando possibile e sospende l'autosync. Tutto è protetto da Web Locks, confronto revisioni e salvataggio atomico. Se la redazione è attiva o non è possibile tornare alla sinossi corretta, l'operazione è bloccata.

## Limiti espliciti

- Non viene acquisito nessun documento originale dalla rete; l'app non attesta autenticità, licenza, identità, periodo o verità della fonte.
- L'attestazione dei diritti è una **dichiarazione dell'autore**, non una consulenza legale. Public domain, licenze e diritti di traduzione possono variare secondo la giurisdizione.
- Nessun testo viene copiato dal catalogo al dossier come prova automaticamente.
- Il confronto tra più fonti resta una valutazione critica, non una certificazione automatica di indipendenza o di correttezza.

Per il catalogo vedi [Archivi istituzionali](institutional-archives.md). Per le decisioni tecniche e i test vedi [ADR 0017](../ADR/0017-author-attested-original-excerpts.md). La verifica indipendente degli originali resta nel perimetro dell'[issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
