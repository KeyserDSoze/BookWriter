# ADR 0157 — Errori spiegati e tentativi correttivi sullo stesso task

- Stato: accettato
- Data: 2026-11-14
- Versione: 0.17.0

## Contesto e decisione

Un revisore può citare una frase non presente letteralmente nel segmento: il rapporto deve continuare a essere scartato. L'autore vuole capire l'errore e consentire al task di riprovare senza cercare le opzioni avanzate. Esiste già una politica opt-in di tentativi limitati per endpoint.

1. `explainAutopilotError` è puro e restituisce testi fissi «Cosa significa» e «Cosa fare». Distinguere prova narrativa/formato da permessi, budget, contesto e blocchi GitHub. Non inventare una causa o promettere che riprovare risolva ogni guasto.
2. Nel pannello di errore, per il task fallito del libro, «Attiva tentativi automatici» chiede conferma: default **due nuovi tentativi** oltre alla richiesta iniziale, su quell'endpoint (anche per altri libri), possibile costo a ogni tentativo. La scrittura rilegge libro, task e impostazioni in una transazione `books+activities+settings+meta`, cambia solo la politica dell'endpoint e registra il dirty marker cloud. Non avvia AI e non modifica il libro: serve Riprendi. Le altre modifiche non salvate delle impostazioni restano tali.
3. Solo errori lanciati da `work.apply` sono `ReplyRejectedError`. Zod e SyntaxError diventano messaggi fissi leggibili, senza path/valori privati o frammenti JSON. Gli altri messaggi di validazione rimangono invariati. Lease, rete, budget, storage e CAS non diventano falsi scarti di risposta.
4. Nel medesimo run, solo quando la politica già esistente autorizza un retry, si accoda al prompt del **medesimo task/ruolo** il motivo dello scarto (max 500 caratteri, serializzato come dato). Si richiede di rispettare formato e prove letterali, mai di aggirare il gate. Nessuna copia della risposta rifiutata o di altri rapporti. Il motivo non viene trasferito al ruolo/task seguente né a una nuova sessione. La nota entra nei normali controlli di contesto e budget e nelle tracce regolate da ADR 0154.
5. Nessun indebolimento dei gate narrativi, delle citazioni, delle fonti o del giudice. Usage osservato resta sull'Activity fallita. Nessun retry automatico di un blocco GitHub e nessun consenso implicito su endpoint con chiave. Backoff, massimo 1–5 retry, annullamento e politica preesistente restano invariati.
6. `missingModelRoutes` usa `routeFor` su tutti i TaskKind, compresi override del libro. Un default globale vuoto non giustifica un avviso se tutte le route effettive sono configurate. Si verifica poi l'autenticazione degli endpoint realmente usati.

## Verifiche e limiti

Vitest: spiegazioni, Zod/JSON senza contenuti privati, limite della nota, route per task e override; integrazione revisore con citazione inventata, retry corretto, usage mantenuto e nessuna nota al revisore successivo; errore di rete senza nota correttiva; attivazione limitata all'endpoint e isolamento fra libri. Playwright desktop/mobile: spiegazione, annullamento/consenso, persistenza dei due tentativi, zero richieste conseguenti al solo clic e assenza del falso avviso modello globale.

Un retry può fallire ancora ed essere addebitato. Non è una certificazione semantica delle risposte. La nota correttiva vale per i retry automatici della stessa sessione: non ricostruisce il contesto di un precedente run manuale.
