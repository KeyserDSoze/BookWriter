# Condividere conoscenze dell'autore con revisori selezionati — v0.11.15

Le classificazioni del registro privato delle conoscenze sono **nascoste a tutti i modelli per impostazione predefinita**. L'autore può ora scegliere esplicitamente di condividere la breve citazione precedente e l'interpretazione (`appresa direttamente`, `riferita da altri`, `ancora segreta`) solo con specifici agenti editoriali.

## Come autorizzare

Apri un libro, quindi **Indice eventi candidati** → **Conoscenze interpretate dall'autore**. Prima serve un'annotazione di conoscenza ancora valida, confermata e motivata. In **Autorizzazione esplicita per singola conoscenza** scegli la classificazione e abilita soltanto i destinatari voluti: **Continuità, Timeline, Segreti, Voce dei personaggi e Giudice critico**. Scrivi una motivazione di 12–500 caratteri e conferma l'avviso prima di autorizzare l'invio ai provider AI esterni configurati.

**Nessuna casella è preselezionata.** I cinque lettori ciechi e gli altri tre specialisti non sono abilitabili. La condivisione riguarda **solo quell'interpretazione**, non altri personaggi, alias o decisioni successive. Il pacchetto non include la motivazione privata della conoscenza o quella del consenso, né i segreti della memoria: contiene solo il nome letterale, la breve citazione del manoscritto congelato, la posizione e la classificazione. Anche quella breve citazione può però contenere uno spoiler.

Il revisore autorizzato riceve il pacchetto soltanto se il suo segmento menziona lo stesso personaggio e la scena fonte è **strettamente precedente e ancora valida**. Il giudice lo riceve solo se sta valutando un finding specifico sulla conoscenza, ancorato alla prosa corrente. Le interpretazioni non sono prove di verità e non producono automaticamente modifiche al canone.

## Revocare e rettificare

Premi **Revoca consenso** per impedire nuovi invii della classificazione selezionata. La revoca conserva lo storico e non elimina ciò che è **già stato trasmesso al provider AI**. Cambiare la classificazione, riscrivere la scena, riaprire un capitolo o creare una nuova attestazione invalida automaticamente la vecchia autorizzazione; per condividere una nuova versione devi confermarla di nuovo.

Un consenso concede accesso ai modelli solo per le **richieste AI future** che lo richiedono; nessuna chiamata AI parte quando premi il pulsante. Il salvataggio blocca l'autosync GitHub e svuota la coda, usando gli stessi controlli di concorrenza delle altre decisioni autore.

## Backup, importazione e privacy

Il backup ZIP conserva l'audit delle autorizzazioni e delle revoche. **Quando importi un ZIP, tutti i consensi attivi vengono revocati automaticamente**, così una copia di altra provenienza non riabilita la condivisione; se il registro importato è troppo pieno per aggiungere le revoche, i permessi importati vengono scartati. Le annotazioni private e il consenso possono comparire in un **push GitHub manuale**, anche verso repository pubblici: verifica sempre la destinazione.

Questa non è un'autenticazione crittografica e l'app non può garantire ciò che un provider esterno farà con i dati già inviati. La revoca protegge gli **invii successivi**, non quelli passati.

Riferimenti: [ADR 0048](../ADR/0048-per-knowledge-editorial-recipient-consent.md), [registro delle conoscenze](author-knowledge-registry.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
