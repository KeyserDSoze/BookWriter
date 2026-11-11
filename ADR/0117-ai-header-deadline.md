# ADR 0117 — Deadline configurabile per l'attesa degli header AI

- Stato: accettato
- Data: 2026-11-11
- Issue: #124; epic #6/#17/#20
- Ambito: POST /chat/completions OpenAI-compatible **prima** dell'arrivo degli header HTTP

## Problema

L'ADR 0116 limita il *corpo* JSON a 2 MB e 60 secondi dopo HTTP 2xx. Un provider che non restituisce mai gli header può invece trattenere `await fetch` senza scadenza. Un singolo AbortController non basta se proxy o test fetch non rispettano la cancellazione: la Promise rimane in sospeso, impedendo un recupero supervisionato.

## Decisione

1. Introdurre `EndpointProfile.headerTimeoutSeconds?` con default **300 secondi**, configurabile dal pannello Impostazioni fra **60 e 1800 secondi** (intero). È specifico per provider, non un limite di token/costo. Soglie diverse sono scelte dell'autore per inferenze lente. Valori non validi bloccano il salvataggio; profili legacy senza campo mantengono il default.
2. Su POST usare un `AbortController` dedicato alla fase headers più `Promise.race` fra fetch, deadline e `AbortSignal` del runner. La scadenza abortisce la richiesta e libera il chiamante anche quando fetch non si risolve. Una risposta pervenuta troppo tardi non viene mai analizzata; il suo body viene cancellato best effort senza attendere un cancel che non termina.
3. Al successo cancellare timer/listener; la lettura body prosegue sul `signal` originale con i 60 s e 2 MB dell'ADR 0116. L'interruzione dell'autore prevale su deadline e sugli errori generici. HTTP 4xx/5xx mantiene l'errore per status e non espone il payload.
4. Errori di header in italiano e redatti, nessun URL con credenziali, key, prompt o risposta raw. Il runner registra il tentativo AI prima del POST, l'Activity finisce `failed`, senza output canonizzato e senza token inventati; il provider potrebbe tuttavia aver fatturato il lavoro. Nessun retry automatico o deduzione di spesa zero.
5. La configurazione vive in IndexedDB e nello ZIP **full** soggetto alle regole delle credenziali; lo ZIP solo contenuti non la include. Campo facoltativo per backup precedenti, validato sui backup ostili. Nessuna nuova dipendenza o backend.

## Verifica e limiti

Vitest: fetch mai risolto, abort volontario, risposta 2xx con inferenza lenta lecita, HTTP 429, risposta tardiva, preservazione dei limiti body e usage sconosciuto; Playwright desktop/mobile su revisione fermata durante header, pausa/ripresa, canone invariato e singola richiesta per tentativo. CI con TypeScript, Vitest, smoke, build, E2E ed EPUBCheck; Pages sulla stessa SHA prima della chiusura.

Questa è una protezione *locale del browser*, non un annullamento garantito del calcolo del provider né la certificazione dell'uso fatturato.
