# ADR 0127 — Endpoint OpenAI-compatible senza autenticazione solo su localhost

- Stato: accettato
- Data: 2026-11-11
- Issue: #146; epic #6
- Ambito: router AI, inventario /models, impostazioni e ZIP full.

## Contesto

BookWriter richiedeva sempre `secret` sia nella POST Chat Completions che in `GET /models`. LM Studio e altri server locali consentono invece inferenza senza API key: credenziali fittizie provocavano Bearer non necessari.

## Decisione

1. `EndpointProfile.authMode?: "api_key" | "none"`, con default legacy `api_key`: la mancanza di segreto non abilita automaticamente la modalità senza autenticazione. Il valore è esplicito e per endpoint.
2. `endpointAuthMode` con `normalizeEndpoint` consente `none` soltanto su hostname letterali `localhost` e `127.0.0.1`. Vietati URL remoti, hostname ingannevoli e valori corrotti prima di qualsiasi fetch. Restano HTTPS per remoto, HTTP solo loopback, nessun redirect/cookie/referrer.
3. La POST `callModel` in `none` non decifra secret e omette Authorization, mantenendo Content-Type; `fetchModels(url,null)` omette Authorization. La modalità con chiave mantiene Bearer, deadline, validazioni, errori, usage e no retry.
4. UI con selettore e password nascosta per none. Il salvataggio valida tutto prima di cifrare, cancella ogni segreto precedente in none e conserva snapshot/fencing. IndexedDB rimane local-first.
5. ZIP full esporta/importa `authMode` opzionale e non conserva chiavi per none; schema reject per no-auth remoto e chiave non nulla. ZIP content esclude endpoint, archivi legacy restano validi.
6. CORS è responsabilità del server locale; Pages su altro dispositivo non accede al PC tramite localhost. Nessun backend o proxy, nessuna garanzia di protezione da altre pagine web.

## Prove e limiti

Vitest su header, secret legacy, URL e valori malevoli, salvataggio e ZIP full/content/legacy; Playwright mock per impostazioni, ricarica e una singola chiamata AI desktop/mobile. CI e collegamento effettivo a LM Studio da verificare separatamente. Nessun bump npm manuale, e chiusura issue solo dopo verifica workflow sulla stessa HEAD.

## Stato release

Incluso nella versione **0.11.90** (#145), mantenendo i limiti a hostname loopback letterali e l'autenticazione Bearer legacy. CORS e model inference effettivi su LM Studio sono da verificare sul PC.
