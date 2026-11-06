# Continuità tra capitoli dopo una modifica — v0.11.0

## A cosa serve

Quando riapri un capitolo già approvato o chiedi all'autopilot di correggere retroattivamente una scena, BookWriter annulla il congelamento dei capitoli interessati e dei successivi. Ora contrassegna anche i capitoli **di valle** che contengono prosa già scritta come **da rivalidare**, indicando il capitolo da cui è partita la modifica. Se un'altra modifica ancora precedente arriva prima della review, quella nuova origine prende la precedenza.

## Aggiornamento delle fonti storiche (v0.11.1)

La stessa catena è ora attivata anche quando aggiungi, verifichi, escludi o attesti relazioni fra **fonti storiche** in un capitolo già congelato. Il marcatore `historical_evidence` distingue un **dossier documentale modificato** dalla **prosa riscritta**. I capitoli successivi già scritti richiedono una nuova review in ordine; anche il revisore storico vede campioni della prosa precedente, ma tali campioni **non dimostrano fatti storici** e non certificano l'indipendenza dei documenti. [Guida](historical-continuity-rechecks.md) e ADR 0034.

## Come funziona la rivalidazione

1. Dopo la riapertura o la revisione retroattiva, guarda **Redazione multi-agente → Stato dei capitoli**. La dicitura **Rivalidazione obbligatoria** segnala i capitoli che non possono essere considerati definitivi.
2. Riprendi l'autopilot. Va completata prima la review dei capitoli più antichi: **nessun capitolo di valle può essere rivalidato e congelato se un precedente non è scritto, canonico e congelato**.
3. Quando arriva il turno dei capitoli successivi, gli specialisti di continuità, timeline, segreti e voce ricevono **campioni identificati della prosa dei capitoli precedenti già congelati**. Il software privilegia le scene indicate come modificate e i riferimenti espliciti a personaggi, luoghi, oggetti e fazioni. Ogni citazione porta il proprio ID, posizione ed etichetta di campione completo/parziale.
4. I revisori confrontano il testo precedente con la scena corrente: se trovano un problema, devono citare una **frase della scena corrente** (gate letterale v0.10.9), spiegare il riferimento precedente e proporre una correzione. Il direttore critico riceve il campione ed esamina i rilievi; può respingerli motivando.
5. Soltanto dopo il normale giudizio completo e il freeze, il marker di rivalidazione viene sostituito da una registrazione di origine, data e scene campionate.

## Cosa NON significa

- L'esito `freeze` non certifica che tutto il romanzo sia storicamente, psicologicamente o causalmente coerente. Gli agenti e il direttore possono sbagliare.
- Il campionamento esamina **al massimo due scene del capitolo di origine e due dell'ultimo predecessore**. Una scena lunga fornisce soltanto due finestre letterali di testo, ciascuna con offset. Le scene o parti omesse sono dichiarate. Non è una ricerca semantica completa di tutti gli indizi.
- I cinque lettori ciechi non ricevono il nuovo dossier cross-chapter né la memoria privata. I dati aggiuntivi sono **prosa di capitoli precedenti** fornita soltanto agli specialisti pertinenti e al giudice.
- Nessuna richiesta viene fatta ai provider AI oltre alle normali 12 revisioni e al giudice; il nuovo contesto può però aumentare la dimensione di quei prompt e quindi i **costi** delle chiamate. Restano attivi il preflight e i limiti di budget esistenti.
- Dopo una riapertura, **autosync resta disattivato** e la coda remota viene cancellata secondo le regole precedenti; non ripristinare il push finché tutti i capitoli richiesti non sono nuovamente congelati.
- I capitoli legacy non modificati da questa versione non hanno retroattivamente un marker di rivalidazione.

Riferimenti: [ADR 0033](../ADR/0033-downstream-continuity-revalidation-chain.md), [redazione a 12 agenti](editorial-board.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
