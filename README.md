# BookWriter

**BookWriter** è un progetto per la scrittura autonoma e supervisionabile di libri con modelli di intelligenza artificiale configurabili.

> Stato: **progettazione / implementazione iniziale**. Le funzionalità descritte sono obiettivi di prodotto, non ancora un'applicazione pronta per la produzione.

## Obiettivi

- Interfaccia responsive React + TypeScript + shadcn/ui, con tema chiaro/scuro, pubblicata tramite GitHub Pages.
- Descrizione libera iniziale del libro, pianificazione long/mid/short term, generazione capitoli e scene/paragrafi.
- Autopilot osservabile, interrompibile e riprendibile, con log, riepiloghi e interventi dell'autore; revisioni propagabili ai contenuti dipendenti.
- Fasi di brainstorming, review di cinque tipologie di lettori, adversarial review, verifica della continuità e controllo delle rivelazioni.
- Memoria narrativa persistente per personaggi, luoghi, fazioni, oggetti, segreti, timeline, idee e stato della storia.
- Più endpoint OpenAI-compatible e selezione del modello per singola attività e per libro.
- IndexedDB come archivio di lavoro locale, sincronizzazione GitHub del canon e cloud bootstrap mediante Google o Microsoft; import/export ZIP; export EPUB/PDF/DOCX.
- Documentazione di architettura, ADR, test e regole per agenti AI.

## Repository di riferimento

- [Book.Jesus](https://github.com/KeyserDSoze/Book.Jesus): pattern di capitoli, scene/paragrafi, continuità, timeline e segreti.
- [GhostWriterFramework](https://github.com/KeyserDSoze/GhostWriterFramework): convenzioni e modelli Narrarium.
- [DeliveryManager](https://github.com/KeyserDSoze/DeliveryManager): organizzazione del repository, ADR, documentazione e qualità.

## Sicurezza e limiti

L'hosting su GitHub Pages è statico: il codice applicativo è pubblico e le chiavi API introdotte nel browser sono accessibili al codice che vi viene eseguito. Non utilizzare GitHub Actions secrets per distribuire chiavi private nel bundle. Non inserire chiavi, PAT o token nei commit, nel repository di un libro o nei log. L'accesso Google/Microsoft non è un'autorizzazione server-side a GitHub Pages. L'autopilot in un browser mobile può essere sospeso dal sistema operativo: ogni attività dovrà essere checkpointata e riprendibile.

Consulta `AGENTS.md`, `docs/`, `ADR/` e `features/` quando saranno presenti sul branch di sviluppo.
