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

## Non fatto

- **Revisori in parallelo**: richiede di ridisegnare il checkpoint sequenziale e il gate di copertura (che assume prefissi ordinati). Su un solo modello locale il parallelo non accelera; rinviato.

## Conseguenze

- La redazione leggera riduce la diversità dei punti di vista (un solo lettore cieco): è una scelta dell'autore, dichiarata in impostazioni e nel capitolo congelato.
- ZIP: `roles` (enum, univoci, 1–12), `editorialMode` validati strict; archivi precedenti restano validi. Import non autentica i rapporti.
- Nessuna nuova chiamata di rete oltre a `/api/v0/models` già usato per la lettura del contesto, solo su loopback.
