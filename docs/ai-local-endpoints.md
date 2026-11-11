# LM Studio e modelli locali senza API key — issue #146

BookWriter è una SPA: parla **direttamente dal browser** con server OpenAI-compatible, senza backend proxy. Il server locale di LM Studio normalmente non richiede un token.

## Configurazione

1. Carica un modello in LM Studio e avvia il server dalla pagina Developer, oppure con `lms server start --cors`. La porta predefinita è **1234**; per l'accesso da browser abilita CORS.
2. Apri **BookWriter → Impostazioni → Endpoint OpenAI-compatible**, imposta nome «LM Studio» e Base URL `http://localhost:1234/v1` oppure `http://127.0.0.1:1234/v1`.
3. In **Autenticazione AI** scegli **Nessuna autenticazione (solo localhost)**. La password sparisce; una eventuale chiave precedente viene cancellata al salvataggio.
4. Premi **Leggi /models** oppure inserisci manualmente l'ID esatto del modello. Nel Router dei modelli seleziona endpoint e modello; salva le impostazioni.
5. Avvia l'autopilot. `GET /v1/models` e `POST /v1/chat/completions` non includono Authorization quando l'opzione è `none`. Con `API key (Bearer)` la chiave continua a essere necessaria.

## Sicurezza, compatibilità e limiti

- **Solo** gli hostname letterali `localhost` e `127.0.0.1` accettano modalità no-auth; altri hostname, DNS alias e server remoti richiedono API key. Le impostazioni precedenti senza campo `authMode` rimangono autenticate.
- Non esporre il server senza credenziali su `0.0.0.0` o reti condivise. Abilitare CORS da altri siti può esporre prompt/modelli: applica le restrizioni di origine disponibili, mantieni il bind in loopback e valuta l'uso di token.
- `localhost` è il dispositivo su cui gira **il browser**. BookWriter aperto da smartphone o tablet non raggiunge LM Studio sul PC tramite `localhost`; non è presente un proxy. Browser, CORS, mixed content e permessi di rete locale possono limitare il collegamento.
- L'opzione è salvata in IndexedDB e nel backup ZIP **full**; backup **content** non conserva endpoint/chiavi. Import di ZIP full con modalità none su server remoto o con chiave incoerente viene rifiutato; archivi legacy restano compatibili.
- La scoperta `/models` è indicativa; il modello potrebbe richiedere una diversa opzione `max_tokens`/`max_completion_tokens`. I test mock non provano l'inferenza su un server LM Studio reale.

Riferimenti: [guida catalogo](ai-model-inventory.md), [guida output](ai-output-token-parameter.md), [ADR 0127](../ADR/0127-local-ai-unauthenticated-loopback.md), [issue #146](https://github.com/KeyserDSoze/BookWriter/issues/146).
