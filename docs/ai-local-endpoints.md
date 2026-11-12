# LM Studio e modelli locali senza API key — issue #146

BookWriter è una SPA: parla **direttamente dal browser** con server OpenAI-compatible, senza backend proxy. Il server locale di LM Studio normalmente non richiede un token.

## Configurazione

1. Carica un modello in LM Studio e avvia il server dalla pagina Developer, oppure con `lms server start --cors`. La porta predefinita è **1234**; per l'accesso da browser abilita CORS.
2. Apri **BookWriter → Impostazioni → Endpoint OpenAI-compatible**, imposta nome «LM Studio» e Base URL `http://localhost:1234/v1` oppure `http://127.0.0.1:1234/v1`.
3. In **Autenticazione AI** scegli **Nessuna autenticazione (solo localhost)**. La password sparisce; una eventuale chiave precedente viene cancellata al salvataggio.
4. Premi **Leggi /models** oppure inserisci manualmente l'ID esatto del modello. Nel Router dei modelli seleziona endpoint e modello; salva le impostazioni.
5. Avvia l'autopilot. `GET /v1/models` e `POST /v1/chat/completions` non includono Authorization quando l'opzione è `none`. Con `API key (Bearer)` la chiave continua a essere necessaria.

## Sicurezza, compatibilità e limiti

### Modalità nativa e reasoning per attività

Dopo la configurazione base, puoi selezionare **Protocollo AI: LM Studio nativo**. L'app deriva l'URL `/api/v1/chat` dal Base URL locale `http://localhost:1234/v1`; invia `store:false`, `stream:true`, senza plugin o tool, e visualizza eventi reali di prompt e risposta. Puoi impostare l'attesa SSE 600–3600 secondi e il reasoning per ogni tipo di attività nel router, con override per libro in pausa. In nativo sono supportati Low, Medium, High: per Extra high cambia consapevolmente modalità o seleziona un livello supportato. La prova fisica con Muse Glimmer non è sostituita dai test mock. [Guida](ai-task-inspection.md) · [ADR 0135](../ADR/0135-native-lmstudio-task-reasoning.md).


- **Solo** gli hostname letterali `localhost` e `127.0.0.1` accettano modalità no-auth; altri hostname, DNS alias e server remoti richiedono API key. Le impostazioni precedenti senza campo `authMode` rimangono autenticate.
- Non esporre il server senza credenziali su `0.0.0.0` o reti condivise. Abilitare CORS da altri siti può esporre prompt/modelli: applica le restrizioni di origine disponibili, mantieni il bind in loopback e valuta l'uso di token.
- `localhost` è il dispositivo su cui gira **il browser**. BookWriter aperto da smartphone o tablet non raggiunge LM Studio sul PC tramite `localhost`; non è presente un proxy. Browser, CORS, mixed content e permessi di rete locale possono limitare il collegamento.
- L'opzione è salvata in IndexedDB e nel backup ZIP **full**; backup **content** non conserva endpoint/chiavi. Import di ZIP full con modalità none su server remoto o con chiave incoerente viene rifiutato; archivi legacy restano compatibili.
- La scoperta `/models` è indicativa; il modello potrebbe richiedere una diversa opzione `max_tokens`/`max_completion_tokens`. I test mock non provano l'inferenza su un server LM Studio reale.

Riferimenti: [guida catalogo](ai-model-inventory.md), [guida output](ai-output-token-parameter.md), [ADR 0127](../ADR/0127-local-ai-unauthenticated-loopback.md), [issue #146](https://github.com/KeyserDSoze/BookWriter/issues/146).

## Thinking: da dove arrivano i livelli e come impostarli

LM Studio dichiara per ogni modello i livelli di reasoning ammessi e quello predefinito (`GET /api/v1/models` → `capabilities.reasoning`). BookWriter li legge **solo** quando premi «Leggi /models» su un endpoint localhost senza chiave e li conserva con le impostazioni; per gli altri provider restano «non verificati».

Dove si imposta (vince il più specifico): override del **libro** → **attività** (Router dei modelli) → **endpoint**. «Automatico» non invia il parametro e il modello usa il proprio predefinito (per Muse Glimmer: High). Un livello che il modello non dichiara non viene inviato. «Applica thinking consigliato» imposta tutte le attività in un colpo, usando solo i livelli dichiarati.

## Test end-to-end con LM Studio reale (opt-in)

I test Playwright normali usano mock deterministici e non provano il modello reale. In `src/frontend/e2e/live/` ci sono test **live**, attivi solo se imposti le variabili:

| Variabile | Significato |
| --- | --- |
| `LMSTUDIO_MODEL` | ID del modello (es. `meta/muse-glimmer`). Senza, il progetto `live-lmstudio` non esiste e CI e run normali restano identici. |
| `LMSTUDIO_BASE_URL` | Base URL, solo `http://localhost` o `127.0.0.1` (default `http://localhost:1234/v1`). |
| `LMSTUDIO_TASK_TIMEOUT_MS` | Attesa massima per un task del modello (default 600000). |
| `LMSTUDIO_REQUIRED=1` | Se LM Studio non è pronto il test fallisce invece di essere saltato. |
| `LMSTUDIO_FULL_TASK=1` | Attiva anche il test che attende un task completo (nota applicata nel commit, usage comunicato), con attesa streaming di 3600 s. |

Prima di ogni test viene fatta una sonda reale su `GET /models`: server raggiungibile e modello elencato, altrimenti il test è saltato con il motivo. Con CORS attivo in LM Studio:

```powershell
$env:LMSTUDIO_MODEL="meta/muse-glimmer"; $env:LMSTUDIO_BASE_URL="http://localhost:1235/v1"
npm run test:e2e:live
```

I test configurano l'endpoint dall'interfaccia (compreso «Leggi /models»), attivano streaming SSE e ispezione, verificano che il testo arrivi in tempo reale, che «Pausa» non applichi nulla e che un intervento registrato compaia nel prompt realmente inviato. Con le variabili impostate anche `npm run test:e2e` li esegue (solo desktop). L'output di un modello reale non è deterministico: i test non verificano il contenuto narrativo. Un modello con reasoning lungo (es. `meta/muse-glimmer`) può restare oltre 10 minuti nella fase «Il modello sta ragionando» senza scrivere testo: con il limite streaming predefinito (600 s) il task termina in errore e nessun testo viene applicato. Per i libri reali alza «Tempo massimo lettura streaming» nelle Impostazioni o abbassa il reasoning effort.

## Versione

La modalità localhost senza API key è inclusa nella **0.11.90**. La raggiungibilità reale del server LM Studio, CORS e i modelli caricati vanno verificati sul PC dell'autore.
