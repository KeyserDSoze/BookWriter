# BookWriter v0.10.0 — riverifica degli estratti OCR Library of Congress

Dopo l'acquisizione di un breve estratto LoC nella v0.9.9 puoi controllare nuovamente **sul servizio istituzionale** se quel passaggio coincide con il file OCR attualmente disponibile. Questo evita di fidarsi soltanto di un hash conservato nel backup o di un testo JSON modificato.

## Come usare l'audit

1. Apri **Redazione multi-agente → Estratti OCR istituzionali**. Per ogni fonte `lococr:` ancora attiva compare **Riverifica OCR online**.
2. Il dialogo richiede un **consenso separato**: esegue al massimo due letture pubbliche, prima il dettaglio della scheda su `www.loc.gov`, poi il singolo file già archiviato su `tile.loc.gov` **solo se ancora presente e ammesso fra le risorse della scheda**. Non trasmette parti del romanzo, citazioni, hash, note diritti o token.
3. L'app confronta identità della scheda, autorizzazione di accesso al file, **SHA-256, lunghezza del testo e frase esatta all'offset salvato**. Se coincidono, compare **Confronto OCR remoto riuscito** con data e ora. Lo stato è **temporaneo**: non viene salvato nel libro, nei backup o su GitHub e scompare alla ricarica.
4. Se la risorsa non è più elencata o la frase/hash non coincide, compare **Discordanza OCR remota**. Non è prova che il documento storico sia falso: un archivio può spostare o aggiornare i file.
5. In caso di discordanza puoi decidere se usare **Escludi OCR discordante**. Un **secondo dialogo** spiega gli effetti: lo snapshot e i report restano consultabili, ma il testo non sarà più disponibile nelle nuove review. Se il capitolo era frozen, vengono riaperte la review e le approvazioni dei capitoli successivi; la prosa non viene cancellata. Autosync viene disattivato per una risincronizzazione consapevole.

## Quali errori non sono una discrepanza

Se l'API LoC non risponde, restituisce CORS, 429, JSON malformato, un file non leggibile o segnala **restrizioni d'accesso o download**, BookWriter si ferma **senza scaricare la risorsa e senza dichiarare un confronto positivo o negativo**. Non tenta proxy, bypass dei divieti o altri URL. L'assenza di un file ammesso può essere una variazione del catalogo, non una prova storica.

## Protezioni e limiti

- La verifica usa host HTTPS fissi, nessun cookie, credenziale, redirect o referrer; limiti 240 KB JSON / 160 KB file testuale e timeout 12 secondi per chiamata. Il testo completo è letto soltanto **in memoria** per calcolare l'impronta e l'offset, non archiviato come copia completa.
- Solo il frammento breve già acquisito viene conservato nel dossier e può raggiungere backup/GitHub/modelli AI come autorizzato dall'autore in v0.9.9. La riverifica non invia nuove parti private alla Library.
- Hash coincidente significa **solo** «il file restituito dal servizio contiene gli stessi caratteri dello snapshot». Non prova che l'OCR riproduca esattamente un originale storico, che un evento narrato sia vero né che esistano diritti di pubblicazione. L'etichetta resta `institutional_ocr_unverified`, i diritti `author_attested_unverified`.
- Lo stato positivo non è firmato dall'istituzione e non sopravvive al refresh. La verifica non è automatica a ogni review e non richiede connessione continua. Una fonte non riverificata resta classificata come non autenticata.
- I test simulati desktop/mobile non dimostrano che le collezioni LoC espongano davvero un file .txt accessibile con CORS dal dominio dell'app. Prima di affidarti alla fonte verifica nel browser la risorsa, le condizioni di accesso, il documento originale e i diritti.

Riferimenti: [ADR 0023](../ADR/0023-loc-ocr-remote-audit-and-quarantine.md), [guida acquisizione OCR](loc-ocr-excerpts.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
