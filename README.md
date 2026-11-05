# BookWriter

**BookWriter** è un progetto per la scrittura autonoma e supervisionabile di libri con modelli di intelligenza artificiale configurabili.

> Stato: **prima applicazione local-first e in evoluzione**. Le funzionalità descritte sono obiettivi di prodotto, non ancora un'applicazione pronta per la produzione.

## Funzionalità disponibili

- SPA mobile e desktop, tema chiaro/scuro.
- Creazione di libri, orchestra AI multi-modello con osservabilità dei passaggi e possibilità di pause/revisioni.
- Persistenza IndexedDB e chiavi API cifrate con Web Crypto.
- Import/export ZIP content-only o completo (password AES-GCM opzionale, chiaro solo dopo avviso).
- Generazione EPUB, DOCX e PDF dalla prosa canonica.
- Setup GitHub Pages su **https://ghostwriting.ws** (asset base root).

**Sincronizzazione GitHub**: la PR #8 introduce collegamento a repository per libro, PAT fine-grained cifrato localmente, proiezione Markdown/frontmatter, commit multi-file con controllo SHA, import non distruttivo e blocco dei conflitti. Vedi `docs/github-sync.md` e ADR 0005.

**Autosync v0.4.0:** la PR #9 aggiunge l'outbox persistente e i commit automatici per i checkpoint narrativi, con retry, recovery e controlli Web Locks tra tab. È disattivato per default e va abilitato in Archivio dopo il primo commit manuale. Vedi ADR 0006.

**Lease writer v0.5.0:** la PR #12 aggiunge un lock GitHub a branch separata per impedire l'avvio di un secondo autopilot AI sullo stesso libro, con rinnovo periodico e recupero manuale dei lock scaduti. Vedi ADR 0007 e issue #10. È una mitigazione best effort, non un database distribuito con fencing atomico.

**Confronto e recupero v0.6.0:** la PR #14 introduce differenze visuali locale/GitHub per capitoli, scene, personaggi e segreti, selezione esplicita per elemento e doppio backup atomico prima di applicare. Nessun force push; autosync disattivato dopo il recupero. Vedi ADR 0008 e `docs/conflict-recovery.md`.

**Fusione di scene v0.7.0:** la PR #16 aggiunge diff parole/paragrafi con fallback mobile, proposte AI facoltative, editor manuale, storico bozze in IndexedDB e ZIP, e approvazione esplicita a doppio backup. Le proposte accettate restano draft, mai canoniche automaticamente: il Lettore richiede una successiva conferma umana e, fino a quel momento, blocca autopilot e push GitHub. Guida: `docs/scene-merge.md`, ADR 0009.

**Consumi AI v0.7.1:** la PR #18 mostra sulla Dashboard input/output token effettivamente comunicati dai provider, separati per libro, modello ed endpoint, e segnala report mancanti e chiamate fallite. Non inventa saldi o prezzi. Vedi ADR 0010 e `docs/ai-usage.md`.

**Redazione indipendente v0.8.0:** la PR #19 introduce una redazione per capitolo con 7 specialisti e 5 lettori in chiamate separate, rilievi documentati con remediation, direttore editoriale critico che può respingere rilievi infondati motivando, riscritture mirate e congelamento solo dopo un esito risolto. Dopo tre tornate senza soluzione si ferma e chiede all'autore. Riaprire un capitolo invalida i successivi. Guida: `docs/editorial-board.md`; ADR 0011.

**Budget AI v0.8.1 (PR #21):** limite stimato facoltativo per libro prima di ogni chiamata dell'autopilot, redazione e fusione AI, con tariffe per modello/provider inserite dall'autore, output massimo e blocco conservativo su usage mancante. Non è un saldo credito o un tetto garantito alla fatturazione. Guida `docs/ai-budget.md`, ADR 0012.

**Ancora da implementare:** OAuth Google/Microsoft, hardening transazionale del lease tra dispositivi, retrieval semantico completo del canone, fact-checking storico con fonti, ZIP snapshot remoti, import Narrarium generico, parità Narrarium e budget tracking. Non affidare documenti importanti solo al browser senza backup.

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

## Stato release

La distribuzione tramite GitHub Pages raggiunge [ghostwriting.ws](https://ghostwriting.ws). Le PR vengono sottoposte alla CI prima del merge. Le funzionalità dalla PR #8 alla #13 sono già integrate; le novità della PR #14 arriveranno su `main` solo dopo la CI verde e il merge.

## Qualità

La CI esegue controllo TypeScript, test Vitest sui backup, smoke test Node, build e test Playwright Chromium desktop/mobile per navigazione e import/export ZIP.

## Sicurezza e limiti

L'hosting su GitHub Pages è statico: il codice applicativo è pubblico e le chiavi API introdotte nel browser sono accessibili al codice che vi viene eseguito. Non utilizzare GitHub Actions secrets per distribuire chiavi private nel bundle. Non inserire chiavi, PAT o token nei commit, nel repository di un libro o nei log. L'accesso Google/Microsoft non è un'autorizzazione server-side a GitHub Pages. L'autopilot in un browser mobile può essere sospeso dal sistema operativo: ogni attività dovrà essere checkpointata e riprendibile.

Consulta `AGENTS.md`, `docs/`, `ADR/` e `features/` quando saranno presenti sul branch di sviluppo.
