# ADR 0170 — Adozione di un libro GitHub da parte del server e rilascio al client

- Stato: **implementato nel sorgente** (0.34.0); server da sorgente.
- Data: 2026-11-19.
- Integra ADR 0167 (autorità del server e trasferimento di un libro senza GitHub) e 0169 (git sul server, pull e unioni).
- [Guida](../docs/personal-server-git.md) · [F04](../features/F04-server-git-branches-merge.md).

## Richiesta

Un libro che l'autore ha scritto sul client e salvato su GitHub deve poter passare al server, e il server deve poterlo restituire. Il server legge prima il repository, quindi non ricevere il testo dal browser è un vantaggio, non un compromesso.

## Decisioni

1. **L'autorità è sempre una sola e il marcatore nel repository è la prova tra dispositivi.** Il client blocca la propria copia PRIMA della rete (replica di sola lettura con l'epoca scelta e un intento durevole), esattamente come per un libro senza GitHub. Il server adotta e solo dopo pubblica il marcatore `executionAuthority` in `.bookwriter/project.json`. Finché il marcatore non è su GitHub il server rifiuta qualunque richiesta AI (l'ammissione legge il marcatore sulla testa).
2. **Nessun manoscritto viaggia.** `POST /api/v1/handoffs/github` porta solo identificativi, epoca, la destinazione (`owner/repository/branch`), il commit che il client aveva salvato e il PAT delegato **per quel libro** con consenso esplicito. L'impronta della ricevuta durevole non contiene il PAT. Il PAT viene collegato all'ID del libro prima di leggere (serve alla lettura) e rimosso se l'adozione non si completa o viene annullata.
3. **Condizioni per accettare:** la repository contiene proprio quel libro (stesso ID), non attribuisce l'autorità a un altro server, discende dal commit salvato dal client (altrimenti `handoff_stale`: il client deve salvare/aggiornare), il PAT può scrivere, e una repository pubblica richiede il consenso. I consensi del libro non si ereditano. Una richiesta identica già accolta riceve la stessa risposta senza nuovi commit; un libro già presente non si sostituisce; l'annullamento usa lo stesso registro di rifiuti del trasferimento senza GitHub.
4. **Un solo commit sopra ciò che il client ha salvato** aggiunge il marcatore (`push` con `adopt`: la testa deve contenere lo stesso libro senza marcatore o con il nostro). Se la pubblicazione fallisce il libro resta adottato ma fermo, con il motivo scritto e «Salva su GitHub dal server» che completa l'adozione.
5. **Rilascio (`release_book`).** Il server prima porta tutto su GitHub (pull e unione di ciò che è arrivato; i conflitti fermano il rilascio), poi pubblica un commit **senza marcatore** (`push` con `release`). Solo allora marca l'autorità del libro con `releasedAt`/`releasedCommit`, revoca il PAT delegato, spegne l'autosync e smette di eseguirlo: ogni comando è rifiutato (`released`), scheduler e scritture ignorano il libro. Se il rilascio si interrompe a metà, la repository senza marcatore impedisce comunque di avviare l'AI.
6. **Ripresa sul client (`takeBackPersonalServerBook`).** La replica apprende il rilascio dallo snapshot (che il server continua a servire in lettura), poi in una transazione il libro diventa locale: senza autorità, con `lastSyncedCommit = releasedCommit` e pulito rispetto a quel commit, senza cursore né giornale dei comandi. Un client senza replica non scarica libri rilasciati. Lo stesso libro può essere adottato di nuovo dallo stesso server con una nuova epoca.

## Limiti

- Nessun subentro a tempo e nessun rilascio se il server non è raggiungibile: il recupero resta amministrativo o con una copia con nuovo ID (come nell'ADR 0167). Il client non ripristina da solo la propria autorità.
- Il client non verifica su GitHub che la testa sia il commit rilasciato prima di riprenderlo: la prima sincronizzazione lo farà con le regole di sempre (fast-forward o confronto).
- Un solo server per libro e per repository; nessun trasferimento diretto tra due server.
- Provato con repository `git` locali e GitHub simulato, non con GitHub reale.
