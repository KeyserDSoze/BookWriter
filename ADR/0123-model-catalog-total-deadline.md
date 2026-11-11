# ADR 0123 — Deadline totale per il catalogo modelli OpenAI-compatible

- **Stato:** implementato su `main`, in attesa di CI completa
- **Data:** 2026-11-11
- **Issue:** [#139](https://github.com/KeyserDSoze/BookWriter/issues/139), epic #6
- **Riferimenti:** [guida catalogo](../docs/ai-model-inventory.md), [ADR 0113](0113-stale-model-inventory-response-fence.md)

## Problema

La chiamata `GET /models` aveva un timeout di 12 secondi gestito dal controller di `fetch`. Dopo l'arrivo degli header, `boundedModelCatalog` attendeva direttamente `reader.read()`: una risposta che non terminava, oppure un'implementazione che ignorava il segnale di abort, poteva bloccare la ricerca e impedire il ripristino dell'interfaccia.

## Decisione

1. Mantenere **una sola deadline di 12 secondi per l'intera GET**, senza azzerarla all'arrivo degli header. Passare il segnale del controller al lettore e competere `reader.read()` con una Promise di interruzione. Anche una lettura che ignora il segnale deve terminare lato applicazione.
2. La cancellazione esplicita dell'autore ha precedenza sul timeout nel livello `fetchModels`; non presentare un catalogo parziale e non alterare i modelli salvati. Il callback di fencing della #119 rimane il gate di commit.
3. Dopo un errore cancellare il reader **best-effort e senza attesa**: non mascherare l'errore originale se `cancel()` fallisce sincronicamente o restituisce Promise rifiutata, o se `releaseLock()` lancia.
4. Restano obbligatori HTTPS (con eccezione localhost), credenziali fuori da log e errori, no cookie/redirect, massimo 256.000 byte, JSON UTF-8 valido, 1–2.000 ID e inserimento manuale come fallback. Nessun nuovo tentativo automatico o seconda GET.

## Verifiche e limiti

Vitest: risposta valida, JSON e MIME non conformi, limite header e limite stream, abort dopo header con `read()` sospeso, timeout totale della richiesta e cancellazione difettosa sincrona/asincrona. CI browser e deploy devono essere verificati su una HEAD unica prima di chiudere #139. I mock non attestano compatibilità CORS di provider reali.
