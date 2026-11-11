# CI Playwright Chromium senza installazione apt Ubuntu — issue #134

**Ambito:** `.github/workflows/ci.yml`, job `frontend`, progetti `desktop-chromium` e `mobile-chromium` di `src/frontend/playwright.config.ts`.

## Motivo del cambiamento

Durante la verifica degli avvisi budget [#132](https://github.com/KeyserDSoze/BookWriter/issues/132), il workflow [#43035024633](https://github.com/KeyserDSoze/BookWriter/actions/runs/43035024633) ha superato TypeScript, 795 Vitest (129 file), smoke e build. L'installazione `npx playwright install --with-deps chromium` ha però tentato `apt` da Ubuntu 26.04 e si è fermata con errori di risoluzione DNS dei server `azure.archive.ubuntu.com`, `archive.ubuntu.com` e `security.ubuntu.com`. Il risultato non è una failure dei test browser: Playwright non aveva ancora lanciato Chromium. Questa causa era diversa dal test unitario sul floating-point già corretto nella stessa issue.

## Decisione e garanzie

Sul runner GitHub-hosted `ubuntu-latest`, per i **due progetti Chromium headless** del repository usare:

```sh
cd src/frontend
npm ci --no-audit --no-fund
npx playwright install --only-shell chromium
npm run test:e2e
```

- `--only-shell` scarica il browser Chromium **headless reale** compatibile con la versione Playwright del lockfile npm, senza invocare `apt` e senza installare il browser completo destinato all'uso headed. La CI continua a eseguire Playwright **desktop e mobile** sul codice dell'app, non sostituti simulati.
- Si fa affidamento sulle **librerie runtime già presenti** sull'immagine GitHub-hosted. Se manca una libreria o Chromium non parte, il job **deve fallire**; niente `continue-on-error`, `|| true`, disabilitazione test, retry automatici o `test.skip`.
- Per sviluppo locale o immagini self-hosted **senza** dipendenze runtime Chromium, installare esplicitamente le librerie di sistema tramite le procedure Playwright adatte all'OS; `--with-deps` resta utilizzabile in un ambiente con archivio pacchetti raggiungibile.
- Questo intervento non modifica browser targets, versioni, `package-lock.json`, canone o dati dell'autore. Non certifica Safari/iOS o dispositivi fisici: i test mobile sono emulazione Chromium.
- Resta necessario verificare **Frontend CI**, il job EPUBCheck sui quattro EPUB reali sintetici, **Pages** e **cleanup** tutti `completed/success` sulla stessa SHA finale prima di chiudere #134 e #132.

[Issue #134](https://github.com/KeyserDSoze/BookWriter/issues/134) · [Runbook npm](npm-lockfile-releases.md) · [Issue #132](https://github.com/KeyserDSoze/BookWriter/issues/132).
