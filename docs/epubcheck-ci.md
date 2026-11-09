# Validazione EPUB ufficiale in CI (v0.11.64)

Il workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) esegue due job indipendenti: `frontend` (TypeScript, Vitest, smoke, build e Playwright desktop/mobile) e `epubcheck` (verifica EPUB ufficiale). Entrambi devono essere verdi per considerare il commit validato.

## Distribuzione e integrità

- Software: **EPUBCheck 5.4.0** rilasciato da W3C/DAISY, per i controlli EPUB 3.4 (progetto EPUB 3 incluso).
- Download: [asset ZIP ufficiale](https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip).
- SHA-256 atteso (digest pubblicato dall'API GitHub della release): `33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c`.
- Runtime CI: Ubuntu, Temurin Java 21, Node 22. Il file ZIP deve avere il digest esatto, altrimenti il job fallisce **prima** di eseguire un codice estraneo.
- Il CLI `java -jar ... epubcheck.jar <epub>` produce diagnostica nel log GitHub Actions; errori segnalati come exit code non-zero bloccano il job.

Versione e hash sono **fissi** e vanno aggiornati soltanto con nuovo controllo della release e issue/ADR correlati; non scaricare automaticamente `latest`.

## Quale libro viene validato

`src/frontend/src/infrastructure/epubcheck-fixture.test.ts` genera **quattro libri fittizi** con lo stesso `buildEpub` usato dal pulsante in Archivio:

- `mixed-canon-draft.epub`: primi capitoli non canonici, scene canoniche con bozze intercalate, XML escaped e link TOC per scene.
- `late-first-chapter.epub`: primi capitoli esclusi e primo capitolo pubblicato con numero editoriale 17; `bodymatter` deve puntare al primo documento realmente pubblicato.
- `unicode-and-xml-safety.epub`: Unicode multilingua, emoji, apostrofi, controlli vietati e surrogati isolati sanitizzati.
- `long-multi-chapter.epub`: sei capitoli, dodici scene canoniche e testo lungo, con bozze private escluse.

Tutti i test ispezionano ZIP, spine, indice, frontespizio, numeri/scene e privacy. I dati sono sintetici e i nomi dei file **fissi**, mai derivati dal titolo dell'autore. I test ordinari generano solo byte in memoria. Soltanto impostando `EPUBCHECK_OUTPUT_DIR` su una cartella preesistente si scrivono **quattro file**; la CI ne esige esattamente quattro, tutti non vuoti, prima di eseguirli in sequenza con EPUBCheck W3C. Nessun progetto personale, chiave o segreto è letto, caricato o inviato ad altri servizi.

## Riprodurre manualmente (Linux/macOS)

Dalla cartella `src/frontend` con Node 22, Java e `npm ci`:

```bash
mkdir -p /tmp/bookwriter-epub-fixtures
EPUBCHECK_OUTPUT_DIR=/tmp/bookwriter-epub-fixtures npx --no-install vitest run src/infrastructure/epubcheck-fixture.test.ts
test "$(find /tmp/bookwriter-epub-fixtures -maxdepth 1 -name '*.epub' -type f | wc -l)" -eq 4
curl --fail --location --retry 3 \
  https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip \
  --output /tmp/epubcheck-5.4.0.zip
echo "33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c  /tmp/epubcheck-5.4.0.zip" | sha256sum --check
mkdir -p /tmp/bookwriter-epubcheck
unzip -q /tmp/epubcheck-5.4.0.zip -d /tmp/bookwriter-epubcheck
jar="$(find /tmp/bookwriter-epubcheck -name epubcheck.jar -type f -print -quit)"
test -n "$jar"
java -jar "$jar" --version
for epub in /tmp/bookwriter-epub-fixtures/*.epub; do
  test -s "$epub"
  java -jar "$jar" "$epub"
done
```

Se non è disponibile `sha256sum`, eseguire il controllo SHA-256 equivalente del sistema operativo prima di estrarre l'archivio. Se il test ufficiale segnala errori o fallisce il download, la CI deve restare rossa e il problema va registrato in issue; non disabilitare il gate.

## Portata

Quattro EPUB sintetici rappresentativi sottoposti con successo a EPUBCheck **non certifica tutte le edizioni generate** e non simula il comportamento dei dispositivi di lettura reali, la resa tipografica o un audit completo di accessibilità. Test sullo ZIP e sulla UI rimangono distinti. [ADR 0095](../ADR/0095-official-epubcheck-ci.md), [issue #100](https://github.com/KeyserDSoze/BookWriter/issues/100), [epic #4](https://github.com/KeyserDSoze/BookWriter/issues/4).


La matrice è descritta nell'[ADR 0096](../ADR/0096-epubcheck-fixture-matrix.md) e tracciata nell'[issue #101](https://github.com/KeyserDSoze/BookWriter/issues/101). La versione del validator, l'hash e l'assenza di libri reali in CI restano invariati rispetto ad ADR 0095.
