# Indice eventi narrativi candidati — BookWriter v0.11.3

L'applicazione mostra nella **Redazione multi-agente** un nuovo riquadro espandibile «Indice eventi candidati». Vi compaiono frasi esplicite della prosa già approvata e congelata, in particolare menzioni di una conoscenza acquisita («Mara scopre che...»), del passaggio di un oggetto («Mara consegna la chiave a Elio») e di cambiamenti di stato («Elio scompare»).

Ogni risultato contiene numero di capitolo e scena, frase **letterale** trovata, offset nel testo originale, soggetto, eventuale destinatario e data indicata nella scena. Le citazioni provengono soltanto dalla prosa già congelata: non vengono lette memorie private o capitoli successivi. Il tutto viene calcolato sul dispositivo senza nuove ricerche online, chiamate AI né sincronizzazioni.

## Come interpretare l'indice

Una voce con `evidenceStatus=unverified_literal_pattern` significa «il software ha individuato questa **costruzione testuale**», non «l'evento è avvenuto davvero nel mondo narrativo». Una persona può raccontare una menzogna, sognare un fatto o parlare al condizionale. L'estrattore **non** aggiorna il canone, i segreti o l'elenco di chi possiede un oggetto.

Nelle rivalidazioni di continuità, i revisori pertinenti e il direttore possono leggere queste menzioni associate ai campioni precedenti e usarle per ragionare. Ogni rilievo deve comunque citare una frase del **segmento corrente**, mentre il direttore può respingere la conclusione come infondata. I cinque lettori ciechi non ricevono le nuove menzioni né il canone privato.

## Copertura e limiti

- Il sistema riconosce solo **tre famiglie di frasi italiane esplicite**. Espressioni differenti, sinonimi, negazioni complesse, forme passive, date implicite e discorso indiretto potrebbero non essere riconosciuti.
- Considera al massimo **20.000 caratteri per scena**, **quattro** menzioni per scena, **1.600** scene già congelate e **80** menzioni totali; ne mostra direttamente fino a 30. Il pannello indica quando ulteriori scene non sono state analizzate.
- Riaprire un capitolo elimina le sue menzioni dall'indice finché non viene di nuovo congelato. Nessuna «verità» vecchia resta fissata in un archivio derivato.
- L'estrattore non certifica una contraddizione, un fatto storico o le conoscenze effettive dei personaggi; rimane necessario il controllo critico.

La successiva evoluzione potrà prevedere la **conferma dell'autore** su una singola menzione prima di trasformarla in elemento del canone verificato. Per ora l'indice è volutamente consultivo.

Riferimenti: [ADR 0036](../ADR/0036-literal-event-mentions-index.md), [redazione multi-agente](editorial-board.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
