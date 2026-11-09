# Validazione EPUB ufficiale in CI (v0.11.63)

Il workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) esegue due job indipendenti: `frontend` (TypeScript, Vitest, smoke, build e Playwright desktop/mobile) e `epubcheck` (verifica EPUB ufficiale). Entrambi devono essere verdi per considerare il commit validato.

## Distribuzione e integrità

- Software: **EPUBCheck 5.4.0** rilasciato da W3C/DAISY, per i controlli EPUB 3.4 (progetto EPUB 3 incluso).
- Download: [asset ZIP ufficiale](https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip).
- SHA-256 atteso (digest pubblicato dall'API GitHub della release): `33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c`.
- Runtime CI: Ubuntu, Temurin Java 21, Node 22. Il file ZIP deve avere il digest esatto, altrimenti il job fallisce **prima** di eseguire un codice estraneo.
- Il CLI `java -jar ... epubcheck.jar <epub>` produce diagnostica nel log GitHub Actions; errori segnalati come exit code non-zero bloccano il job.

Versione e hash sono **fissi** e vanno aggiornati soltanto con nuovo controllo della release e issue/ADR correlati; non scaricare automaticamente `latest`.

## Quale libro viene validato

`src/frontend/src/infrastructure/epubcheck-fixture.test.ts` crea da zero un manoscritto falso con titoli speciali, Unicode valido, controlli XML da rimuovere, due capitoli `canon` e capitoli di sola bozza/scene `draft/planned` da escludere. Il file viene serializzato con lo **stesso** `buildEpub` usato dal pulsante in Archivio. Il test controlla che brief/memory e testi non canonici non appaiano nel ZIP.

Normalmente Vitest tiene l'EPUB soltanto in memoria. Con `EPUBCHECK_OUTPUT` impostata su un percorso esplicito, il test scrive il ZIP e la CI invoca EPUBCheck su quel file. Nessun progetto personale, chiave o segreto è letto, caricato o inviato ad altri servizi.

## Riprodurre manualmente (Linux/macOS)

Dalla cartella `src/frontend` con Node 22, Java e `npm ci`:

```bash
EPUBCHECK_OUTPUT=/tmp/bookwriter-canon.epub npx --no-install vitest run src/infrastructure/epubcheck-fixture.test.ts
curl --fail --location --retry 3 \
  https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip \
  --output /tmp/epubcheck-5.4.0.zip
echo "33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c  /tmp/epubcheck-5.4.0.zip" | sha256sum --check
mkdir -p /tmp/bookwriter-epubcheck
unzip -q /tmp/epubcheck-5.4.0.zip -d /tmp/bookwriter-epubcheck
jar="$(find /tmp/bookwriter-epubcheck -name epubcheck.jar -type f -print -quit)"
test -n "$jar"
java -jar "$jar" --version
java -jar "$jar" /tmp/bookwriter-canon.epub
```

Se non è disponibile `sha256sum`, eseguire il controllo SHA-256 equivalente del sistema operativo prima di estrarre l'archivio. Se il test ufficiale segnala errori o fallisce il download, la CI deve restare rossa e il problema va registrato in issue; non disabilitare il gate.

## Portata

Un EPUB sintetico rappresentativo sottoposto con successo a EPUBCheck **non certifica tutte le edizioni generate** e non simula il comportamento dei dispositivi di lettura reali, la resa tipografica o un audit completo di accessibilità. Test sullo ZIP e sulla UI rimangono distinti. [ADR 0095](../ADR/0095-official-epubcheck-ci.md), [issue #100](https://github.com/KeyserDSoze/BookWriter/issues/100), [epic #4](https://github.com/KeyserDSoze/BookWriter/issues/4).
