# Testimoni narrativi pertinenti nella redazione — v0.11.9

BookWriter ora può fornire **brevi citazioni da eventi precedenti esplicitamente attestati dall'autore** mentre i revisori di continuità analizzano un nuovo capitolo. Non si avvia una nuova chiamata AI: sono elementi contestuali aggiunti a richieste che avvengono già nel ciclo di redazione, con un possibile piccolo incremento del consumo di token.

Quando la scena corrente nomina un soggetto già presente in eventi attestati in capitoli precedenti congelati, il sistema seleziona fino a **otto testimoni** con citazioni e offset originali, capitolo/scena e identificativi dell'annotazione. Un collegamento alias può servire a selezionare una prova sotto un altro nome **solo se l'autore ha salvato un legame motivato ancora valido e se entrambe le fonti che lo sostengono precedono il capitolo**. Non vengono inventati alias, né composte catene fra nomi; l'anteprima temporanea della v0.11.7 non entra nei prompt.

## Chi riceve il contesto

I quattro specialisti **coerenza/causalità**, **timeline**, **segreti** e **voce/motivazioni dei personaggi** ricevono il pack quando pertinente, anche durante la review ordinaria. I sette specialisti mantengono chiamate indipendenti e i cinque lettori ciechi continuano a **non ricevere** queste annotazioni né segreti, note autore o identificazioni future. Il revisore storico non riceve questo nuovo contesto.

Il **giudice critico** riceve il pack soltanto se un finding possiede un ancoraggio letterale ancora valido che richiama il nome di un precedente testimone. Può così confrontare il rilievo con citazioni reali anziché fidarsi dell'opinione dello specialista. Il giudice deve verificare identità, punto di vista, cronologia, flashback, dialoghi e interpretazioni alternative, e può **respingere una critica infondata con spiegazione**, senza attivare remediation.

## Cosa non significa

Una menzione «Mara muore» può riferirsi a sogno, menzogna, voce del narratore o evento non lineare: non è una certificazione dell'accaduto. Una coppia di nomi approvata dall'autore per confronto non prova che si tratti della stessa persona. **La citazione di un finding deve essere tratta dal segmento corrente**, mentre il testimone precedente resta contesto da descrivere nel motivo.

La selezione è **lessicale, locale, limitata** a otto prove, e indica quante altre attestazioni pertinenti sono state omesse. Un test negativo non prova la coerenza del libro. Non vengono copiati nei nuovi pack i segreti, i motivi dell'autore, le memorie private, i capitoli correnti/futuri o le decisioni non più valide. Nessun aggiornamento automatico di canon, timeline, inventario, freeze o ZIP.

Per approfondire: [ADR 0042](../ADR/0042-attested-contextual-editorial-witnesses.md), [registro alias](persisted-author-aliases.md), [provenienza dei finding](editorial-narrative-evidence.md), [redazione a 12 agenti](editorial-board.md) e [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
