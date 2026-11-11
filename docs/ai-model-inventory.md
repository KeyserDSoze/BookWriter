# Catalogo modelli AI — lettura controllata (issue #118)

Nelle **Impostazioni → Router dei modelli**, il pulsante di ricerca consulta `GET /models` dell'endpoint OpenAI-compatible configurato. La chiamata richiede una chiave inserita dall'autore ed è **soltanto un aiuto alla scelta**: non avvia scrittura o revisione, non consulta canone/segreti e non conferma che il modello sarà accessibile o fatturato al prezzo inserito.

Il browser usa lo schema `https://` (HTTP ammesso soltanto su localhost), nessun cookie o referrer, `redirect: error`, una richiesta per azione e timeout **totale** di 12 secondi, inclusa la lettura del corpo dopo gli header. Se un provider non termina il fetch iniziale o lascia lo stream aperto dopo gli header, la ricerca termina anche se l'operazione non rispetta l'abort; una risposta tardiva viene scartata e lo stream cancellato best-effort senza attendere la rete. Non riporta nel messaggio di errore il corpo del provider né la chiave. Su HTTP non riuscito scarta il corpo senza leggerlo, cancellando lo stream best-effort senza nascondere il codice di errore. Il JSON è letto in streaming fino a **256.000 byte**, con controllo separato del `Content-Length` (che può essere falso); senza streaming limitabile la risposta viene rifiutata.

Il catalogo deve contenere un array `data` con **1–2.000** oggetti aventi un `id` stringa non vuoto, senza caratteri di controllo, spazi iniziali/finali o più di 256 unità UTF-16. La risposta è trattata come dato esterno: un solo elemento malformato, JSON non valido, catalogo vuoto o eccessivo impedisce di accettare **l'intero batch**. ID identici vengono deduplicati e ordinati. Una risposta rifiutata **non sostituisce** i modelli già presenti: l'autore può riprovare o **inserire manualmente** l'identificatore.

La ricerca non modifica route già salvate o budget e non garantisce che i modelli elencati siano effettivamente richiamabili. Il provider potrebbe non esporre un'API `/models` compatibile; in tal caso l'inserimento manuale rimane la scelta prevista. Nessun backend o proxy aggiunto.

Riferimenti: [epic #6](https://github.com/KeyserDSoze/BookWriter/issues/6), [issue #118](https://github.com/KeyserDSoze/BookWriter/issues/118).

## Risposte in ritardo e modifiche contemporanee — issue #119

Quando premi **Leggi /models**, BookWriter associa la richiesta all'esatto profilo e alla credenziale presenti in quel momento. Se, durante la lettura, modifichi URL, nome, chiave API o elenco manuale dei modelli oppure rimuovi il profilo, il catalogo in arrivo viene **scartato**: non sostituisce le scelte più recenti. Un messaggio spiega che occorre ripetere esplicitamente la ricerca; non viene avviato alcun retry o AI.

Due ricerche contemporanee sul medesimo endpoint sono autorizzate soltanto in ordine di esito: **può applicarsi solo l'ultima richiesta esplicita**, purché il profilo non sia stato modificato. L'identità viene verificata in memoria; la chiave API non viene inserita in log o nella documentazione di audit. Questa protezione vale per la scheda attiva, non pretende di coordinare impostazioni modificate da un secondo dispositivo né certifica la disponibilità del provider.

[ADR 0113](../ADR/0113-stale-model-inventory-response-fence.md) · [Issue #119](https://github.com/KeyserDSoze/BookWriter/issues/119).

## Salvataggio delle impostazioni durante la cifratura — issue #121

Il pulsante **Salva impostazioni** cifra localmente le nuove chiavi tramite Web Crypto. Se nel frattempo modifichi URL, nome, modelli, router, chiave draft oppure rimuovi un endpoint, il salvataggio basato sulla vecchia configurazione viene rifiutato; i campi che stai modificando restano intatti e un messaggio invita a verificare la scelta e premere di nuovo **Salva impostazioni**. Anche un doppio click è protetto: solo la richiesta più recente può completare l'aggiornamento UI.

Questa è una garanzia **intra-tab**. Una transazione IndexedDB già inviata non può essere cancellata retroattivamente: gli edit successivi sono volutamente non salvati finché l'autore non ripete il salvataggio. Non vengono inviate chiavi ad altri servizi, non si avvia l'autopilot né si introduce un vault E2EE. [ADR 0114](../ADR/0114-endpoint-settings-save-fencing.md) · [issue #121](https://github.com/KeyserDSoze/BookWriter/issues/121).
