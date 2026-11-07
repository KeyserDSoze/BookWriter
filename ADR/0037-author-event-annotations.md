# ADR 0037 — Annotazioni esplicite dell'autore su menzioni narrative

- **Stato:** proposta per v0.11.4 (verifica CI/PR necessaria)
- **Data:** 2026-11-07
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessore:** ADR 0036 — menzioni letterali non verificate

## Contesto

La v0.11.3 riconosce frasi del manoscritto che *potrebbero* descrivere passaggi di oggetti, acquisizioni di conoscenza o mutamenti di stato. Senza un giudizio esplicito dell'autore è pericoloso inserire tali frasi in canone, inventario, timeline o segreti: potrebbero essere menzogne, dialoghi, sogni o metafore.

## Decisione

1. Una menzione di scena canonica in un capitolo **congelato** può ricevere un'annotazione esplicita `affirmed` oppure `dismissed`, sempre con motivazione di 12–500 caratteri, dialogo di conferma e ID/timestamp. `affirmed` significa che **l'autore ha dichiarato** l'evento avvenuto nel racconto, non che il software lo abbia verificato o che i fatti storici siano veri.
2. Le decisioni sono **append-only**, fino a 400 per libro; ogni rettifica produce un nuovo record. Il record incorpora `chapterId`, `sceneId`, categoria, citazione letterale, offset, `frozenAt` e checksum **non crittografico** della scena. Citazione e offset devono essere ricostruibili dal pattern originale; il checksum serve solo a non riusare per errore un'annotazione dopo un cambiamento della scena, **non** a provare autenticità o integrità contro un attaccante.
3. La decisione corrente viene mostrata soltanto se il capitolo è ancora congelato con lo **stesso freeze**, la scena è canonica, citazione/offset combaciano e la scena conserva la firma di freschezza. Riaperture, riscritture e scene ritirate rendono le decisioni precedenti *storiche*, senza eliminarle o riattivarle automaticamente al freeze successivo.
4. Salvataggio locale sotto Web Locks writer/outbox, controllo `updatedAt` prima e dentro la transazione, attività di audit e aggiornamento atomico del libro. Niente chiamate AI o HTTP, niente nuova scansione remota. Per prevenire pubblicazioni silenziose di questi metadati, il salvataggio disabilita l'autosync e rimuove la relativa outbox, dopo avviso e conferma. La successiva pubblicazione resta manuale.
5. Il campo `BookProject.narrativeEventDecisions` passa attraverso snapshot GitHub/ZIP come **metadato di interpretazione**, con schema Zod stretto e limiti. I record provenienti da ZIP non autenticano l'identità del dichiarante. I nuovi dati non alimentano alcun prompt, memoria segreti, stati di personaggi o meccanismo di remediation. Il modello non può usarli come autorizzazione a riscrivere.
6. Il pannello redazione mostra le prime 30 menzioni, decisione corrente, inserimento motivazione e storico completo delle scelte superate. I lettori ciechi e il gate delle 12 review non ricevono informazioni in più.

## Conseguenze e limiti

L'app offre ora un audit *umano* e revocabile delle interpretazioni, ma non dispone di un grafo causale o di un registro canonico certificato degli eventi. Se in futuro una decisione guiderà la scrittura, serviranno nuove regole di approvazione, invalidazione downstream, privacy e controllo delle contraddizioni. Gli hash non crittografici non sono firme digitali. Nessuna conclusione semantica o verifica delle fonti viene implicata da una citazione letterale.

Test attesi: Vitest dominio e persistenza/rollback, ZIP ostili, Playwright desktop/mobile e smoke npm/CI; nessun merge prima di CI verde.
