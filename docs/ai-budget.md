# Budget AI preventivo — BookWriter v0.8.1

La redazione multi-agente usa almeno **12 chiamate per segmento**, oltre a giudice, correzioni e sinossi. Per limitare il rischio di spesa, dalla Dashboard del libro apri **Budget AI del libro**. È una protezione **facoltativa**: non cambia retroattivamente i progetti esistenti.

## Prima configurazione

1. In **Impostazioni → Router dei modelli**, imposta i provider e modelli che vuoi usare per brainstorming, prosa, revisori di capitolo, cinque lettori, giudice, remediation e sinossi.
2. Torna alla Dashboard e apri **Budget AI del libro → Tariffe configurate dall'autore**. Seleziona ciascuna coppia **modello / endpoint** usata nel libro; inserisci il prezzo di **input** e di **output** in euro **per milione di token** e salva. Controlla sempre i prezzi sul portale del provider: BookWriter non li scarica né inventa.
3. Inserisci la **soglia in euro** per il periodo (ad esempio 5,00 €) e il **massimo output richiesto per chiamata** (di default 8192 token; intervallo 256–32768).
4. Attiva **Attiva blocco preventivo per le prossime richieste AI di questo libro**, poi premi **Salva budget del libro**. Devi mettere in pausa l'autopilot prima di modificare il budget.
5. Avvia o riprendi l'autopilot. Se il margine stimato non basta per la chiamata seguente, il runner si ferma **prima del contatto con il provider**, e nella Dashboard trovi il motivo. Puoi modificare la soglia, le tariffe o i modelli, quindi riprendere intenzionalmente.

La protezione si applica anche alle proposte AI facoltative di fusione delle scene. Le fusioni manuali e le operazioni locali non richiedono credito AI.

## Come BookWriter decide se può fare la prossima chiamata

Per ogni richiesta AI gestita, il guard calcola:

- la somma delle **stime** delle chiamate del periodo con token input e output completi, ai prezzi che hai inserito;
- una **riserva preventiva** per il nuovo prompt: bytes UTF-8 dei messaggi + overhead, a tariffa input;
- una riserva per il **massimo output richiesto** a tariffa output; il parametro `max_tokens` è incluso nella richiesta AI quando il budget è attivo.

Se stima accumulata + riserva arriva alla soglia, il programma **non invia la chiamata**. La stima non è un preventivo vincolante: i token reali e il comportamento del modello dipendono dal provider.

Il periodo inizia alla prima attivazione del budget. **Alzare il limite** mantiene il periodo e lo storico. **Disattivare e riattivare** crea consapevolmente un nuovo periodo: può consentire di spendere ancora, quindi non è un recupero dei costi del periodo precedente.

## Quando il provider non comunica i consumi

Una chiamata può essere fatturata anche in caso di timeout, interruzione del browser o risposta che non contiene `usage`. BookWriter registra che la chiamata è stata **tentata** prima di inviarla. Se non dispone di entrambi i conteggi o di un listino valido, **blocca conservativamente le nuove richieste**: non attribuisce un costo zero inventato.

Verifica l'importo sul portale del provider. Puoi decidere se correggere prezzi, cambiare periodo o disattivare consapevolmente il budget. Il sistema non può correggere da solo fatture senza accesso a un'API ufficiale del provider.

La Dashboard mostra **Spesa stimata da usage noto**: non è il saldo credito reale e non è la fattura finale.

## Backup e cambi di dispositivo

- **ZIP di soli contenuti:** conserva budget attivato nel libro, attività e token osservati, ma non tariffe globali né credenziali. Il libro importato rimarrà bloccato prima delle nuove chiamate finché non riconfigurerai i prezzi per modello sul nuovo dispositivo.
- **ZIP completo:** conserva anche le tariffe del modello e, secondo la modalità scelta, le credenziali. Proteggilo con una password.
- Il budget è **locale al libro e al browser**, non un plafond transazionale sincronizzato in tempo reale con gli altri dispositivi. Continua a usare il portale del provider come fonte del costo reale.

## Limiti

Questa funzione è una **soglia preventiva stimata**, non un tetto rigido alla fatturazione. Un endpoint può ignorare `max_tokens`, aggiungere token di overhead, addebitare altro, usare prezzi diversi per cached tokens oppure non riportare usage. Il metodo byte UTF-8 + overhead è prudente ma **non** un tokenizzatore ufficiale. Il modello può richiedere più output di quello consentito e generare risultati incompleti; in quel caso rivedi la configurazione e la scena, non canonizzare una prosa tagliata.

Le tariffe sono quelle che inserisci tu, non prezzi verificati automaticamente. Il budget attuale non è globale fra libri, utenti o browser, e non sostituisce limiti ufficiali eventualmente offerti dal provider.

**Riferimenti:** [ADR 0012](../ADR/0012-book-ai-budget-guardrails.md), [issue #17](https://github.com/KeyserDSoze/BookWriter/issues/17), [guida ai token](ai-usage.md).

## v0.11.74 — usage conosciuto ma testo rifiutato

Se il provider restituisce conteggi `usage` validi ma la revisione editoriale o la bozza AI di fusione è rifiutata, BookWriter **non canonizza** il testo e lascia l'Activity `failed/cancelled`, ma conserva i token già riportati dal provider ai fini della stima. Solo i conteggi effettivamente presenti sono registrati: in caso di usage mancante o incompleto il blocco conservativo rimane. [Guida](ai-usage-rejected-responses.md) · [ADR 0106](../ADR/0106-provider-usage-before-editorial-validation.md).
