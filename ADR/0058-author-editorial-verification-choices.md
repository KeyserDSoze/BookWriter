# ADR 0058 — Scelte private dell'autore sui controlli del giudice

- **Stato:** accettato per v0.11.25 (PR in verifica)
- **Data:** 2026-11-08
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0054–0057

## Problema

La v0.11.24 presenta `missingEvidence` e `nextCheck` del giudice, ma non permette all'autore di registrare una preferenza privata per prenderli in carico, respingerli o azzerare una scelta precedente. Salvare direttamente uno stato del giudice o eseguire il controllo senza richiesta esplicita potrebbe compromettere l'indipendenza editoriale, riabilitare decisioni stale e divulgare note private agli agenti.

## Decisione

1. Introdurre **separatamente** `BookProject.editorialVerificationChoices?: EditorialVerificationChoice[]`, append-only max **160**. Campi strict `id`, `chapterId`, `planKey` esatto, `round`, **snapshot letterale** di `quote`, `missingEvidence`, `nextCheck`, `judgeExplanation`, `status=taken_on|dismissed|reset`, `rationale` privata di 20–500 caratteri, timestamp ISO. Nessun record implica l'autenticità dell'autore o una nuova verità narrativa.
2. Il software consente una scelta **soltanto** su una voce effettivamente corrente del `buildEditorialVerificationPlan` con `status=needs_evidence`, capitolo e round del ciclo attivo, identificativo esatto e giudizio interamente rivalidato dalla funzione v0.11.24. Nessun grant su `approved_edit`, `closed_no_edit`, `awaiting_judge`, `requires_recheck`, `archived`, voci fuori dai primi 24 o gruppi oltre i limiti. Lo storico non diventa una coda lavori.
3. **Last-wins per `chapterId+planKey`**, incluso `reset` e una valutazione successiva con una fonte diversa: una nuova modifica del check non riattiva tacitamente una scelta precedente. Il record corrente viene mostrato solo se **tutti** gli elementi dello snapshot corrispondono a quelli rivalidati sul libro. Non memorizzare l'intera prosa o inventare nuove verifiche. La stessa citazione e lo stesso suggerimento nuovamente identici dopo una riscrittura potrebbero risultare indistinguibili senza un ledger delle revisioni: la feature non autentica la storia né sostituisce il gate editoriale.
4. **L'applicazione** usa Web Locks `bookwriter:writer:<bookId>` e `bookwriter:github-outbox`, optimistic CAS `updatedAt`, operazione atomica `books+activities+outbox`. Richiede `book.status!==running` e `editorialCycle.stage===blocked`: l'autore non interviene mentre gli agenti stanno redigendo/revisionando. Ogni scelta spegne `remote.autoSync`, cancella la coda outbox e scrive un'attività **generica**, senza nomi, quote, ID, status, rationale o spoiler. Il log non contiene gli esiti umani.
5. UI nella **singola voce corrente e irrisolta del piano**: pannello con status, motivazione privata, storico last-wins, pulsanti **Prendi in carico**, **Respingi suggerimento**, **Azzera scelta** e dialogo di conferma su conseguenze (nessuna nuova chiamata AI/HTTP, nessun check eseguito, autosync OFF). Il pulsante azzera richiede una scelta corrente. Controlli disabilitati con autopilot o redazione attiva. Le aree dei giudizi archiviati rimangono read-only.
6. `taken_on` **non** esegue una verifica; `dismissed` **non** respinge il finding del giudice; `reset` **non** elimina audit. Nessuna nuova chiamata a writer, repair, specialisti, judge o lettori ciechi; non cambia `judgment`, `findings`, `freeze`, prosa, memoria, segreti, canone, timeline, modalità di sync o gate di remediation. Una verifica ancora irrisolta resta `needs_evidence` indipendentemente dalla scelta dell'autore. I tre status non sono permessi AI.
7. ZIP content/full schema **strict** max160, enum e limiti quote/note/date, compatibile con archivi legacy senza campo. Import **non autentica scelte altrui**: se vi sono scelte attive, ne aggiunge uno `reset` per ogni ultima coppia `chapterId+planKey`; se si supera il cap160, scarta l'intero audit importato delle scelte. Resta possibile esportare l'audit anche nei backup cifrati. ZIP e push GitHub **manuali** possono divulgare spoiler, benché l'autosync sia fermato.
8. I dati sono **locali e privati per impostazione predefinita** ma non protetti contro chi legge un ZIP esportato. La nuova proprietà del libro non deve entrare in prompt di nessun ruolo e non produce canone o autorizzazione a processare contenuti con AI.

## Test richiesti

Vitest dominio: default deny, fonte esatta, prese in carico/rifiuto/reset last-wins, assenza di leak ai prompt, invalidazione quando cambia `nextCheck`/prosa o è storica/chiusa, cap e stati ostili. Application: lock, CAS, pausa/redazione bloccata, transazione, autosync OFF, outbox delete, log senza private data. ZIP content/full cifrato/ostile/legacy, import con reset e limite pieno. Playwright desktop/mobile: conferme, tre azioni, audit, reload, suggerimento modificato invalida scelta e layout.

## Limiti

Non è un sistema di checklist esecutivo né certifica l'identità di un autore remoto. Nessuna presa in carico indica che una ricerca sia stata completata o che il giudice debba modificare il verdetto; per riaprire davvero la redazione si usa il flusso già esistente di riapertura, con conferma separata e nuove chiamate AI solo se l'autore le avvia.
