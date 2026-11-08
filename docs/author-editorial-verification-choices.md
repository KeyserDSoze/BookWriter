# Scelte dell'autore sui controlli suggeriti — v0.11.25

Nel [Piano verifiche editoriali](editorial-verification-plan.md), le proposte del giudice contrassegnate **Da approfondire: prove insufficienti** possono essere annotate dall'autore senza eseguire nessuna nuova verifica.

## Come registrare una scelta

Con autopilot fermo e ciclo editoriale nello stato **Bloccato**, apri la singola voce **Da approfondire**, poi **Scelta privata dell'autore**. Scrivi una motivazione di **20–500 caratteri** e scegli:

- **Prendi in carico**: tieni nota che vuoi approfondire la questione separatamente. Non viene aperta una ricerca e il sistema non dichiara il controllo completato.
- **Respingi suggerimento**: registri il motivo per cui non vuoi seguire quella verifica. Il finding del giudice e i gate di revisione **rimangono invariati**.
- **Azzera scelta**: riporti il controllo a nessuna scelta attiva; è disponibile solo quando esiste una decisione corrente. Lo storico non viene cancellato.

Ogni operazione richiede una **conferma esplicita** e conserva la motivazione privata. Il piano continua a considerare il caso **Da approfondire**, anche se lo hai preso in carico o lo hai respinto. Nessuna di queste scelte autorizza automaticamente una correzione o una chiamata AI. Per riaprire il capitolo serve sempre il flusso **Rivaluta / Riparti** con le sue conferme.

## Validità, storico e privacy

La scelta si riferisce a una voce **esatta e ancora corrente**: capitolo, tornata, citazione, prove mancanti, suggerimento e ragionamento del giudice devono coincidere con l'attuale piano. Se modifichi la prosa o il giudice rivede il controllo, una vecchia decisione **non** vale per il nuovo suggerimento. I gruppi chiusi, già approvati, ancora in attesa del giudice o archiviati non hanno questi pulsanti.

Le annotazioni sono uno **storico append-only di massimo 160 scelte**. L'ultima scelta esatta prevale, compreso l'azzeramento. BookWriter usa Web Locks/CAS, sospende l'autosync GitHub e svuota la coda remota; il log non contiene motivazioni, citazioni, nomi, ID o decisioni. Non vengono inviate note ai dodici revisori, al giudice, al writer o ai modelli di riparazione.

Gli ZIP **content/full**, compresi i backup cifrati, possono contenere questo storico. Importandoli, BookWriter **azzera tutte le ultime scelte attive importate** o elimina l'audit delle scelte importate se il limite di 160 non consente gli azzeramenti. Una copia non prova chi abbia preso la decisione. I push GitHub manuali e gli ZIP esportati possono comunque contenere spoiler.

## Limite

È una scelta su un **suggerimento**, non sulla verità della scena, sulla memoria o sui segreti. Non esegue alcun lavoro al posto dell'autore e non cambia i criteri con cui il giudice autorizza o respinge le correzioni.

Riferimenti: [ADR 0058](../ADR/0058-author-editorial-verification-choices.md), [piano verifiche](editorial-verification-plan.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
