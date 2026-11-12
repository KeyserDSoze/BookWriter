# ADR 0143 — Diff editoriale per paragrafi a rivelazione privata

- Stato: accettato come **anteprima locale di sola lettura**, non rewind/merge
- Data: 2026-11-12
- Issue: #169, parent #158; dipende dai checkpoint #166, opt-in #167 e retention #168

## Contesto

La #167 conserva coppie di prosa canonica completa solo con consenso separato per libro. La scheda task mostra già il numero delle scene modificate, ma senza una vista testuale è difficile capire quale paragrafo sia cambiato. La prosa privata non deve comparire automaticamente nel DOM né essere inviata a un modello; confronti non limitati tra centinaia di paragrafi o testi lunghissimi rischiano di bloccare l'interfaccia. Non esiste ancora un backup completo del libro per autorizzare un restore.

## Decisione

1. Dopo **Carica confronto della prosa canonica** (lookup IndexedDB con consenso verificato, bookId/activityId fencing), elencare solo i **metadati** delle scene canoniche modificate/aggiunte/rimosse. Identificare scene con la coppia esatta `chapterId,sceneId`, mai titolo o ID scena senza capitolo. Mostrare al massimo 20 scene alla volta ma permettere di espanderne ulteriori 20 con click, senza inventare una copertura totale quando la lista è parziale.
2. Ogni selezione nasconde la prosa. Solo un secondo clic **Mostra anteprima privata dei paragrafi** ricontrolla IndexedDB e consenso per il task prima di inserire testo nel DOM. L'azione **Nascondi** lo rimuove immediatamente; cambiare scena invalida la lettura pendente. Il componente è creato solo quando la snapshot è presente e viene smontato quando l'autore cambia task/libro, cancella il checkpoint o revoca il consenso. Nessuna nuova memoria, log, output o richiesta AI.
3. `diffProseParagraphs` divide i testi preservando caratteri e separatori originali; un LCS di paragrafi **esatti** produce blocchi `before` (rimossi) e `after` (aggiunti) con posizioni. Limitare il calcolo a **160 paragrafi** per lato e **300.000 UTF-16 code unit** per versione: oltre, restituire `too_large` con motivo, **non** un diff parziale dichiarato completo. La vista mostra max **32 blocchi** e abbrevia solo l'anteprima dei paragrafi singolarmente superiori a 1.800 code unit, dichiarando sia la lunghezza originale sia i blocchi omessi. Il checkpoint completo **non** viene modificato o troncato.
4. Il DOM può contenere **prosa privata** solo dopo gesto esplicito, attraverso React `pre` che tratta il testo come testo, non HTML. Impedire a prompt, tool, export ZIP/GitHub, filtri e log di accedere ai contenuti. Non interpretare il diff per paragrafi come word-diff, merge di scene, continuità verificata, revisione approvata, snapshot completa di BookProject o rewind. Non sbloccare freeze, non modificare canone, non aggiungere POST AI.

## Verifica e rischi residui

- Vitest: preservazione CRLF/spazi/Unicode, scene omonime su capitoli diversi, nuove/uscite dal canone, riordini, identità assenti/duplicate, limite numero/char, abbreviazione visibile, input immutati; Playwright desktop/mobile: due clic prima del testo, nascondi, cambio task/libro, revoca/cancellazione. Frontend CI typecheck+Vitest+smoke+build, 4 shard Chromium desktop/mobile, EPUBCheck su quattro EPUB, Pages e cleanup **completed/success stessa HEAD** prima della chiusura della #169.
- La copia locale resta sensibile mentre il DOM è visibile; l'autore decide quando esporla. Revoca effettuata in altre tab richiede una rilettura prima di **nuova** rivelazione; una vista già aperta non è un sistema DRM e non può cancellare copie di testo che un altro programma abbia già letto. Questo limite va considerato in successive protezioni multi-tab.
- Il vero rewind #158 continua a richiedere backup completo, ramo/undo, diff editoriale con scelte di merge e approvazione, controlli writer lock/CAS/lease e invalidazione dei capitoli successivi. Questa ADR non introduce alcuna operazione di restore.
