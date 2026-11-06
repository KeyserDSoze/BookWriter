# ADR 0020 — Audit remoto esplicito delle revisioni Wikisource e quarantena volontaria

- **Stato:** Accettato per v0.9.7 (PR #32)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessore:** ADR 0019

## Problema

Dal v0.9.6 BookWriter registra `itwsr:<pageId>:<revid>:<sha256-16>` con hash SHA-256, posizione e stringa citata. Ma un backup o JSON importato può contenere metadati formalmente corretti e arbitrariamente alterati. La validazione locale non attesta che quel digest corrisponda **oggi** alla risposta MediaWiki della revisione originale. Non dobbiamo spacciare per verifica remota indipendente la semplice presenza di un campo SHA-256.

## Decisione

1. **Audit opt-in per singolo estratto attivo.** Il pannello Wikisource mostra «Riverifica revisione online». Prima del GET, un dialogo esplicita che sarà inviata **soltanto la revisione numerica pubblica**, non titolo, ricerca, citazione, hash, libro, segreti, PAT o API key. L'operazione è disponibile solo su sorgenti `itwsr:` attive con struttura `revisionProof` valida.
2. **Adapter HTTP ristretto e riutilizzato.** Su `https://it.wikisource.org/w/api.php`, `GET action=query&prop=revisions&revids=<id>&rvprop=ids|timestamp|content&rvslots=main&origin=*`, senza credenziali, cookie, referrer o redirect. Timeout 12 secondi e risposta JSON letta in streaming fino a 150 KB. Nessun proxy, URL esterno arbitrario o ripetizione automatica. Il browser calcola SHA-256 dell'intero wikitesto ricevuto.
3. **Comparazione completa:** numero pagina, namespace, titolo, revisione, timestamp, hash SHA-256, lunghezza UTF-16 e **sottostringa letterale allo stesso offset** devono coincidere. La UI distingue `match`, `identity`, `digest`, `excerpt`; il rifiuto remoto, CORS/429/timeout, contenuto nascosto o impossibilità di lettura sono **errore** (`nessuna verifica`), non conferma positiva né prova di falsità della fonte.
4. **Verifica effimera.** Il risultato vive soltanto nello stato della schermata, non è persistito nei backup, non modifica il libro, non aggiorna `updatedAt`, non causa freeze rewind né autosync. Un messaggio «confronto remoto riuscito» indica **solo** la coincidenza di questa risposta con lo snapshot, non un sigillo dell'editore né autenticazione dell'opera originale o dei diritti. Se si ricarica la pagina, deve essere eseguita una nuova verifica prima di mostrare uno stato verde.
5. **Mismatch e quarantena esplicita.** In caso di discordanza, il pannello mostra un avviso, suggerisce di non usare la fonte e propone **separatamente** «Escludi fonte discordante», con un secondo dialogo di conferma che avverte delle conseguenze. Solo su conferma, il use-case rimuove l'ID dalla lista `activeExcerptIds` (snapshot e vecchi giudizi preservati), disattiva autosync, cancella outbox e registra un'attività.
6. **Concorrenza e rewind conservativo:** per la quarantena sono obbligatori i Web Locks `bookwriter:writer:<bookId>` e `bookwriter:github-outbox`, confronto CAS su `updatedAt`, libro paused e nessun ciclo editoriale attivo. Il capitolo frozen viene riaperto con ripristino sinossi e invalidazione di tutti i freeze successivi; se il pregresso non consente un rewind sicuro, nessuna modifica. Il salvataggio è atomico in IndexedDB, non effettua network call.
7. **Nessuna promozione a prova di fatto:** un match non certifica storia, veridicità, testo originario, data reale, autori, copyright, indipendenza o licenza. L'etichetta `work_rights_not_verified` permane; solo specialista storico e direttore possono leggere le fonti, gli altri undici revisori restano ciechi. Nessuna nuova remediation automatica.

## Trade-off e limiti

- La verifica non è un requisito automatico per ogni review. Non è possibile garantirla quando l'autore lavora offline o senza accesso CORS; obbligarla in background invierebbe dati d'uso a un servizio esterno senza un nuovo consenso. I dati strutturalmente validi ma non riverificati restano quindi citabili **come dati locali ricevuti in precedenza**, con etichette non autenticate.
- Una pagina rinominata può produrre `identity` anche quando il suo wikitesto è invariato: non si assume che il documento sia falso; l'autore deve consultare cronologia ed eventuale nuova pagina e approvare una nuova ricerca.
- Il risultato positivo non è firmato dal server Wikimedia e non è registrato in modo permanente; un altro dispositivo o un backup modificato necessita di nuova verifica. Nessun controllo della licenza è automatizzato.
- Un risultato di audit negativo **non ritira autonomamente** un'evidenza. Serve un'azione consapevole; evitare modifiche al canon senza consenso. Questo limite è dichiarato in UI e documentazione.
- I test di rete usano mock: non attestano la disponibilità reale di MediaWiki/CORS dal browser dell'autore.

## Accettazione

- Solo `revids` numerico inviato dopo consenso e niente query manoscritto, hash, testo, credenziali.
- Confronto digest/testo/offset e identità esatti; mismatch visibile ed errori non promossi a successo.
- Audit non modifica IndexedDB; quarantena soltanto su consenso, Web Locks/CAS, rewind e autosync off, vecchi snapshot preservati.
- Regressioni Vitest per fonti alterate, HTTP errors, concorrenza e freeze; Playwright desktop/mobile; CI verde sulla HEAD, merge, Pages e branch cleanup verificati.
