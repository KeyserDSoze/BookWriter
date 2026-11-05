# Changelog — BookWriter

Ogni rilascio su `main` deve avere una voce verificabile. Le PR descrivono il comportamento rilasciato; le issue raccolgono lavoro incompleto e criteri di accettazione.

## 0.4.0 — 2026-11-05 (PR #9)

**GitHub Autosync — fase 2a, opt-in**

- Outbox persistente in IndexedDB scritta nella stessa transazione dei checkpoint narrativi significativi (outline, review, consolidamento e revisione).
- Worker browser che invia automaticamente quando la scheda è aperta, riprende al reload/ritorno online e usa Web Locks contro invii concorrenti tra tab.
- Coalescing dei checkpoint, retry esponenziale limitato, stato bloccato e comando di riprova, visibili nella sezione Archivio.
- Marcatori di operazione nel commit e nel canon remoto per riconoscere commit riusciti quando la risposta è stata persa; ACK atomico che non elimina modifiche effettuate durante l'invio.
- Autosync disattivato per default, disponibile solo dopo il primo commit manuale e previa autorizzazione aggiuntiva per repo pubbliche.
- Suite Vitest per outbox, worker e recovery, più CI desktop/mobile.

**Non incluso:** lease distribuito tra dispositivi, risoluzione conflitti, ZIP snapshot remoti, Google/Microsoft OAuth. L'autopilot opera soltanto con la pagina attiva.

## 0.3.0 — 2026-11-05 (PR #8)

**GitHub Sync — fase 1, manuale**

- Connessione per libro con PAT fine-grained GitHub cifrato in IndexedDB.
- Verifica permessi e visibilità delle repository, consenso se pubbliche.
- Proiezione della memoria narrativa in Markdown/frontmatter Narrarium.
- Commit multi-file tramite Git Data REST con SHA e rifiuto degli aggiornamenti non fast-forward, mai force push.
- Import di libri e attività da `.bookwriter/project.json` senza sovrascrivere i dati locali.
- Test unitari per proiezione, privacy e conflitti; test UI Chromium desktop/mobile confermati tramite CI.
- Documentazione: `ADR/0005-github-manual-sync.md`, `docs/github-sync.md`, aggiornamenti AGENTS, README, feature e issue #3.

**Non incluso:** autosync, lease multi-device, snapshot ZIP remoti, login Google/Microsoft, E2EE tra dispositivi.

## 0.2.1 — 2026-11-05 (PR #7)

- Suite Playwright Chromium desktop e mobile.
- Correzione della navigazione mobile sticky e della larghezza dei tab.
- Test persistenza IndexedDB e round-trip ZIP.

## 0.2.0 — 2026-11-05 (PR #1)

- Prima SPA React/TypeScript responsive con tema chiaro/scuro.
- Orchestrazione autonoma da brief a scene, audience review e registrazione delle attività.
- Configurazione endpoint e routing dei modelli.
- Persistenza IndexedDB e AES-GCM locale delle API key.
- Backup ZIP e importazione non distruttiva, export EPUB/DOCX/PDF.
- GitHub Pages su `https://ghostwriting.ws`.
