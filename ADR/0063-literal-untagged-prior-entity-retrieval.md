# ADR 0063 — Recupero locale di nomi letterali senza tag nelle scene precedenti

- **Stato:** accettato per v0.11.30
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0033–0035, 0041, 0042, 0062

## Contesto

Il ranking di ADR 0035 collega le entità dichiarate nei metadati di due scene e confronta parole di almeno quattro caratteri. Una scena precedente che nomina `Ivo` nel testo senza `characters` può non essere selezionata, perché il token è corto e il tag manca. Estendere indiscriminatamente il ranking a sinonimi, alias privati o memoria segreta introdurrebbe falsa identità e amplificherebbe la condivisione di dati con i modelli.

## Decisione

1. Usare **solo** nomi di entità già dichiarati nella scena corrente (characters, items, locations, factions), lunghezza 3–80, massimo 16 nomi distinti per query. Non inferire nomi dalla memoria privata, da un riassunto LLM, da altre scene future o dal registro `narrativeAliasDecisions`. Niente embeddings né rete.
2. Per ogni scena precedente **già congelata**, ispezionare a parola intera (Unicode, NFC e casefold italiano) il nome letterale nel testo della scena. Nomi composti richiedono la sequenza intera; `Ivo` non coincide con `vivo`. Con testo lungo, controllare ciascuna delle tre porzioni **separatamente** secondo il limite precedente di 16.000 caratteri. Vietato costruire corrispondenze fra frammenti disgiunti.
3. Distinguere l'intersezione di metadati già disponibile in `matchSignals.entities` dalle nuove menzioni di prosa non etichettate in `matchSignals.literalEntities?: string[]`. Un nome già verificato nei metadati non viene duplicato come menzione senza tag. Fino a 8 segnali nuovi per scena, peso di ranking **25** contro **35** del match strutturato; parole e date mantengono i punteggi esistenti. `selectionReason` e contatori rimangono coerenti.
4. I match sono **navigazione documentale**, non verità: una menzione non certifica che il soggetto sia quello indicato, che possieda un oggetto o che una contraddizione esista. Non applicare inferenza transitiva né motivazioni degli alias salvati. Nessun nuovo `finding` o `repair` automatico.
5. Conservare ancoraggi capitolo origine e ultimo predecessore, massimo 4 scene e 2 per capitolo, 1.600 candidate effettivamente scansionate, finestre di prova da testo originale con offset. Il pacchetto resta runtime ed è accessibile solo a continuità/timeline/segreti/voce e giudice (storico unicamente con trigger storico), **mai** ai cinque lettori ciechi. Non alterare credenziali, author decisions, IndexedDB, ZIP, autosync o audit del freeze.
6. Aggiornare le istruzioni del giudice/specialisti e l'avviso UI sui limiti, mantenendo `finding.evidence` limitato alla prosa corrente.

## Verifiche e rischi

Vitest su precedente privo di tag ma con nome, omonimie/sottostringhe, nome composto, esclusione oltre le porzioni campionate, nessun alias ricostruito, privacy di segreti e lettori ciechi, selezione e prompt. Playwright desktop/mobile sull'avviso di rivalidazione; CI TypeScript, test, smoke, build, browser e deploy.

**Limite:** un riscontro lessicale non è una risoluzione di identità canonica né un rilevatore semantico di contraddizioni; può perdere citazioni fuori dalla finestra di scansione. Le interpretazioni dell'autore e i consensi AI restano separati.
