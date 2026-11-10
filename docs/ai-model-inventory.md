# Catalogo modelli AI — lettura controllata (issue #118)

Nelle **Impostazioni → Router dei modelli**, il pulsante di ricerca consulta `GET /models` dell'endpoint OpenAI-compatible configurato. La chiamata richiede una chiave inserita dall'autore ed è **soltanto un aiuto alla scelta**: non avvia scrittura o revisione, non consulta canone/segreti e non conferma che il modello sarà accessibile o fatturato al prezzo inserito.

Il browser usa lo schema `https://` (HTTP ammesso soltanto su localhost), nessun cookie o referrer, `redirect: error`, una richiesta per azione e timeout di 12 secondi. Non riporta nel messaggio di errore il corpo del provider né la chiave. Il JSON è letto in streaming fino a **256.000 byte**, con controllo separato del `Content-Length` (che può essere falso); senza streaming limitabile la risposta viene rifiutata.

Il catalogo deve contenere un array `data` con **1–2.000** oggetti aventi un `id` stringa non vuoto, senza caratteri di controllo, spazi iniziali/finali o più di 256 unità UTF-16. La risposta è trattata come dato esterno: un solo elemento malformato, JSON non valido, catalogo vuoto o eccessivo impedisce di accettare **l'intero batch**. ID identici vengono deduplicati e ordinati. Una risposta rifiutata **non sostituisce** i modelli già presenti: l'autore può riprovare o **inserire manualmente** l'identificatore.

La ricerca non modifica route già salvate o budget e non garantisce che i modelli elencati siano effettivamente richiamabili. Il provider potrebbe non esporre un'API `/models` compatibile; in tal caso l'inserimento manuale rimane la scelta prevista. Nessun backend o proxy aggiunto.

Riferimenti: [epic #6](https://github.com/KeyserDSoze/BookWriter/issues/6), [issue #118](https://github.com/KeyserDSoze/BookWriter/issues/118).
