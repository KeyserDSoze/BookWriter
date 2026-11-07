# ADR 0038 — Registro consultivo delle attestazioni e navigazione delle menzioni

- **Stato:** accettato per v0.11.5 (PR #51)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0036 e ADR 0037

## Contesto

L'indice limitato della v0.11.3 scopre fino a 80 menzioni, ma il pannello v0.11.4 ne mostrava solo 30. Lo storico append-only consente rettifiche, ma non offriva una vista narrativa delle **sole attestazioni ancora valide** da confrontare fra capitoli.

## Decisione

1. Mostrare le menzioni già scoperte in pagine di 30, navigabili anche su mobile. Non cambiare il tetto di 80 menzioni, 1.600 scene o le regole lessicali; la paginazione non crea eventi.
2. Derivare in memoria e sul dispositivo un registro da tutte le decisioni salvate (massimo 400), **indipendente dal cap dell'indice**. Ogni attestazione corrente richiede stesso `frozenAt`, scena canonica, timbro del testo, citazione/offset reali ri-estratti e assenza di rettifica più recente sullo stesso testimone. Decisioni obsolete/superate restano nello storico.
3. Mostrare le attestazioni correnti con capitolo, scena, soggetto, citazione, offset e motivazione. Raggruppare per nome letterale i soggetti con attestazioni in più capitoli, **senza** dedurre alias, possessi, conoscenze, causa-effetto, stati correnti o vere contraddizioni.
4. Nessuna nuova persistenza, migrazione, rete, AI, accesso ai segreti, prompt per giudice/revisori, o promozione a canone. I cinque lettori ciechi restano isolati. Snapshot e ZIP invariati: la vista è solo derivata.
5. Regressioni unit su rettifiche, invalidazioni, citazioni inventate, limiti dell'indice; browser mobile/desktop per navigazione e audit.

## Limiti

Il registro rimane una **dichiarazione dell'autore non autenticata**, specialmente dopo import ZIP. Nomi uguali non provano identità; nomi diversi non escludono alias. Più eventi dello stesso soggetto non dimostrano incoerenza. I checksum rapidi non sono firme digitali. Nessuna certificazione di completezza del corpus.
