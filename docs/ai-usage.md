# Consumi AI — guida ai token per libro e modello

La sezione **Dashboard → Consumi AI registrati** mostra i token dichiarati dagli endpoint AI nei log del libro attivo. Non genera nuove chiamate ai modelli e non richiede credenziali aggiuntive.

## Come leggere i numeri

| Misura | Significato |
| --- | --- |
| Token input | Somma dei token di prompt/input effettivamente riportati dal provider |
| Token output | Somma dei token generati/output effettivamente riportati |
| Totale noto | Input + output osservati, non necessariamente i token fatturati |
| Report completi | Il provider ha comunicato sia input sia output (anche se valgono 0) |
| Report parziali | Il provider ha comunicato solo input oppure solo output |
| Report mancanti | L'attività AI ha un modello/endpoint, ma nessuno dei due conteggi è disponibile |
| Modello / endpoint | Gruppi separati: lo stesso nome modello su due servizi diversi non viene sommato come un unico provider |

Sono mostrate le attività registrate **soltanto per il libro selezionato**. Gli interventi manuali che non invocano l'AI non vengono sommati come chiamate a pagamento.

## Quando il totale noto è inferiore alla spesa reale

Una chiamata può essere fatturata anche quando il browser viene chiuso, quando premi Pausa, quando la rete cade o quando il provider risponde con errore **senza** un oggetto usage. Alcuni endpoint OpenAI-compatible non restituiscono sempre `prompt_tokens` e `completion_tokens`.

Per questo l'app mostra un avviso sui report parziali o mancanti e sulle attività fallite/interrotte. Non stima automaticamente la parte sconosciuta.

## Crediti e costi

**I token non sono crediti residui.** Un provider può utilizzare tariffe diverse per modello, token di input/output, prompt cache, prefissi condivisi, chiamate ad altri strumenti e periodi promozionali. BookWriter non ha accesso a un saldo crediti standard comune a tutti gli endpoint OpenAI-compatible.

Per conoscere la spesa effettiva e i crediti ancora disponibili, verifica la fatturazione sul portale **del provider specifico** che hai configurato in Impostazioni. Il pannello non mostra prezzi o euro stimati senza un listino reale.

## Privacy e sincronizzazione

Il pannello calcola i dati dalle attività già salvate nel browser, senza inviare statistiche a GitHub o a servizi analitici. In seguito a un import ZIP, la cronologia copiata appartiene al nuovo libro e non modifica i consumi del libro originale. Le API key restano nelle impostazioni cifrate locali.

La lettura dei consumi non fa partire né riprendere l'autopilot. I dati dei report si aggiornano dopo i checkpoint del browser e al cambio di libro.

## Budget preventivo v0.8.1

Puoi attivare dalla stessa Dashboard **Budget AI del libro** e configurare tariffe manuali per endpoint/modello. Il programma stima il costo delle richieste future e le blocca prima del provider se la riserva supera la soglia. Se una risposta non comunica usage, ulteriori chiamate vengono sospese invece di fingere costo zero. È una protezione stimata e non un hard cap della fattura. Guida `docs/ai-budget.md`, ADR 0012.

## Prossime funzioni

L'[issue #17](https://github.com/KeyserDSoze/BookWriter/issues/17) prevede un **ledger economico** con tariffe configurabili per endpoint/modello, valuta e data, seguito da limiti e avvisi di budget per libro e per sessione.

Anche in quella fase bisognerà distinguere il tetto di spesa **stimato** dalla fatturazione reale del provider: una richiesta in volo può essere fatturata e superare il limite prima che il browser la interrompa.

Decisione tecnica: [ADR 0010](../ADR/0010-ai-usage-observability.md).

## v0.11.74 — risultati AI scartati con usage valido

Un errore nel JSON editoriale, nella freschezza del checkpoint o nella validazione della bozza può impedire di applicare il testo **dopo** una risposta valida di trasporto. I token input/output già dichiarati dal provider vengono ora conservati nella Activity `failed/cancelled`, quindi nella stima del budget, senza creare canone fittizio. Le chiamate prive di usage continuano a essere incerte. [Guida](ai-usage-rejected-responses.md) · [ADR 0106](../ADR/0106-provider-usage-before-editorial-validation.md).

## v0.11.75 — output vuoto con usage provider

Un endpoint può completare con HTTP 200 e JSON valido ma nessun contenuto testuale utilizzabile. La richiesta editoriale fallisce e non scrive canone, ma `usage` riportato viene conservato nel registro delle attività se i numeri sono interi non negativi. Manca un conteggio? Rimane incerto e il budget non inventa token. [Guida](ai-empty-provider-usage.md) · [ADR 0107](../ADR/0107-empty-provider-response-usage.md).
