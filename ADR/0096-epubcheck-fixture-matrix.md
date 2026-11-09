# ADR 0096 — Matrice di quattro EPUB reali per EPUBCheck 5.4.0

- **Stato:** accettato per v0.11.64
- **Data:** 2026-11-09
- **Issue:** [#101](https://github.com/KeyserDSoze/BookWriter/issues/101)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedente:** [ADR 0095](0095-official-epubcheck-ci.md)
- **Guida:** [docs/epubcheck-ci.md](../docs/epubcheck-ci.md)

## Problema

Il validatore ufficiale EPUBCheck v5.4.0 è già eseguito nel workflow su un singolo EPUB sintetico, ma quel solo campione non intercetta regressioni su capitoli iniziali senza canone, risorse e link con molti capitoli, UTF-16 malformato, caratteri XML proibiti e pagine XHTML lunghe. Serve ampliare il perimetro senza contaminare il bundle dell'app o inviare testi personali.

## Decisione

1. Generare con lo **stesso** `buildEpub` della produzione quattro libri fittizi e distinti, con UUID sintetici e timestamp fisso: `mixed-canon-draft` (interleaving canonico/draft, capitoli esclusi), `late-first-chapter` (primo capitolo pubblicato numero 17, link bodymatter al primo file esportato), `unicode-and-xml-safety` (CJK, arabo, greco, emoji, apostrofi, caratteri XML illeciti/surrogati non accoppiati) e `long-multi-chapter` (sei capitoli canonici, dodici scene e testo lungo).
2. Eseguire Vitest su ogni libro: ZIP EPUB, `mimetype`, frontespizio, `toc` e `landmarks`, ordine di `spine`, numero di capitoli e scene, presenza prosa canonica e assenza di brief/memory/bozze, escaping Unicode/XML sicuro. **Non** scrivere alcun file nel flusso normale dei test.
3. Solo se `EPUBCHECK_OUTPUT_DIR` è specificato nei singoli **step** GitHub Actions (il contesto `runner.temp` non è disponibile nell'`env` di job), scrivere i quattro EPUB nella cartella temporanea con nomi statici e verificare che siano **esattamente quattro**. `ci.yml` deve poi eseguire il CLI ufficiale W3C/DAISY EPUBCheck 5.4.0 su **tutti i file**. Ogni errore di test, download, checksum, file mancante o exit non-zero della CLI blocca la CI. Non aggiungere `continue-on-error` o falsa conferma.
4. Conservare distribuzione e SHA-256 fissati nell'ADR 0095; nessuna nuova dipendenza di prodotto, schema salvato, API di rete frontend, esfiltrazione di manoscritti o modifica agli export di DOCX/PDF.

## Verifiche e limiti

La chiusura dell'issue #101 richiede un job EPUBCheck che riporti l'esito reale **per tutti e quattro** i file, CI frontend con TypeScript/Vitest/smoke/build/Playwright desktop+mobile, Pages e cleanup `completed/success` sulla medesima HEAD `main`. Il gate aumenta la probabilità di intercettare regressioni strutturali, ma resta un **test su esempi sintetici**: non certifica ogni input, gli e-reader reali o l'accessibilità. L'epic #4 rimane aperta per PDF Unicode con font incorporati, copertine, lettori fisici, layout e ZIP restore avanzato.
