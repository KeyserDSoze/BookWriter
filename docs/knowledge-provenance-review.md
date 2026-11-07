# Quando un personaggio conosce una notizia? — v0.11.12

Nelle revisioni di BookWriter una notizia può apparire nel testo **senza essere realmente conosciuta da un personaggio**. Il narratore può raccontarla come fatto, ma un dialogo può mentire, un sogno può anticiparla e una scena non mostrata può spiegare come il personaggio l'abbia appresa.

Per questo, quando i quattro specialisti autorizzati identificano un possibile conflitto di **conoscenza** e lo collegano a una fonte precedente verificabile, il **giudice critico** deve produrre due analisi: quella generale (identità, cronologia, causalità e contesto artistico) e una nuova **Valutazione percorso delle conoscenze**.

Quest'ultima considera separatamente:

- **Passaggio precedente:** narrazione diretta, dialogo/voce riportata, sogno/ipotesi o interpretazione incerta.
- **Passaggio attuale:** le stesse categorie, con una spiegazione indipendente.
- **Percorso della notizia:** accesso esplicitamente escluso dalla prosa, accesso mostrato, possibile apprendimento fuori scena o informazione insufficiente.
- **Conclusione del giudice:** possibile incompatibilità supportata oppure spiegazione alternativa/prove insufficienti.

## Quando una correzione non può essere accettata

Un semplice silenzio del romanzo fra due capitoli **non dimostra** che il personaggio non abbia appreso una notizia. Anche una dichiarazione riportata può essere una menzogna. Se il giudice classifica una delle citazioni come dialogo, sogno, ipotesi o origine incerta, oppure ammette un accesso plausibile non mostrato, il software **non autorizza una remediation di quel conflitto**.

La correzione è valutabile solo quando il giudice, motivando ogni passaggio, classifica entrambe le fonti come narrazione diretta, ritiene esplicitamente impossibile il percorso di accesso all'informazione, conferma lo stesso soggetto, non individua spiegazioni artistiche e considera supportato il conflitto. Restano obbligatorie due citazioni letterali con provenienza valida, e vengono rivalidate prima di generare e salvare la riscrittura. **Nemmeno questo certifica la verità della narrazione o l'intenzione dell'autore.**

## Privacy, storico e backup

I cinque lettori ciechi continuano a non ricevere il pack di fonti precedenti o il canone privato. Il giudice usa il canone nella misura già prevista dalla redazione, ma il nuovo controllo **non aggiunge ulteriori accessi** o chiamate AI. Le decisioni sono archiviate e leggibili nella dashboard; backup ZIP moderni conservano le motivazioni strutturate e gli archivi precedenti restano importabili. Una decisione più vecchia senza la nuova valutazione può essere consultata, ma non basta per autorizzare una nuova riscrittura di un conflitto di conoscenza.

Il confronto rimane basato su pochi estratti locali e sul ragionamento fallibile del modello: il sistema **non possiede un grafo semantico completo** di tutto ciò che ogni personaggio sa.

Riferimenti: [ADR 0045](../ADR/0045-epistemic-knowledge-review-gate.md), [ADR 0044](../ADR/0044-unattested-prior-scene-witnesses.md), [giudizio narrativo strutturato](structured-narrative-adjudication.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
