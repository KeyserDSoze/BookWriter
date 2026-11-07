# ADR 0046 — Piste letterali di trasmissione delle informazioni fra personaggi

- **Stato:** accettato per v0.11.13 (PR #59)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0011, 0042–0045

## Problema

La v0.11.12 impone al giudice una valutazione epistemica per le contraddizioni di `knowledge` con fonte precedente ancorata. Il giudizio sul fatto che la notizia possa essere stata appresa fuori scena resta però privo di **piste di comunicazione precedenti visibili e verificabili**: per esempio «Elio rivela a Mara che la lettera è falsa» può contraddire la diagnosi di conoscenza impossibile, anche quando manca una scena dedicata al suo apprendimento.

## Decisione

1. Introdurre `buildInformationTransferTrace(book,chapter,currentText)` **puramente locale e derivato**. Legge soltanto prosa di scene canoniche e non vuote in capitoli **strettamente precedenti e congelati**, mai memoria privata, dossier, note autore, capitoli correnti/futuri, API, sync o modelli. Massimo **240 scene** scansionate in ordine più recente-prima, massimo 6.000 caratteri per scena, massimo 10.000 caratteri di query e **4 citazioni** restituite; esporre `candidateSceneCount/scannedSceneCount/unscannedSceneCount/matchedCandidateCount/omittedCandidateCount`. Questo NON è un grafo semantico o una copertura completa.
2. Cercare **solo formule letterali italiane** con due nomi espliciti (es. «Elio racconta/rivela/dice/spiega/confida/informa a Mara che…»), destinatario nominato come parola intera nella scena corrente e almeno un termine tematico di quattro lettere in comune. Ogni risultato conserva `chapterId/sceneId/number`, freeze, timbro locale non crittografico dell'intero testo, offset, quote originale, mittente, destinatario, tema e parole condivise, `evidenceStatus=unverified_literal_report`. L'ID include fonte, posizione, freeze e timbro, per rivalidare una pista modificata. Le frasi possono essere bugie, sogni, segnalazioni indirette o racconti inattendibili; NON dimostrano ascolto, comprensione, identità o conoscenza reale.
3. Il pack viene aggiunto **solo alle chiamate già esistenti** degli specialisti `continuity,timeline,secrets,characterVoice` e **al giudice quando esiste almeno un finding di `knowledge` letteralmente ancorato**. Altri tre specialisti, cinque lettori ciechi e modelli di scrittura non lo ricevono. Il testo è delimitato e dichiarato **non attendibile come istruzioni**. Il giudice continua a conoscere il canone privato soltanto secondo l'accesso preesistente (ADR 0011).
4. Se per il segmento di un finding `dimension=knowledge` esistono piste pertinenti, il giudice deve aggiungere `decision.informationTransferReview` **strict**: esattamente un giudizio per ciascun `candidateId` corrente, `disposition=possible_path|unrelated|unreliable_report|unknown` con motivazione 20–650 e conclusione 24–900. Il software **non accetta** ID inventati, duplicati, mancanti o piste diventate stale. Per dimensioni diverse da knowledge il campo è vietato; se non esistono piste il campo va omesso. I vecchi giudizi restano visualizzabili, non automaticamente validi per nuovi repair.
5. Per `reject`, il giudice può riconoscere una pista `possible_path` o `unknown` con motivazione e respingere la critica. Per `accept` resta il gate v0.11.12 (**fonti attuali, identità, no spiegazione artistica, `supported_conflict`, `knowledgeReview` rigoroso**); in più, nessuna pista valutata `possible_path` o `unknown` può restare irrisolta. Solo `unrelated` o `unreliable_report` motivati consentono di proseguire: questi giudizi sono fallibili, non evidenze certificate di assenza di comunicazione. `repairPrompt` e callback di scrittura riapplicano l'intero gate alla versione fresca del libro.
6. La UI mostra le disposizioni del giudice per ciascuna pista nel resoconto, distinguendole dalle prove di conflitto. ZIP strict valida la struttura opzionale di `informationTransferReview` nei giudizi e nello storico, senza attribuire autenticità alle importazioni. Nessuna persistenza top-level, migrazione obbligatoria, chiamata AI extra, canon/secret/memory/item/timeline mutati dalla selezione. I prompt esistenti possono consumare più token.

## Limiti e priorità future

Il rilevamento si applica ad alcune **forme italiane esplicite**, non a pronomi, sinonimi, messaggi cifrati, deduzioni, menzogne, errori di negazione o catene transitive. La stessa presenza di una frase non prova il trasferimento della notizia; un ritrovamento negativo non significa assenza di trasferimenti. Il campione può omettere capitoli importanti nei romanzi lunghi. Servono ancora interpretazione del giudice e consenso/autore per un modello canonico dei segreti e delle conoscenze.

## Verifiche

Vitest di dominio su quote/offset/revisioni, non leak, selezione bounded, futuro/draft, nome intero/tema, ruoli e giudice con `possible_path/unknown` che impediscono `accept`; test di rifiuto, ID falsi e rivalidazione prima di repair. ZIP round-trip e input ostili. Playwright desktop/mobile con 12 chiamate ai revisori, pista precedente visibile ai soli specialisti autorizzati, giudice con `informationTransferReview` e freeze senza riscrittura.
