# BookWriter

**BookWriter** è un progetto per la scrittura autonoma e supervisionabile di libri con modelli di intelligenza artificiale configurabili.

> Stato: **prima applicazione local-first e in evoluzione**. Le funzionalità descritte sono obiettivi di prodotto, non ancora un'applicazione pronta per la produzione.

## Funzioni presenti sul branch di sviluppo

- SPA mobile e desktop, tema chiaro/scuro.
- Creazione di libri, orchestra AI multi-modello con osservabilità dei passaggi e possibilità di pause/revisioni.
- Persistenza IndexedDB e chiavi API cifrate con Web Crypto.
- Import/export ZIP content-only o completo (password AES-GCM opzionale, chiaro solo dopo avviso).
- Generazione EPUB, DOCX e PDF dalla prosa canonica.
- Setup GitHub Pages su **https://ghostwriting.ws** (asset base root).

**Ancora da implementare:** OAuth Google/Microsoft, sync GitHub con PAT/lease, remote ZIP snapshot, parità completa Narrarium, E2E tests e budget tracking. Non affidare documenti importanti solo al browser senza backup.

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

## Qualità

La CI esegue controllo TypeScript, test Vitest sui backup, smoke test Node, build e test Playwright Chromium desktop/mobile per navigazione e import/export ZIP.

## Sicurezza e limiti

L'hosting su GitHub Pages è statico: il codice applicativo è pubblico e le chiavi API introdotte nel browser sono accessibili al codice che vi viene eseguito. Non utilizzare GitHub Actions secrets per distribuire chiavi private nel bundle. Non inserire chiavi, PAT o token nei commit, nel repository di un libro o nei log. L'accesso Google/Microsoft non è un'autorizzazione server-side a GitHub Pages. L'autopilot in un browser mobile può essere sospeso dal sistema operativo: ogni attività dovrà essere checkpointata e riprendibile.

Consulta `AGENTS.md`, `docs/`, `ADR/` e `features/` quando saranno presenti sul branch di sviluppo.
