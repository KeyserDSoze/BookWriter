# Architettura del prodotto

## Visione

BookWriter è un sistema editoriale **autonomo con supervisione continua**. L'autore fornisce una descrizione libera, vincoli, materiali, stile, pubblico e obiettivi; un orchestratore pianifica e scrive scene narrativamente strutturate. Ogni attività è ispezionabile e correggibile senza perdere la cronologia.

## Componenti

```text
Browser React/Vite (Pages)
 ├─ UI responsive: dashboard, workspace, reader, editor, attività, settings
 ├─ Domain: canon, idee, review, segreti, revisioni, job/eventi
 ├─ Application: autopilot state machine, planner, dependency graph,
 │                model router, budget guard, sync coordinator
 └─ Infrastructure:
    ├─ IndexedDB: libri, entità, jobs, eventi, checkpoints, pending writes
    ├─ Web Crypto: vault locale, export ZIP cifrato opzionale
    ├─ API OpenAI-compatible (HTTPS+CORS): modelli multipli/endpoint
    ├─ GitHub REST: versioning canon, branches, SHAs e snapshot
    ├─ Google Drive appDataFolder: profilo (impostazioni + vault) ed elenco libri (0.14.0, ADR 0153)
    └─ Microsoft Graph OneDrive approot: stesso profilo, account alternativo (0.14.0, ADR 0153)
```

Nessun servizio server custom necessario per il primo rilascio. Il processo AI gira in una **pagina in primo piano**; non promettere elaborazioni durante chiusura browser o sospensione mobile. Background worker persistente sarebbe un prodotto/fase separati.

### Server personale opzionale — prima tranche nel sorgente

[ADR 0167](../ADR/0167-optional-personal-server-and-shared-engine.md) e [F02](../features/F02-personal-server.md) definiscono quella fase separata: host Node.js/TypeScript installato dall'autore su Windows/Linux, non un backend di GitHub Pages.

```text
                         Motore TypeScript unico
                         dominio + orchestrazione
                         /                     \
Browser locale + adapter IDB/lock       Server Node + adapter file/OS/vault
                                                |
Browser collegati <-- comandi, snapshot, live ---+
                                                +--> AI / ricerca consentita
                                                +--> GitHub (lease + outbox + PAT)
```

Per i libri affidati, il server diventa archivio operativo; IndexedDB conserva repliche e bozze non confermate. Una sola autorità per libro, handoff esplicito e nessun fallback locale in caso di disconnessione. Il server salva direttamente anche su GitHub dopo i compiti; il browser non è un publisher concorrente. Google/Microsoft restano piano di controllo di connessione, impostazioni e vault, mai dei testi.

Pannello locale 24105, API 24106, file/vault e primi comandi sono implementati in modo sperimentale; il runner è condiviso tramite porte/re-export, non copiato o riscritto in .NET. Estrazione fisica completa, intero catalogo remoto, handoff, cloud multi-PAT, installer, tunnel guidato e updater firmato restano da completare. [Stato reale](personal-server-development.md) · [Contratto completo](personal-server-protocol.md).

## Struttura del libro (remote canon)

```text
book.md
context.md
ideas.md
story-design.md
plot.md
ghostwriters/default.md
guidelines/
chapters/001-slug/chapter.md
chapters/001-slug/001-scena.md
characters/  locations/  factions/  items/
secrets/  timelines/main.md  timelines/events/
resumes/chapters/  resumes/total.md
state/current.md  state/chapters/  state/status.md
research/ evaluations/ audit/ drafts/
.bookwriter/manifest.json
.bookwriter/snapshots/latest.zip    # facoltativo, niente credenziali
```

Una scena/paragrafo ha ID stabile, capitolo, numero, titolo, POV, date/ancore relative, refs entità e segreti, testo, hash, status e summary. I file canonici restano Markdown + YAML frontmatter per interoperabilità Narrarium. Le idee e i materiali di review non diventano canon senza validazione.

## Flusso principale

1. Brief libero (l'autore può fornire capitoli e vincoli, oppure lasciare pianificare tutto).
2. Brainstorming **long/mid/short term**, generazione di alternative e criteri di selezione.
3. Validazione logica/fattuale; five-persona audience review e adversarial review; consolidamento di uno story-design e reveal plan.
4. Outline globale, archi e capitoli; suddivisione di capitoli in scene; agenda di semina/risoluzione dei segreti.
5. Per ogni scena: preflight canon/timeline, obiettivo, conflitto, evento, conseguenza, scrittura, verifiche editoriale/fattuale/continuità/segreti, revisione, canonizzazione.
6. Riscrittura intelligente di collegamenti e foreshadowing; ricalcolo delle dipendenze; aggiornamento `state/`, `resumes/`, `plot.md`, `evaluations/`.
7. Riepilogo attività, previsione prossimo passo e checkpoint locale, sync remoto a milestone.
8. Prosecuzione fino a completamento o stop manuale, budget, errore o sospensione della pagina.

## Modelli

Entità `EndpointProfile`: `id, label, baseUrl, apiKeyRef, modelCatalog, capabilities, health`.
Entità `ModelAssignment`: `taskKind, endpointId, modelId, temperature?, maxOutputTokens?, budget?`.
Entità `BookModelPolicy`: override dei ruoli per libro, es. summary=cheap, prose=writer, brainstorming/review=reasoner. Definire fallback manuali espliciti e non cambiare provider su errore senza informare l'autore.

## Interventi dell'autore

L'autore può applicare feedback a idea, scena, capitolo, personaggio, segreto o piano globale. Il sistema genera una change request persistente, identifica il **dependency cone**, costruisce un piano di revisione e mostra una preview/impact report. Le decisioni esplicite dell'autore sono vincoli persistenti; la fase di rebuild aggiorna solo contenuti coinvolti e rivalida tutto il canon interessato. Ogni operazione ha snapshot before/after e rollback mirato.

## UX

Mobile-first (bottom navigation o sidebar sheet, action bar sticky, timeline dei task e dettaglio fullscreen); desktop con dashboard a colonne. Ogni fase contiene "ora", "fatto", "prossimo", endpoint/modello, consumo e output. Mostrare stop/pause/ripresa anche quando l'utente legge il libro. Le notifiche sullo stato non devono interrompere la lettura.

## Non-obiettivi MVP

- Autopilot 24/7 con tab/browser chiuso.
- Crittografia end-to-end senza segreto indipendente dall'identità cloud.
- Protezione del codice pubblico del sito mediante login.
- Pubblicazione automatica di libri in repository pubbliche senza conferma esplicita.
- Multi-editor simultaneo con merge automatico di prosa.
