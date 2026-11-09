# ADR 0095 — Validazione EPUB ufficiale W3C in CI con fixture sintetica

- **Stato:** accettato per v0.11.63
- **Data:** 2026-11-09
- **Issue:** [#100](https://github.com/KeyserDSoze/BookWriter/issues/100)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedenti:** [ADR 0089](0089-epub3-canonical-export-validation.md), [ADR 0090](0090-epub3-scene-navigation.md), [ADR 0093](0093-epub3-titlepage-landmarks.md)
- **Origine:** [W3C/DAISY EPUBCheck v5.4.0](https://github.com/w3c/epubcheck/releases/tag/v5.4.0)

## Problema

L'EPUB viene già testato come ZIP con OPF, XHTML, `spine`, `toc` e `landmarks` e scaricato in Playwright desktop/mobile, ma il parser XML non applica tutte le regole EPUB. Una nuova versione del generatore potrebbe produrre file parseable ma non conformi alle regole di packaging, manifest, risorse, HTML e navigazione. È necessario un gate **indipendente e ufficiale**: EPUBCheck è sviluppato da DAISY per W3C, disponibile come CLI Java. I file degli utenti sono privati e devono rimanere local-first, quindi non vanno caricati su servizi di validazione esterni.

## Decisione

1. Aggiungere a `.github/workflows/ci.yml` un job `epubcheck` parallelo a `frontend`. Usa Node 22, Java Temurin 21, `npm ci`, e avvia Vitest solo sul file `epubcheck-fixture.test.ts` con `EPUBCHECK_OUTPUT` impostata a un file temporaneo del runner. Il test crea un `BookProject` **sintetico**, invoca il vero `buildEpub`, verifica che restino solo capitoli con prosa canonica, titoli XML-safe, Unicode, indice, landmark e nessun brief, memoria o bozza, e scrive i bytes solo quando richiesto esplicitamente dall'ambiente CI.
2. Scaricare la **distribuzione originale W3C** [`epubcheck-5.4.0.zip`](https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip) (non `latest`) e confrontarne il digest SHA-256 `33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c` pubblicato nei metadati GitHub della release. Estrarre con `unzip` e individuare `epubcheck.jar` (con `lib/` vicina), eseguendo `--version` prima della validazione. Errori di download, checksum, generazione o del validatore **devono fallire il job**; non aggiungere meccanismi di bypass.
3. Mantenere job `frontend` attuale e Playwright reale; non spostare EPUBCheck nel browser né nel bundle di produzione, non introdurre dipendenze runtime, servizi cloud o cambiare lo schema persistito dei libri. La validazione avviene con file fittizi esclusivamente in GitHub Actions.
4. L'esito positivo della CLI sul campione rappresentativo **non** consente di affermare che ogni libro di ogni autore sia certificato, che tutti gli Unicode siano gestiti o che i lettori fisici siano compatibili. Eventuali errori ufficiali futuri sul campione obbligano una correzione e test di regressione.

## Prove e limiti

Chiudere #100 soltanto dopo che il job EPUBCheck 5.4.0, TypeScript, Vitest, smoke, build, Playwright desktop/mobile, Pages e cleanup siano `completed/success` sulla **stessa HEAD**. Il job ufficiale resta obbligatorio per le evoluzioni EPUB successive. Restano aperte nell'epic #4 le prove di diversi libri e di lettori/e-reader fisici, l'accessibilità EPUB/PDF/DOCX, la compatibilità PDF Unicode con font distribuiti in licenza e l'import/export ZIP avanzato. La riproduzione locale è in [docs/epubcheck-ci.md](../docs/epubcheck-ci.md).
