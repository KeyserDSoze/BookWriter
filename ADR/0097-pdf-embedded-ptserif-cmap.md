# ADR 0097 — PDF Unicode latino esteso/cirillico con PT Serif incorporato e controllo cmap

- **Stato:** accettato per v0.11.65
- **Data:** 2026-11-09
- **Issue:** [#102](https://github.com/KeyserDSoze/BookWriter/issues/102)
- **Epic:** [#4](https://github.com/KeyserDSoze/BookWriter/issues/4)
- **Precedenti:** [ADR 0092](0092-pdf-preflight-and-portable-export.md), [ADR 0094](0094-pdf-canonical-folios.md)

## Problema

jsPDF con Times standard produce un PDF affidabile solo per i caratteri WinAnsi previsti. La scelta in v0.11.60 era rifiutare esplicitamente emoji, ideogrammi, cirillico e altri caratteri fuori repertorio, evitando una perdita silenziosa. Per la scrittura internazionale questo è troppo restrittivo. L'uso di font via CDN introdurrebbe una dipendenza esterna durante l'esportazione locale e una possibile perdita di funzionalità offline; utilizzare una font senza licenza corretta è inaccettabile.

## Decisione

1. Includere senza modifiche i due file TTF statici **PT Serif Web Regular e Bold** da [google/fonts, `ofl/ptserif`](https://github.com/google/fonts/tree/main/ofl/ptserif), prodotto ParaType. È software di caratteri con **SIL Open Font License 1.1**, copyright © 2010 ParaType Ltd, e Reserved Font Names `PT Sans`, `PT Serif`, `ParaType`. Conservare `pdf-fonts/OFL.txt` **integralmente**, non rinominare né modificare le font. Il formato consente embedding e redistribuzione, la licenza della font non si estende ai manoscritti PDF degli autori.
2. Importare TTF con Vite `?inline` da un modulo lazy `pdf-unicode-font.ts` per includere i dati base64 nel codice, senza contatti con font server o servizi esterni all'app. `buildPdf` usa ancora jsPDF Times e i controlli WinAnsi preesistenti se **tutti** i campi serializzati sono WinAnsi. Solo per testo aggiuntivo importa il modulo Unicode, registra PT Serif normal e bold in jsPDF usando `addFileToVFS`/`addFont` e impagina con la nuova famiglia embedded.
3. Eseguire il preflight prima di chiamare il renderer sul **canone filtrato** da `ensureChapters`: titolo, intestazioni capitoli/scene e paragrafi. Il parser TrueType individua la tabella `cmap` Unicode format 4 e controlla il glyph ID effettivo per **entrambe** le varianti della font. Un codepoint senza glifo (glyph 0), un surrogato non accoppiato trasformato in U+FFFD, emoji, CJK, script con shaping/RTL non verificato, o dati fuori dai blocchi di scrittura supportati devono **bloccare l'export** con U+XXXX e alternativa EPUB/DOCX, mai sostituzione automatica o file parziale.
4. Tenere invariati il numero di pagine, il footer `Pagina X di Y`, la selezione di capitoli e scene canoniche e i margini PDF, senza includere note, memory, segreti extra-manuscript, bozze, dati di rete o chiavi. Il PDF standard resta compatibile e leggero. Nessuna dipendenza npm nuova né cambiamenti ai dati persistiti.
5. Il file di definizione tipo `inline-font-assets.d.ts` rende espliciti gli import Vite `?inline` per TypeScript. Le font sono asset con attribution e non sono un servizio esterno.

## Prove e limiti

Vitest deve testare PDF ASCII/WinAnsi vecchi, un PDF reale con Latin Extended/Cyrillic che contiene le risorse TTF embedded `/FontFile2` e le mappe `/ToUnicode`, paginazione e nessun dato privato; testare rifiuto di greco non coperto, ideogrammi, emoji, RTL e surrogate isolate. Playwright desktop/mobile deve produrre un PDF Unicode scaricato e ispezionato e mantenere il blocco sulle emoji senza download.

Questo **non** equivale a Unicode completo o supporto di lingue con shaping sofisticato: CJK, emoji, arabo/RTL, script senza glifo o non testati devono usare EPUB/DOCX. Non certifica fedeltà grafica/estrazione testo su ogni lettore, PDF/A o accessibility tagging. Restano lavoro nell'epic #4. La issue #102 richiede TypeScript, Vitest, smoke, build, Playwright desktop/mobile, EPUBCheck (matrice 4), Pages e cleanup `completed/success` sulla stessa HEAD.
