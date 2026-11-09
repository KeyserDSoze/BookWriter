# ADR 0066 — Due finestre mirate nei confronti di continuità

- **Stato:** accettato per v0.11.33
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063, 0064, 0065

## Contesto

Il recupero cross-chapter già seleziona fino a quattro scene precedenti e mostra, per ogni scena lunga, due finestre da 1.250 caratteri. La v0.11.31 ha reso la prima finestra affidabile, centrata sulla menzione a parola intera con offset originale, ma assegnava sempre la seconda finestra a un contesto distante (inizio o fine). Se in una stessa scena erano citati un personaggio al centro e un oggetto rilevante in un altro punto, il secondo riferimento poteva rimanere invisibile ai revisori **anche se il ranking aveva già identificato entrambi i segnali**.

## Decisione

1. Conservare il ranking locale, i contatori e il numero massimo di candidati/scene esaminate. Non introdurre una ricerca semantica né inferire alias, possesso o collegamenti causali.
2. In `targetedLiteralWindows` con prosa più lunga di 2.800 caratteri, scegliere la prima finestra sulla **prima corrispondenza a parola intera** seguendo l'ordine dei segnali già fornito da `buildContinuityEvidence`: `literalEntities`, `entities`, `terms`. Usare sempre la stringa originale con confini Unicode e offset UTF-16, come in ADR 0064.
3. Esaminare i segnali successivi fra i primi 48, senza superare la lunghezza massima 100 e minima 3 per termine. Se il primo match letterale di un **altro segnale** cade fuori dalla prima finestra, centrare su quel match la **seconda** finestra. La seconda finestra può sovrapporsi parzialmente alla prima se i riferimenti sono vicini, ma non coincide con la prima. Se nessun altro segnale è esterno, mantenere il precedente fallback distante da inizio/fine.
4. Mantenere massimo **due** finestre da **1.250** caratteri, sempre estratte con `text.slice`, in ordine crescente di offset, senza concatenare parti scollegate sotto una falsa citazione. Le scene <=2.800 caratteri mantengono una sola finestra integrale. Il risultato non è prova che il romanzo sia stato esaminato per intero; `coverage=partial` e conteggi di omissione rimangono veritieri.
5. Conservare gli stessi destinatari e permessi: quattro specialisti autorizzati e giudice, revisore storico solo se trigger storico, mai i cinque lettori ciechi. Nessuna nuova richiesta HTTP/AI, schema persistito, condivisione di segreti, note o decisioni alias, correzione automatica, mutazione del canone o del freeze.

## Tradeoff e verifiche

Con due riferimenti effettivi, i revisori possono vedere due frammenti più utili **senza aumentare la quantità massima di prosa** condivisa. Un secondo passaggio di ricerca sui segnali aumenta eventualmente il lavoro CPU locale e può restituire citazioni vicine o sovrapposte. Testare due menzioni lontane, fallback quando i segnali sono vicini o assenti, nomi con metacaratteri regex, esattezza degli offset, reversibilità delle proiezioni, privacy e isolamento dei lettori, più Playwright desktop/mobile sull'avviso UI. Nessuna corrispondenza letterale diventa attestazione di un fatto narrativo.
