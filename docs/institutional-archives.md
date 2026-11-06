# Cataloghi istituzionali — Library of Congress (BookWriter v0.9.3)

Il pannello **Redazione multi-agente → Archivi istituzionali**, presente su ogni capitolo, permette di individuare schede di oggetti digitalizzati presso la Library of Congress degli Stati Uniti. È un primo passo verso la ricerca d'archivio prevista nell'[issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).

## Uso

1. Apri il capitolo prima che inizi la redazione e apri **Archivi istituzionali**.
2. Scrivi **da uno a tre argomenti storici pubblici** in righe distinte, preferibilmente in inglese per migliorare la ricerca: per esempio `telegraph communications 1848` oppure `railway maps nineteenth century`.
3. Premi **Cerca schede archivistiche**. Un dialogo mostra **tutte e sole le stringhe** che saranno inviate a `https://www.loc.gov`. Puoi annullare senza fare richieste.
4. Dopo il recupero, apri ogni collegamento per consultare sul sito originale il documento e le indicazioni sui diritti d'uso. La scheda mostra titolo, ID, data e descrizione quando presenti, e la data della consultazione.
5. Riprendi la redazione, se necessario. Lo specialista storico e il direttore editoriale ricevono il catalogo come **piste da approfondire**. Gli altri undici agenti non lo vedono.

**Distinzione essenziale:** un documento presente nel catalogo **non è stato letto** da BookWriter; titolo, data e descrizione del record non sono citazioni dell'originale e non provano un fatto. Il motore rifiuta gli ID di catalogo `loc:...` come `historical.sourceIds`. Gli unici estratti citabili nella tranche attuale restano quelli Wikipedia effettivamente recuperati e associati a una frase testuale valida, pur essendo fonti terziarie.

## Riservatezza e autorizzazioni

Il browser invia solo le query digitate e approvate dall'autore. Non invia scene, sinossi, informazioni private di personaggi, segreti o credenziali. Non esiste un backend/proxy: il servizio remoto può non autorizzare la richiesta tramite CORS. Non proviamo ad aggirare CORS con endpoint terzi o credenziali. Una ricerca può rivelare interessi del romanzo anche se consiste in pochi termini: scegli sempre query pubbliche.

I record salvati rimangono su IndexedDB e negli snapshot ZIP del libro e possono essere sincronizzati nella repository GitHub collegata. **Se la repository è pubblica, anche ricerche e schede lo diventano.** Il numero di ricerche per consultazione è limitato a tre; ogni query recupera al massimo tre schede con richieste seriali. Il catalogo può omettere record disponibili sul sito. L'assenza di risultati **non significa** che il documento non esista.

## Capitoli congelati e problemi di rete

Se si aggiorna il catalogo di un capitolo già congelato, BookWriter recupera prima la sinossi progressiva precedente, riapre il capitolo e invalida quelli successivi. Autosync viene disattivato e la vecchia outbox cancellata sotto Web Locks. La redazione dovrà ricontrollare i capitoli dipendenti prima di pubblicare contenuti sul GitHub del libro.

Durante l'autopilot o un ciclo editoriale attivo il catalogo non è modificabile. Se lo stato cambia durante la ricerca, il risultato viene scartato senza perdere il canon.

Errori HTTP, rate limit 429, risposta troppo grande, timeout, CORS o schede difettose bloccano la ricerca: **nessun dossier parziale viene salvato**. Non è previsto un costo di token AI per la consultazione delle schede; successive chiamate AI della redazione consumano token e rispettano il budget per libro.

## Fonti tecniche e limiti

L'[API JSON/YAML della Library of Congress](https://www.loc.gov/apis/json-and-yaml/) è pubblica e non richiede API key, ma ha limiti di traffico, e il suo indice include anche contenuti non storici. Non si applica un'etichetta automatica «fonte primaria certificata», non vengono scaricati OCR, PDF o opere integrali, e i metadati non sostituiscono lettura diretta e giudizio critico. Per archivi europei/italiani, estratti di fonti primarie, licenze e confronti fra documenti vedi [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).

Riferimenti: [ADR 0016](../ADR/0016-institutional-archive-catalog.md), [Dossier storico](historical-sources.md), [Bibliografia DOI](crossref-bibliography.md).
