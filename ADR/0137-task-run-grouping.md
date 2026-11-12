# ADR 0137 — Raggruppamento per run nel registro Attività

- Stato: accettato come incremento task-first
- Data: 2026-11-12
- Issue: #163, parent #157; collegamenti #162, #17, #158

## Contesto

Dopo più cicli Avvia/Riprendi è difficile attribuire task storici alle singole sessioni. I filtri possono nascondere altre attività dello stesso run e i tentativi senza dati contabili non devono apparire gratuiti.

## Decisione

1. Solo nella pagina Attività, introdurre raggruppamento esplicito per `runId` esatto **dopo** filtro e ordinamento di metadati. Gruppi nell'ordine della prima occorrenza, ordine interno invariato. Task senza run ID: gruppo individuale; non inventare una sessione legacy.
2. I gruppi utilizzano solo le `Activity` filtrate: mai cercare in `output`, prompt, reasoning o `AiLocalTrace`. Non alterare canone, checkpoint, sincronizzazione, writer lock o autorizzazioni. Nessuna richiesta AI. Dashboard compatta invariata.
3. Per ogni gruppo riutilizzare `summarizeTaskTimeline`/`estimatedTaskCostEur`: stima parziale solo con usage completo e tariffe snapshot valide; report valorizzati e tentativi incerti separati; senza report validi indicare «non determinabile», non zero. Non attestare fatture reali o assenza di consumo per tentativi falliti.
4. Reset toggle al cambio libro/consenso e «Azzera filtri»; le tracce sensibili mantengono il fencing già previsto da ADR 0136. Nessuna persistenza del grouping.

## Verifiche

Vitest su run intercalati, ordinamento, dati legacy e costo incerto. Playwright desktop/mobile per raggruppamento, reset e conteggi senza regression privacy. Chiusura #163 solo dopo Frontend CI con 4 shard ed EPUBCheck, Pages e cleanup `completed/success` sulla stessa HEAD. Provider fisico #159 e rewind #158 rimangono separati.
