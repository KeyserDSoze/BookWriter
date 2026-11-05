# Bibliografia DOI del capitolo — BookWriter v0.9.1

BookWriter permette ora di raccogliere in ciascun capitolo i **metadati di pubblicazioni con DOI**, ricavati dal registro Crossref. È un complemento al [dossier storico con Wikipedia](historical-sources.md), non un motore che legge automaticamente studi o certifica la verità storica.

## Aggiungere riferimenti

1. Nella Dashboard, apri **Redazione multi-agente** e, sotto il capitolo pertinente, espandi **Bibliografia DOI**.
2. Inserisci **uno fino a cinque DOI pubblici**, ciascuno su una riga, come `10.1234/esempio` oppure `https://doi.org/10.1234/esempio`.
3. Premi **Recupera metadati DOI**. Prima di inviare qualsiasi richiesta, BookWriter mostra l'elenco **esatto** dei DOI normalizzati e ti chiede di confermare la trasmissione a `api.crossref.org`.
4. Se disponibili, vedrai titolo, autori, anno di pubblicazione, editore, rivista o collana, tipo dell'opera e link al DOI. Per valutare un'affermazione storica, **apri il lavoro originale e verifica il passaggio pertinente**: il catalogo non ne contiene il testo.

Il DOI è un identificatore pubblico; la selezione di DOI specifici può però rivelare il tema del tuo romanzo. Non copiare nei campi query, scene, segreti, informazioni personali o link privati: il browser invia ogni DOI che approvi al servizio esterno.

## Come li usano i revisori

Il revisore di **accuratezza storica** riceve l'elenco bibliografico del capitolo. Potrà suggerire di consultare uno dei lavori, ma **non** dichiarare che dimostri qualcosa sulla base del solo titolo o dell'anno.

Il **direttore editoriale** vede gli stessi riferimenti e può respingere rilievi speculativi, spiegando che i metadati non costituiscono evidenza. Gli altri undici agenti, compresi i cinque lettori in cieco, non ricevono questo elenco; i segreti e il canone privato mantengono le precedenti regole di visibilità.

La differenza fondamentale:

- **Wikipedia italiana:** BookWriter dispone di un estratto testuale e può verificare che la frase citata dall'AI compaia davvero in quell'estratto. Non prova comunque la verità storica della frase.
- **Crossref:** BookWriter dispone soltanto di **metadati bibliografici** (DOI, titolo, autori, anno, editore). Non può accettare i metadati come citazione documentale di una proposizione; il lavoro va consultato separatamente.

La pubblicazione con DOI **non è necessariamente sottoposta a peer review** e può essere stata corretta o ritirata. L'anno della pubblicazione **non** coincide necessariamente con quello degli eventi narrati.

## Congelamento, backup e sincronizzazione

La bibliografia rimane nel libro locale (IndexedDB), viene inclusa nei backup ZIP e può essere sincronizzata sul GitHub del libro. Una repository pubblica rende visibile anche la scelta dei DOI. Il dossier conserva lo storico delle consultazioni e le versioni attive dei riferimenti.

Se aggiungi o aggiorni DOI in un capitolo **congelato**, BookWriter riapre la review del capitolo e invalida i congelamenti successivi. Prima di questa operazione salva il contesto del romanzo dalla sinossi precedente, senza tagliarlo. La sincronizzazione automatica viene disabilitata e l'outbox precedente rimossa. Devi ripetere la redazione prima di far avanzare il libro.

Durante una review o quando l'autopilot è in esecuzione non puoi cambiare il dossier; termina il ciclo prima della nuova ricerca.

## Cosa succede quando Crossref non risponde

- **404**: quel DOI non è censito in Crossref. Non significa che il lavoro non esista.
- **429 / timeout / CORS / offline**: nessun dossier parziale viene applicato; prova in seguito e consulta il DOI tramite il browser.
- **Risposta malformata, DOI diverso o payload troppo grande**: BookWriter interrompe il salvataggio per sicurezza.
- **Dati incompleti**: il registro può non avere autori, anno o rivista. La scheda lo indica senza inventare informazioni.

Il servizio non richiede l'inserimento di credenziali; BookWriter non usa un backend né un proxy. Non carica abstract o PDF dei lavori, non fa scraping e non invia interi capitoli o segreti all'API. La consultazione DOI non consuma token del provider AI; le successive review sì e rispettano il [budget del libro](ai-budget.md).

I limiti, le scelte architetturali e i test sono descritti in [ADR 0014](../ADR/0014-doi-bibliographic-leads.md), con i futuri archivi istituzionali e le fonti primarie ancora aperti nell'[issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
