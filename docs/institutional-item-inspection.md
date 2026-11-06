# Library of Congress — ispezione accesso e diritti v0.9.8

BookWriter può ora chiedere all'API istituzionale della Library of Congress **informazioni aggiuntive su una singola scheda già trovata**, senza scaricare il documento. Serve ad aiutare l'autore a decidere quali originali debbano essere consultati e quali restrizioni valutare.

## Come usare il pannello

Apri **Redazione multi-agente → Archivi istituzionali** e cerca, come già previsto, da una a tre query pubbliche approvate dall'autore. Dopo avere trovato una scheda, premi **Verifica accesso e diritti della scheda**. Un dialogo ti mostra l'ID esatto che verrà consultato su `www.loc.gov`; la richiesta **non** include le query originali, il romanzo, scene, timeline privata, segreti, API key né token GitHub. Non avvia download.

L'ispezione contiene, se l'API li pubblica:

- **Digitalizzazione**: sì/no/sconosciuta sulla base del catalogo; non prova lettura del file.
- **Restrizioni d'accesso**: segnalate/non segnalate/sconosciute, **non** necessariamente restrizioni di copyright.
- **Avvisi sui diritti** e **condizioni d'accesso**: testo ufficiale del record, non interpretazione automatizzata né permesso giuridico.
- **Segnali di risorse digitali/testuali**: soltanto indicatori che il catalogo contiene riferimenti; BookWriter non li scarica e non considera un link come prova del contenuto.

La scheda mostra sempre **«Diritti NON verificati»**, persino se il testo pubblicato dall'istituzione dichiara «no known restrictions»: questa frase, il pubblico accesso o il link digitale non garantiscono la legittimità del riuso in una pubblicazione commerciale o in qualunque giurisdizione. Leggi sempre la pagina originale, le indicazioni sull'uso e contatta l'istituzione se occorre.

## Dossier e review

Il dettaglio LoC è uno snapshot storico `locdetail:...`, **non un documento acquisito**. È conservato nel dossier IndexedDB, nei ZIP e, se scegli di attivare la sincronizzazione, può raggiungere GitHub: usa repository private per libri inediti. Dopo una nuova ispezione resta consultabile la versione precedente per audit, mentre il sistema considera attiva quella della scheda ancora presente nel catalogo.

Il solo **specialista storico** e il **direttore editoriale critico** vedono questi metadati con l'etichetta `catalog_metadata_only`; gli altri undici revisori non li ricevono. Le citazioni `historical.sourceIds` non accettano né gli ID `loc:` del catalogo né gli `locdetail:` del dettaglio. I metadati possono segnalare che serve controllare un originale o un permesso, ma non possono supportare o contraddire da soli un fatto della narrazione.

Se un'ispezione cambia un dossier già congelato, BookWriter riapre quel capitolo, invalida i successivi, recupera la sinossi prima del capitolo, disabilita l'autosync e cancella la vecchia outbox. Non modifica le scene né gli estratti manuali. Se lo stato cambia durante la richiesta, **non salva parzialmente**.

## Privacy, limiti e affidabilità

La chiamata è una sola `GET https://www.loc.gov/item/<id>/?fo=json`, con limite di 240 KB, timeout 12 secondi, nessun cookie/redirect/referrer e un host fisso. I record esterni possono contenere informazioni imprecise, ambigue o obsolete; i campi non forniti rimangono ignoti, non vengono sostituiti con un «nessuna restrizione» inventato. Una CORS error/HTTP 429 non autorizza un proxy esterno improvvisato. I test desktop/mobile simulano l'API e non dimostrano accesso reale da ogni browser.

**Questa funzione non è ancora una consultazione del testo originale.** Per citare brevi passaggi di un originale già letto personalmente puoi usare gli **estratti attestati dall'autore** (v0.9.4), con dichiarazione della base dei diritti, che rimane non verificata dal software. La prossima fase dell'[issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23) dovrà acquisire legalmente contenuti originali, controllarne l'origine e le licenze, e abilitare citazioni effettivamente confrontate con quei contenuti.

Riferimenti: [ADR 0021](../ADR/0021-institutional-item-rights-access-inspection.md), [catalogo LoC](institutional-archives.md), [estratti dell'autore](archival-excerpts.md).
