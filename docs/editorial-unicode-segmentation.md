# Segmenti Unicode integri nella revisione multi-agente (v0.11.66)

La redazione di BookWriter rilegge ogni capitolo con **sette specialisti e cinque lettori indipendenti**; quando una scena è molto lunga, la divide in più segmenti e ogni ruolo riceve ognuno di essi. I report citano esattamente la porzione di manoscritto letta, senza promuovere automaticamente la critica a fatto canonico.

## Come viene diviso un capitolo

- La divisione resta preferibilmente dopo una frase o un a capo, ma **mai dopo il 10.000º carattere UTF-16** del segmento. Non è un limite di token dell'AI e non quantifica la lingua: alcuni emoji occupano più unità.
- Prima del taglio BookWriter individua il confine completo del **grafema Unicode** tramite `Intl.Segmenter`. Una sequenza come `👩‍💻`, una lettera `é` con accento combinato o una coppia `CRLF` rimane in un singolo segmento, senza introdurre sostituzioni U+FFFD.
- La concatenazione di tutti i segmenti di una scena restituisce la **stessa stringa originale**, senza `trim`, normalizzazione, omissione di frasi o revisione automatica della prosa; il limite massimo per capitolo resta 40 segmenti.
- Se una scena ha Unicode UTF-16 malformato, un grafema superiore a 10.000 unità o il browser non supporta `Intl.Segmenter` quando occorre un taglio, la review si interrompe **prima di inviare il prompt**. Correggi il carattere o usa un browser aggiornato e riprendi dopo aver verificato lo stato del libro.

## Effetti sui giudizi già archiviati

Un report che cita una prova testuale deve restare ancorato **al segmento e all'offset letti**. La nuova segmentazione può spostare confini di capitoli lunghi che contengono caratteri combinati. BookWriter non deve accettare una remediation fondata su un'ancora legacy o obsoleta: dopo un errore di validazione, riallinea o riavvia la review sotto supervisione dell'autore. La continuità semantica, i segreti e le accuse dei revisori rimangono controllati dal direttore critico, non dalla segmentazione.

Non si aggiungono chiamate modello, trasferimenti a rete, dati privati ai lettori ciechi, modifiche ai libri persistiti né un algoritmo AI nuovo. Test unitari ed end-to-end desktop/mobile verificano la correttezza del testo inviato ai revisori con provider mock. [ADR 0098](../ADR/0098-grapheme-safe-editorial-segmentation.md), [issue #103](https://github.com/KeyserDSoze/BookWriter/issues/103), [epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
