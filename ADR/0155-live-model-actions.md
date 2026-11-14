# ADR 0155 — Azioni del modello mostrate mentre scrive

- Stato: accettato
- Data: 2026-11-14
- Versione: 0.16.0
- Integra ADR 0134, 0152 e 0154. Non modifica canone, gate, prompt, chiamate né persistenza.

## Contesto

Dall'ADR 0154 il testo in arrivo si vede sempre, ma era solo testo che scorre: l'ultima manciata di righe di un JSON grezzo. L'autore ha chiesto di vedere **le azioni** che il modello sta compiendo. Se fa una revisione, deve passare la revisione che sta facendo: la risposta si compone un pezzo alla volta (un rilievo, una decisione, una voce di memoria), e quando un pezzo è completo lo si vuole vedere in forma leggibile, con le ultime due cose fatte, insieme al testo che scorre.

Quasi tutti i task che decidono qualcosa rispondono con un oggetto JSON in cui ogni elemento di un elenco è un'azione compiuta: rapporto dei dodici revisori (`findings`), giudizio del direttore (`decisions`), piano (`chapters`, `scenes`), memoria (`characters`, `timelineAdd`…), sinossi, analisi d'impatto. Brainstorming, validazione, audience, scrittura sono testo libero.

## Decisione

1. **Lettura tollerante mentre arriva** (`domain/partial-json.ts`). Un lettore puro e totale di un JSON ancora incompleto: ogni valore dice se è `done`; una stringa aperta conserva il testo ricevuto; un escape o un `\uXXXX` spezzato non produce caratteri strani; un numero o un letterale è finito solo quando è certo (`0.` e `1e+` non lo sono); una chiave senza valore è «in attesa». Salta frasi e blocchi di codice prima dell'oggetto (`{` seguito da `"` o `}`). Limiti: 400.000 caratteri, profondità 24, 40 punti di partenza. Non lancia, non valuta nulla, non usa le chiavi come proprietà di un oggetto (nessun rischio da `__proto__`).
2. **Dal testo alle azioni** (`domain/live-progress.ts`, `describeLiveProgress`). Il tipo di risposta si riconosce dalle chiavi scritte finora: rapporto (`verdict`/`findings`/`memoryNote`), giudizio (`reasoning`/`decisions`), piano (`chapters`), scene (`scenes`), memoria (`mode`/`characters`/`timelineAdd`…), sinossi, analisi d'impatto (`rationale`/`affectedSceneIds`), con un suggerimento dal titolo del task per i revisori. Ogni elemento **completo** diventa una scheda (`LiveAction`: tono, badge, titolo, dettaglio, riferimenti); quello in scrittura diventa `forming` con le ultime parole ricevute. Contatori: rilievi (critici, maggiori), accettati/respinti, capitoli/scene, voci aggiornate. Il titolo tecnico «Redazione: continuity 3/36» diventa «Revisione «Coerenza e causalità» · rapporto 3 di 36»; `scene:001:002` diventa «capitolo 1 · scena 2» (e il titolo se il libro lo conosce).
3. **Invariante di stabilità.** Una scheda compare solo quando la sua origine è completa e **non cambia né sparisce più**: id deterministici e unici; le azioni di un prefisso più lungo estendono quelle del prefisso più corto. Perciò **ogni tipo deve essere riconosciuto già dalla sua prima chiave**, e una struttura non riconosciuta **non mostra schede** (solo «sta scrivendo»): un test sul taglio del testo in ogni punto di ogni tipo lo impone. Questo test ha già trovato due errori di progetto (una risposta che inizia con `mode` o `rationale` veniva mostrata come campo generico e poi cambiava scheda).
4. **Testo libero.** Parole, paragrafi e le sole sezioni con titolo (riga di titolo, `**Titolo**`, riga in maiuscolo) a riga conclusa. Nessuna scheda per la prosa semplice: il testo scorrevole basta.
5. **Interfaccia** (`LiveActionFeed`), nel riquadro in basso a destra (compatto) e in Dashboard/Attività (completo): contatori, **ultime due azioni completate**, la scheda **in corso** tratteggiata con la citazione di ciò che sta scrivendo e, sotto, il testo che scorre come prima. Nella vista completa anche «Tutte le azioni fatte finora (N)» e i riferimenti di scena. Il badge di gravità ha il colore della gravità. Animazione d'ingresso disattivata con `prefers-reduced-motion`; la lista delle azioni completate è `aria-live="polite"` (solo aggiunte), la scheda in corso no, per non annunciare ogni lettera.
6. **Solo lettura e volatile.** Tutto è derivato da `LiveAiTrace.textPreview` già in RAM; non si salva nulla, non si approva nulla, non c'è nessuna nuova chiamata o dato che esca dal dispositivo. Una scheda non è un'approvazione: il testo resta provvisorio finché i controlli del canone non lo applicano. Se l'autore cancella le conversazioni, le schede ripartono dal testo nuovo.

## Conseguenze e limiti

- È una lettura di ciò che il modello **dice** di aver fatto: un rilievo scritto non è un rilievo valido (citazioni, ancore e giudice restano i gate).
- I modelli che anteprimano il JSON in modo diverso dal formato richiesto non vengono riconosciuti: si vede il testo che scorre, senza schede.
- Se un modello emette prima del ragionamento lungo, finché non scrive il JSON non ci sono schede (resta «sta ragionando…»).
- Sul telefono il riquadro, più alto di prima, copre parte della pagina: si riduce con «Riduci anteprima streaming».
- L'identificativo del rilievo nelle decisioni del direttore è mostrato così com'è (accorciato): non è risolto in categoria.
- Le azioni non sono rilette dalle conversazioni già concluse in Attività: possibile estensione futura, con la stessa funzione pura.

## Verifiche

Vitest: lettore (completo = `JSON.parse`; taglio in ogni punto senza eccezioni e con valori finiti immutabili; escape e surrogati spezzati; numeri e letterali; chiavi in attesa; frase e blocco di codice prima del JSON; graffe nelle stringhe; input invalido; `__proto__`; profondità e lunghezza; `openLeaf`). Descrittori: per ciascuno dei sette tipi, taglio in ogni punto con azioni stabili, conteggi non decrescenti e riconoscimento dalla prima chiave; scenari puntuali per rapporto, giudizio, piano, scene, memoria, sinossi, impatto e testo libero; brevità dei testi. Playwright desktop e mobile: risposta di revisione inviata a pezzi, sintesi in scrittura, rilievo in scrittura con badge e citazione, soltanto le ultime due schede, conteggi, testo scorrevole ancora presente, vista completa con tutte le azioni.
