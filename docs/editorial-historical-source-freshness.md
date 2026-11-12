# Rivalidazione delle fonti storiche nella redazione (v0.11.69)

## Il dossier usato dall'AI non può cambiare durante la risposta (#144)

Oltre al controllo sulle citazioni dei rilievi già archiviati, BookWriter lega ora la risposta del **revisore storico** e quella del **giudice critico** all'esatto dossier storico del capitolo **mostrato nel prompt**. Se durante la richiesta un import o ripristino cambia estratti, revisioni, fonti attive, provenienza dichiarata, OCR o schede bibliografiche, l'output viene scartato, anche se il `updatedAt` del libro non cambia.

Il controllo usa una snapshot **temporanea in memoria**, mai registrata come nuovo dato sensibile. Il libro mantiene il dossier più recente; non vengono approvati report o verdetti basati su fonti superate, neppure se il rapporto dice semplicemente `pass` e non contiene citazioni. Nessun re-fetch nascosto, ricerca aggiuntiva, retry o prova automatica della verità storica. Il confronto della fonte non sostituisce il giudizio critico dell'autore. [ADR 0126](../ADR/0126-historical-dossier-prompt-freshness.md) · [issue #144](https://github.com/KeyserDSoze/BookWriter/issues/144).

## Perché anche una review completa può diventare obsoleta

Il manoscritto può restare esattamente lo stesso dopo i dodici rapporti, mentre il dossier storico cambia. Una revisione di Wikipedia viene sostituita; una trascrizione è ritirata; una fonte non contiene più la citazione usata; due documenti dichiarati indipendenti si rivelano derivati dalla stessa fonte. Il numero dei report e l'impronta del testo **non** individuano questi problemi.

BookWriter ora controlla il **dossier del capitolo corrente** per ogni rilievo dello specialista storico in diverse fasi: prima del revisore successivo, prima di interpellare il giudice critico, prima di applicare il suo verdetto, prima del freeze e prima di una remediation ripresa dopo una pausa.

## Cosa viene verificato

Il controllo esistente `validateHistoricalClaim` viene rieseguito sul materiale disponibile **adesso**, non soltanto sulla versione vista dal revisore. Si confermano sourceId e **stato attivo** degli estratti, presenza delle citazioni letterali nella fonte corretta, assenza di citazioni inventate o duplicate, indipendenza degli originali quando richiesta e confronto strutturato per i conflitti fra fonti. Solo lo specialista storico può dichiarare un `historical` documentale; gli undici altri ruoli non possono aggiungerlo retroattivamente.

Quando la verifica fallisce, **il giudice e la remediation non vengono chiamati**. Il rapporto vecchio resta nell'archivio; per ripartire, l'autore può usare **Recupera checkpoint e ricomincia** della v0.11.68, con conferma, backup e nuove chiamate AI soltanto alla ripresa. Durante il ripristino del libro da ZIP, la validità del rapporto non è presunta sulla base del solo ID della fonte.

## Quali conclusioni non si possono trarre

- Una citazione letterale attiva attesta solo la **presenza del testo** in un documento o estratto attualmente disponibile. Non prova da sola che i fatti, la data o l'interpretazione del revisore siano corretti.
- `unverified` significa esplicitamente che non esiste prova documentale autorizzata: il controllo non lo trasforma in `contradicts_excerpt` e non impone una correzione.
- Il giudice resta fallibile e può **respingere** una critica anche con citazioni reali. La verifica tecnica non determina chi ha ragione sulla storia.

Il controllo è locale-first: non vengono scaricate nuove fonti, inviate chiavi o effettuate nuove chiamate AI per questi gate. Vitest e Playwright desktop/mobile coprono revoche e blocco prima del provider.

[ADR 0101](../ADR/0101-live-historical-sources-at-editorial-gates.md) · [Issue #106](https://github.com/KeyserDSoze/BookWriter/issues/106) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20) · [Epic #23](https://github.com/KeyserDSoze/BookWriter/issues/23).

## Versione

Il gate storico contro output AI basati su dossier cambiati (#144) è incluso nella versione applicativa **0.11.90**; i test non certificano autenticità o licenze delle fonti.
