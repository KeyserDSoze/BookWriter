# Consumi AI — guida ai token per libro e modello

La sezione **Dashboard → Consumi AI registrati** mostra i token dichiarati dagli endpoint AI nei log del libro attivo. Non genera nuove chiamate ai modelli e non richiede credenziali aggiuntive.

## Compatibilità dei limiti output Chat Completions — issue #135

Quando il budget AI abilita il cap output, il client usa una sola chiave per endpoint: `max_tokens` (default per i vecchi profili) oppure `max_completion_tokens`. Il secondo può includere token di ragionamento non visibili: i token `completion_tokens` effettivamente riportati dal provider restano il dato osservato, senza inferenze sul costo reale. In caso di rifiuto o timeout non avviene alcun retry automatico con l'altro parametro: un uso mancante resta incerto e può attivare lo stop conservativo. [Guida](ai-output-token-parameter.md) · [ADR 0122](../ADR/0122-chat-completions-output-cap-parameter.md).

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

## Avvisi anticipati della soglia stimata — issue #132

La Dashboard, quando il budget opzionale è abilitato, mostra un avviso **dall'80% del consumo stimato conosciuto** del libro e, indipendentemente, dell'ultima sessione `runId`. Se il valore noto è arrivato al 100% compare un avviso di tetto raggiunto. **Se anche un tentativo ha usage incompleto/in corso o tariffa assente, non viene mostrato alcun margine disponibile**: “consumi incerti” non significa zero fatturato. È una segnalazione informativa, distinta dal preflight che considera la riserva del prossimo prompt e può bloccare anche sotto l'80% già osservato. [Guida](ai-budget.md) · [ADR 0121](../ADR/0121-early-ai-budget-headroom-warnings.md).

## Limite di stima per ogni sessione AI — issue #130

L'autore può impostare `sessionLimitEur` facoltativo sul budget del libro. Ogni Avvia/Riprendi crea un nuovo `runId`; il preflight confronta **l'uso osservato di questa sessione + riserva della nuova richiesta** con il suo plafond, oltre a far rispettare il limite globale di libro. Usage mancante, parziale, `running` o tariffe invalide **non** equivalgono a costo zero. Una nuova sessione non cancella le richieste e le spese precedenti dal libro, e non dimostra fatture ufficiali. [Guida](ai-budget.md) · [ADR 0120](../ADR/0120-session-ai-budget.md).

## Storico dei costi per task — issue #128

Nella Dashboard → Budget AI del libro, **Storico dei costi per task AI** mostra fino a dieci tentativi recenti, con espansione esplicita e filtro **Solo tentativi senza stima**. Ogni tentativo mantiene distinti token osservati, tariffa snapshot/legacy, stato ed euro soltanto stimati; dati mancanti o `running` non sono spesa zero. La vista usa solo Activity locali del libro e resta disponibile a budget disattivato. Non visualizza il saldo o la fattura vera. [Guida](ai-cost-history.md) · [ADR 0119](../ADR/0119-task-ai-cost-history.md).

## Esportazione CSV del ledger AI — issue #126

Nel pannello **Budget AI del libro** puoi scaricare il **registro CSV dei singoli tentativi AI** del solo libro selezionato, anche senza avere attivato il budget. Oltre ai token realmente osservati, il file separa le stime monetarie basate sui prezzi manuali e una colonna fattura provider **vuota**, mai simulata. Non include testo, prompt, errori o credenziali; gli identificatori importati vengono protetti da formule CSV. [Guida](ai-cost-ledger.md) · [ADR 0118](../ADR/0118-local-ai-cost-ledger-csv.md).

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

## v0.11.76 — snapshot del listino al momento della chiamata

Per le richieste nuove con listino manuale valido, il prezzo di input/output per endpoint/modello è congelato in `Activity.priceRateSnapshot`: modificare il listino non ricalcola la stima dei consumi passati con snapshot. Le attività legacy prive del campo rimangono stimabili a tariffa corrente, ma l'interfaccia segnala esplicitamente questa limitazione. [Guida](ai-budget-price-snapshots.md) · [ADR 0108](../ADR/0108-price-snapshot-ai-budget.md).

## v0.11.78 — parti provider non testuali o malformate

HTTP 200 può includere `usage` valido ma un array `choices[0].message.content` con `null`, immagini, numeri o oggetti non testuali. BookWriter **rifiuta tutto il contenuto** senza coercizioni o approvazioni parziali, ma conserva i token sanitizzati riportati dal provider nell'Activity fallita; le tariffe pre-fetch rimangono valide e i token mancanti restano incerti. [Guida](ai-provider-content-validation.md) · [ADR 0110](../ADR/0110-provider-mixed-content-rejection-usage.md).


## Rilascio degli avvisi preventivi — v0.11.86, issues #132/#133

Le notifiche budget all'80% del consumo stimato conosciuto, separate fra libro e ultimo `runId`, sono incluse in BookWriter **0.11.86**. L'uso incerto sopprime il margine apparentemente spendibile e il warning non cancella né riavvia il budget, non sospende automaticamente la richiesta e non misura il saldo remoto. [ADR 0121](../ADR/0121-early-ai-budget-headroom-warnings.md) · [guida budget](ai-budget.md).
