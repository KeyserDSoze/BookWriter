# ADR 0069 — Bilanciamento della query lessicale di rivalidazione tra le scene correnti

- **Stato:** accettato per v0.11.36
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063–0068

## Contesto

Il recupero cross-chapter offre una query di **singola scena** ai revisori specialistici e una query di **intero capitolo** al direttore e all'audit. Quest'ultima usa fino a sei scene correnti con testo, ma la v0.11.35 prendeva i primi 96 token da ciascuna in un'unica sequenza e si fermava ai **primi 48 termini distinti**. Una prima scena lunga con 48 termini univoci riempiva interamente la query, rendendo invisibile al ranking una scena precedente con un oggetto citato solo nella sesta scena corrente. Lo stesso limite poteva distorcere l'audit della rivalidazione senza modificare gli indici di copertura.

## Decisione

1. Conservare `queryScenes(chapter,currentScene)` e il limite di **6 scene correnti non vuote**, in ordine di scena; con `currentScene` esplicita la query rimane confinata alla scena ricevuta.
2. Calcolare al massimo **96 parole** per ciascuna scena tramite l'attuale `scanWords`, con stopword, casefold, verifica dei bordi delle tre porzioni e campionamento bounded (ADR 0068). Non introdurre sinonimi, alias, embeddings o letture del canone privato.
3. Compilare la query finale a turni: primo termine della prima scena, primo termine della seconda, ... primo termine della sesta; poi secondo termine di ciascuna, fino a massimo **48 termini distinti**. Duplicati vengono ignorati senza consumare slot; l'ordine delle scene non cambia. Unica scena => stesso comportamento della versione precedente.
4. Preservare **inalterati** i 16 nomi letterali di metadati correnti e il limite di 8 match per scena, oltre a punteggi, ordinamento dei candidati, 1.600 scene scansionate, 4 selezionate/2 per capitolo, ancoraggi, contatori, due finestre originali da 1.250 caratteri e i destinatari autorizzati.
5. La settima scena e quelle successive rimangono escluse dalla **sola query di capitolo**: i revisori esaminano i segmenti separatamente. Non introdurre campi persistiti, modifiche ZIP, nuovi prompt o chiamate AI/HTTP. La maggiore copertura **lessicale** non è una garanzia di completezza o di contraddizione dimostrata.

## Verifiche e rischi

Vitest con 70 termini distinti nella prima scena e segnale rilevante soltanto nella sesta; test di singola scena (immutato), esclusione della settima dalla query aggregata, inclusione del testimone nel pacchetto del direttore e non esposizione ai cinque lettori ciechi. Playwright desktop/mobile sul messaggio di rivalidazione, CI, Pages e cleanup su HEAD esatta.

**Tradeoff:** per un dato capitolo alcuni termini della prima scena, prima rappresentati entro i 48, saranno sostituiti da termini delle scene successive. Il risultato è un bilanciamento documentale controllato, non una diagnosi semantica.
