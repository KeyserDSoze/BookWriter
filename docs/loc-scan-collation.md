# Collazione OCR / scansione LoC — BookWriter v0.10.1

La funzione **Confronta OCR con scansione** permette all'autore di registrare una lettura manuale della scansione di un documento storico, confrontandola con la breve citazione OCR che BookWriter ha già recuperato dalla Library of Congress.

**Attenzione:** BookWriter NON legge, scarica né autentica immagini. La "scansione originale" è una pagina LoC che **devi aprire e controllare personalmente**. Se la scansione non è visibile, non puoi attestare di averla consultata. La conferma è una dichiarazione dell'autore; il programma confronta soltanto le due stringhe di testo.

## Procedura

1. In **Redazione multi-agente → Estratti OCR istituzionali**, apri uno snapshot `lococr:` attivo. Accanto al frammento premi **Confronta OCR con scansione**.
2. Premi il collegamento alla **scheda LoC** specifica. Verifica che l'item contenga davvero un'immagine della pagina d'interesse; possono esserci più pagine o opere. Leggi direttamente la scansione, non il testo OCR.
3. Inserisci la **pagina/folio/colonna** (4–140 caratteri) e trascrivi una breve frase vista **nell'immagine** (36–900 caratteri). Questa frase resta separata dalla versione OCR, con identificativo della fonte a cui è collegata.
4. Spunta entrambe le dichiarazioni: consultazione visiva personale e base di riutilizzo del breve testo, inclusa la possibile trasmissione a modelli AI, backup ZIP e GitHub. Il programma **non controlla legalmente** queste dichiarazioni.
5. Prima del salvataggio, un dialogo ti mostra l'intero testo dichiarato e la collocazione, oltre alle conseguenze sui capitoli frozen. Conferma soltanto se tutto è corretto.
6. BookWriter normalizza **soltanto maiuscole/minuscole e spazi** e verifica se il testo digitato compare nell'estratto OCR salvato. Risultato `text_overlap`: le stringhe sono compatibili dopo normalizzazione; `text_discrepancy`: non coincidono. Non viene fatta alcuna comparazione tra pixel dell'immagine e OCR, riconoscimento ottico o interpretazione semantica.

## Cosa succede nella review

La collazione resta nell'audit con ID `locscan:` e data, pagina, riferimento al singolo `lococr:` e impronta OCR. Una nuova collazione archivia quella vecchia senza sovrascriverla; se il record OCR o la sua scheda/ispezione non è più attiva, la collazione resta **solo nello storico**, non negli input delle nuove review.

Lo **specialista storico e il giudice critico** possono leggere il testo e l'esito per valutare l'affidabilità della citazione. Una `text_discrepancy` è un avvertimento esplicito: un rilievo basato soltanto sull'OCR non va approvato senza chiarire la divergenza. Gli altri undici agenti restano ciechi. Un ID `locscan:` **non è fonte storica indipendente e non può apparire in `historical.sourceIds`**.

L'aggiunta di una collazione a un capitolo frozen ripristina la sinossi precedente, riapre il ciclo di review e invalida le approvazioni dei capitoli successivi; **non cancella la prosa**. Disattiva autosync e invalida l'outbox per evitare propagazioni silenziose.

## Diritti, sicurezza e limiti

- L'originale può appartenere a terzi o essere soggetto a restrizioni differenti dal file OCR. Il software non certifica copyright, dominio pubblico, permessi di citazione o di invio a provider AI.
- La pagina istituzionale non garantisce che sia presente o accessibile una scansione della **stessa pagina**: è l'autore a doverla individuare e descrivere. Non vengono inventate coordinate di immagine, identificatori IIIF o URL di scansioni.
- Il confronto `text_overlap` **non autentica il documento né dimostra la verità storica**. Una frase può essere riportata erroneamente dall'autore o copiata dall'OCR; una differenza può essere un errore dell'OCR, della digitazione o di edizione. Il giudice deve restare critico.
- Non viene inviata alcuna richiesta di rete durante la collazione in BookWriter. Il sito LoC è però aperto dal browser quando premi il collegamento. I dati dichiarati vengono conservati localmente e possono entrare in backup/GitHub/modelli AI con la tua autorizzazione.
- I test della UI provano il flusso di dichiarazioni e il confronto testuale ma **non** un'autentica visita umana al documento. La verifica automatica di una specifica immagine e del suo identificativo IIIF è un passo successivo.

Riferimenti: [ADR 0024](../ADR/0024-author-attested-visual-scan-collation.md), [guida OCR](loc-ocr-excerpts.md), [riverifica OCR](loc-ocr-reverification.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
