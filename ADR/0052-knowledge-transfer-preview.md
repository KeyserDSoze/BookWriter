# ADR 0052 — Anteprima privata delle possibili comunicazioni per coppia knowledge

- **Stato:** accettato per v0.11.19 (PR #65)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0046–0051

## Problema

La v0.11.13 rileva alcune formule narrative di passaggio di informazioni in modo lessicale e limitato, ma le usa nel giudizio su un *finding* corrente. La v0.11.17 permette all'autore di dichiarare che **due menzioni distinte** riguardano «la stessa informazione» senza attribuire a una persona l'apprendimento o la trasmissione. Manca una vista umana per verificare **se il testo precedente descrive un possibile passaggio fra i due nomi esatti**, mantenendo separati tema, cronologia e comunicazione.

## Decisione

1. Aggiungere `previewKnowledgeTransferForPair(book, topicDecisionId)` nel dominio: ritorna un risultato **solo** se l'ID è quello di una decisione `same_information` **corrente e già rivalidata** nel registro (last-wins), fra due interpretazioni della conoscenza di nomi letteralmente distinti. `different_information`, storici, nuove menzioni senza link, coppie create per chiusura transitiva e ID importati falsi restituiscono `null`.
2. Per ciascun verso A→B e B→A, riutilizzare `buildInformationTransferTrace` con un **filtro opzionale esatto** `{sender,recipient}`: i due nomi sono confrontati con normalizzazione NFC/case, senza alias, pronomi o match parziali. La query locale è **solo la citazione letterale corrente del destinatario**; non si concatena memoria privata, altri segreti, rationale, timeline o prompt. Il vecchio scanner senza filtro mantiene i medesimi risultati per i revisori.
3. La ricerca considera esclusivamente capitoli canonici **congelati e precedenti al capitolo della menzione del destinatario nel manoscritto**, non un prima/dopo comprovato nella cronologia della storia. Budget per verso invariato: massimo 240 scene, prime 6.000 unità di testo per scena, prime 12 formule individuate per scena, massimo 4 candidati, con contatori di scene non esaminate e candidati non mostrati. Nessuna interpretazione di citazioni implicite, dialoghi nello stesso capitolo o flashback.
4. L'utente avvia esplicitamente l'anteprima dal pannello delle **relazioni correnti «stessa informazione»**. Il risultato è **effimero, puramente locale e ricalcolato quando cambia il libro**; chiuderlo non salva dati. Mostrare entrambe le direzioni, citazioni/offset del possibile passaggio, capitolo/scena, termini di match e limiti di scansione. L'assenza di candidati non significa prova dell'assenza di comunicazioni.
5. Una frase come «Elio rivela a Mara che...» può essere falsa, onirica o inattendibile: la presenza letterale e il match di temi **non** certificano trasmissione, ascolto, fiducia, comprensione, conoscenza, ordine temporale o canone. Nessuna nuova decisione dell'autore viene creata, nessun collegamento knowledge in più e nessuna riparazione avviata.
6. **Privacy:** zero nuovi HTTP/AI, token, modifiche a prompt o visibilità per lettori ciechi, nessun salvataggio in IndexedDB, ZIP, GitHub, attività, memoria, segreti, timeline, freeze o outbox. Le decisioni knowledge preesistenti conservano le policy ZIP/manual push delle ADR precedenti. Non si estendono consensi v0.11.15.

## Test

Vitest su due direzioni, filtri mittente/destinatario esatti e distrattori, mancato link e rettifica, fonte stale, scena draft/riaperta, riservatezza, vecchio scanner invariato; Playwright Chromium desktop/mobile su richiesta esplicita, risultati, rettifica, reload, assenza richieste AI/GitHub e assenza overflow mobile. CI su HEAD definitiva prima di integrare in main.

## Limiti

Il matching del tema è lessicale e non esaustivo; un testo può parlare della stessa notizia usando parole differenti. I risultati sono una **pista da leggere**, non un flusso causale. La ricerca è orientata all'ordine dei capitoli come manoscritto, anche quando l'autore ha annotato flashback; non corrobora la cronologia della finzione.
