# ADR 0151 — Orchestrazione per modelli locali lenti: delta di memoria, guardia di contesto, redazione leggera

Stato: accettato · Emenda parzialmente ADR 0011 (solo come opt-in per libro).

## Contesto

Con un modello locale (~2,4 token/s, contesto 16k) i prompt misurati erano: specialisti ~11k caratteri, storico ~16,7k, lettori ~6,5k, giudice ~41k (con 4 segmenti e 48 rapporti; teoricamente centinaia di migliaia). Il costo dominante era il prefill e il numero di chiamate (12 revisori × segmenti), non la scrittura.

## Decisioni

1. **Memoria a delta** (`domain/memory-delta.ts`): per le attività di scrittura il modello restituisce soltanto le modifiche alla memoria; il codice le applica con validazione zod e limiti. Il prompt non ripete più l'intera memoria in uscita.
2. **Guardia di contesto** (`application/context-guard.ts`): prima della POST confronta la stima dei token del prompt con il contesto caricato in LM Studio (letto da `/api/v0/models`) e si ferma con un messaggio leggibile invece di far troncare il prompt dal server. Mai troncare silenziosamente segreti o prosa.
3. **Rifiuto delle risposte troncate**: `finish_reason: "length"` produce `TruncatedProviderContentError`; l'usage osservato è conservato (ADR 0106), nessun testo parziale entra nel canone.
4. **Piano a tappe**: il piano si genera per tappe (capitoli, poi scene), con ripresa dal checkpoint; i prompt restano sotto il contesto.
5. **Controllo di sanità della prosa** (`domain/prose-sanity.ts`): controlli *solo strutturali* (vuoto, ripetizioni degenerate, markup/meta-testo) prima di accettare la scena. Non è una valutazione semantica.
6. **Compattazione della memoria** come attività dedicata quando supera la soglia.
7. **Stima del tempo residuo** (`domain/book-eta.ts`) dai tempi osservati nelle Activity; mostrata come stima, mai come promessa.
8. **Preset modello veloce per i controlli** (`domain/model-routing-preset.ts`): proposta esplicita, mai automatica, di instradare le attività di verifica su un modello più rapido. L'autore conferma.
9. **Prefisso di sistema comune** ai revisori (~3k caratteri) per sfruttare la cache di prefisso del server; l'etichetta del ruolo resta in fondo.
10. **Redazione leggera (opt-in per libro, `BookProject.editorialMode:"light"`)**: 5 revisori (continuità, segreti, timeline, stile, lettore generalista), più lo storico quando il capitolo ha fonti attive, più il **direttore critico**. Il ciclo persiste i propri `roles` (`ChapterEditorialCycle.roles`): cambiare modalità non altera un ciclo avviato. `assertEditorialReviewCoverage` e `nextReviewSlot` usano `cycleRoles`; il gate resta rigoroso (nessun rapporto mancante, prove letterali, timbri del testo). I capitoli congelati con questa modalità sono marcati `Chapter.editorialMode:"light"` e la UI lo mostra. Default invariato: 12 revisori.

## Revisori in parallelo (opt-in, aggiunto in 0.12.1)

`BookProject.editorialConcurrency` (1–4, default 1 = sequenza). Il commit resta **sequenziale e in ordine**: il gate di copertura dei rapporti (ADR 0099) non cambia.

- Mentre il revisore i risponde, i successivi (fino a K−1) partono in anticipo (`application/model-call.ts`, `ReviewCallPool`). Quando il ciclo arriva alla posizione j, ricalcola il prompt dal libro corrente e usa la risposta anticipata **solo se system e user prompt sono identici** a quelli con cui è stata richiesta; altrimenti la scarta e rifa la chiamata. Una modifica dell'autore a metà non può quindi applicare un rapporto basato su testo vecchio.
- Prerequisito di indipendenza: in parallelo il prompt non include le `memoryNote` dello stesso ciclo (ogni revisore non ricorda le proprie note dei segmenti precedenti; restano quelle dei round precedenti). È il compromesso dichiarato in UI.
- **Mai in parallelo con il budget AI attivo**: il preflight prenota il costo per chiamata e non può sommare richieste concorrenti. Giudice, riparazioni e sinossi restano sequenziali.
- Se un revisore fallisce, la sessione si ferma come prima; le richieste anticipate non consumate vengono interrotte e registrate come `cancelled` (con usage se noto, `aiRequested:true`), mai lasciate `running`. Il pannello live mostra solo la chiamata in uso.
- Un server locale che serve una richiesta alla volta non guadagna nulla; serve un provider cloud o LM Studio configurato per più richieste simultanee (che può dividere il contesto fra gli slot: la guardia di contesto usa quello caricato).

## Ritentativo automatico su ogni endpoint (opt-in, 0.12.1)

`EndpointProfile.autoRetry` e `autoRetryMax` (1–5, default 2) sostituiscono il flag `localAutoRetry` (letto ancora come «attivo» solo sugli endpoint locali senza chiave quando `autoRetry` non è impostato). `application/auto-retry.ts` decide: niente ritentativo per HTTP 401/403/404, errori di configurazione, prompt oltre il contesto, interruzione, lease perso, `AiBudgetStop`. Con chiave: pausa `5 s × tentativo`, interrompibile. Il preflight del budget gira a ogni tentativo e con usage incerto si ferma da solo: il retry non aggira il budget. Non è un retry infinito (ADR 0107/0110: mai silenzioso, mai oltre il tetto).

## Non fatto

- Altre parti parallelizzabili (lettori ciechi su più capitoli, scene di capitoli diversi) dipendono dalla memoria narrativa sequenziale: rinviate.

## Conseguenze

- La redazione leggera riduce la diversità dei punti di vista (un solo lettore cieco): è una scelta dell'autore, dichiarata in impostazioni e nel capitolo congelato.
- ZIP: `roles` (enum, univoci, 1–12), `editorialMode` validati strict; archivi precedenti restano validi. Import non autentica i rapporti.
- Nessuna nuova chiamata di rete oltre a `/api/v0/models` già usato per la lettura del contesto, solo su loopback.
