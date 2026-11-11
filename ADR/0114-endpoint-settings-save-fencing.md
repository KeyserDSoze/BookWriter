# ADR 0114 — Fencing dei salvataggi delle impostazioni durante la cifratura

- Stato: accettato
- Data: 2026-11-11
- Issue: #121; epic #6 / #10
- Ambito: pulsante esplicito Salva impostazioni, SPA local-first

## Problema

Un salvataggio di endpoint e router modelli usa Promise.all(encryptLocal(...)), poi saveSettings. Durante la cifratura l'autore può cambiare URL, modello, chiave o eliminare un endpoint. Salvare uno snapshot ormai vecchio e azzerare tutti i keyDrafts cancella lavoro non salvato. Anche due click in sequenza possono completarsi in ordine inverso.

## Decisione

1. Al click fotografare riferimenti immutabili di settings e keyDrafts con i ref sincroni introdotti in ADR 0113. Ogni tentativo ottiene una generazione monotona. Prima della persistenza e dell'aggiornamento visibile tali riferimenti e la generazione devono coincidere con quelli correnti. Non memorizzare hash, token o fingerprint persistenti della chiave.
2. Preparare e cifrare tutte le nuove chiavi come un singolo risultato: se normalizzazione URL o cifratura falliscono, niente commit. La callback di fencing viene controllata prima della persistenza; il database la ricontrolla dopo getDb e immediatamente prima del put, senza ulteriori await nel mezzo.
3. Dopo il commit IDB rivalidare il tentativo. Un edit intervenuto durante la scrittura è ancora un edit non salvato: non resettare le chiavi draft, non sostituire le impostazioni React e non mostrare successo. L'onSaved che conferma lo stato è sincrono dopo l'ultima verifica.
4. Se un tentativo nuovo supera il vecchio, il vecchio non può sovrascrivere il messaggio UI del più recente. L'autore può riprovare deliberatamente dopo un edit; niente retry automatico, nuove chiamate AI, backend o mutazioni del canone.
5. Il parametro di fencing del saveSettings infrastrutturale è facoltativo per compatibilità degli altri chiamanti. Il sistema non promette coordinamento cross-tab/cross-device di tutti gli edit e non annulla una transazione IndexedDB già emessa. Le API del provider e la scelta manuale dei modelli restano invariate.

## Prove e limiti

Vitest: cifratura ritardata con cambio URL, modelli, rimozione, reinserimento draft, secondo click, accesso al DB ritardato e salvataggio positivo con chiave cifrata. Playwright desktop/mobile: simulazione ritardo WebCrypto, edit prima della fine, nessuna scrittura precedente e retry con reload, più click concorrenti e rimozione del profilo. Nessuna chiave reale o testo narrativo trasmesso.

La protezione riguarda il pulsante esplicito del router AI e il suo callback, non tutti i possibili salvataggi globali concorrenti. Una scrittura già avviata non può essere richiamata indietro dopo una modifica UI; un nuovo save è necessario per renderla persistente.
