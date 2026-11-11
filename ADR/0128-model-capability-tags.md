# ADR 0128 — Tag manuali e predefiniti dei modelli per capacità

- Stato: accettato
- Data: 2026-11-12
- Issue: #147; epic #6
- Ambito: inventario /models, router AI, impostazioni IndexedDB e backup ZIP

## Problema

Un unico campo testo elenca i modelli di un endpoint OpenAI-compatible. LM Studio può esporre contemporaneamente modelli per chat, voce e embedding: senza tag e predefiniti l'autore rischia di inviare richieste al modello sbagliato. Il catalogo `GET /models` fornisce soltanto ID e non prova le capacità dei modelli.

## Decisione

1. Aggiungere `EndpointProfile.modelCapabilities?: Record<string, ModelCapability[]>`, con enum chiuso `chat|tools|embedding|voice`. Il campo è assente sui profili legacy; non inferire tag dai nomi, dall'URL, dalla lingua o dalla risposta `/models`. Consentire multi-tag e aggiornamenti manuali immutabili con ricerca e paginazione per 2.000 ID.
2. Il routing Chat Completions mantiene `AppSettings.defaultRoute` e gli override task/libro. Un modello etichettato esplicitamente senza `chat` non può essere chiamato dal runner Chat Completions; rifiuto prima di decifrare segreti o inviare prompt, nessun retry/costo aggiuntivo. I modelli senza tag restano legacy compatibili.
3. `AppSettings.capabilityRoutes?: Partial<Record<"tools"|"embedding"|"voice", ModelRoute>>` conserva scelte opzionali, validate rispetto al tag corrispondente. I predefiniti nuovi **non sono ancora esecutivi** e non cambiano gli adapter API, i budget, i flussi editoriali o i token osservati.
4. EndpointSettingsSaveCoordinator valida tag e predefiniti prima della cifratura e conserva fencing intra-tab. IndexedDB salva la scelta assieme a router e segreti. Un nuovo inventario non attribuisce capacità e non sovrascrive i tag del profilo se modificati durante la richiesta; /models resta advisory.
5. Backup ZIP full conserva mappe tag e predefiniti opzionali, limita record, ID e enum; rifiuta valori ostili e route non taggate prima dell'import. ZIP content non include configurazione, ZIP legacy senza campi resta valido. Nessuna migrazione distruttiva.
6. API /embeddings, generazione/trascrizione vocale e tool-calling strutturato richiedono adapter, preflight privacy e test separati. Un tag non autorizza automaticamente invio del manoscritto a un servizio.

## Verifiche e limiti

Vitest: aggiornamento tag immutabile, multi-tag, no inference, routing Chat preflight, predefiniti incoerenti, Save e ZIP legacy/full. Playwright desktop/mobile per tag e default, persistenza dopo reload, nessuna chiamata reale. CI Frontend completo, Pages e cleanup su stessa HEAD prima di chiudere #147. Numero versione npm invariato fino a release riproducibile.
