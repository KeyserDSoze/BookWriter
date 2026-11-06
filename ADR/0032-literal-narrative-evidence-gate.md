# ADR 0032 — Prove narrative letterali per la redazione a dodici agenti

- **Stato:** Accettato per v0.10.9 (PR #45)
- **Data:** 2026-11-06
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Predecessori:** ADR 0011 (redazione), 0027 (conflitti storici), 0031 (release riproducibili)

## Problema

I dodici revisori producono `findings` con `evidence`, `reason` e `remediation`. Fino alla v0.10.8 il validatore controllava schema, ID scena, fonti storiche e presenza di remediation, ma **non verificava che la prova narrativa fosse una sottostringa effettiva del segmento affidato al revisore**. Il direttore riceveva un `evidenceLocated` calcolato sulla scena intera e poteva accettare anche una critica che citava testo mai letto oppure inesistente. Il controllo sulle citazioni storiche non copriva questo problema.

## Decisione

1. Ogni nuovo rilievo deve contenere in `evidence` **almeno 12 caratteri di testo continuo** dal **singolo segmento** passato al revisore: non canone privato, altre scene, sommari, parafrasi o ellissi. Il validatore confronta in modo case-insensitive e tollera soltanto differenze di whitespace/andata a capo. Prima verifica che il segmento sia ancora identico a quello corrente nella scena. Se non trova la prova, **rifiuta il report intero** prima di archiviarlo. Un dubbio basato su un'assenza va ancorato a un passaggio osservabile, oppure emesso come `pass` se non documentabile.
2. La posizione della citazione si calcola **deterministicamente dal testo**: `NarrativeEvidenceAnchor` contiene `segmentIndex`, `offset`, `quote` originale, numero di occorrenze e contesto locale limitato. Non sono campi prodotti o verificati dal modello. Se il testo appare più volte si indica che la prima occorrenza è quella mostrata; non si finge unicità.
3. Il direttore riceve `anchorStatus` per ogni finding: `verified_in_reviewed_segment` soltanto se la posizione, il testo e il contesto ricalcolati risultano identici; in caso contrario `legacy_or_stale_unverified`. La presenza letterale è **una prova di trascrizione della prosa, non di verità semantica o storica**: il direttore deve comunque poter respingere con una motivazione.
4. Nell'autopilot il validatore delle decisioni riceve il capitolo corrente e **rifiuta una remediation accettata** se il finding non possiede un ancoraggio verificabile oggi. I rapporti vecchi/importati rimangono leggibili e respingibili, ma non possono provocare nuove riscritture senza una review fresca. Le decisioni già archiviate non vengono cancellate retroattivamente.
5. La UI presenta un'etichetta di citazione verificata, il segmento/offset, le occorrenze e il contesto; per i legacy mostra un avviso esplicito. Le memorie degli undici lettori ciechi e i dossier storici non vengono estesi. Nessuna rete, provider, tariffa AI, permission o modifica automatica a libri conservati.

## Qualità, rischi e mitigazioni

- Le citazioni dell'agente possono essere corrette **letteralmente** ma la conclusione infondata: resta centrale il giudice critico. La normalizzazione del whitespace **non autorizza** riordinamenti, abbreviazioni o parafrasi.
- Citazioni più corte di dodici caratteri, o prove di omissioni non ancorate, possono richiedere un retry o l'intervento dell'autore. Il limite è intenzionalmente conservativo, per non accettare referti impossibili da verificare.
- I vecchi rapporti privi di `evidenceAnchor` non sono cancellati: la UI li tratta con cautela e non possono generare nuove remissioni automatiche mentre una review riprende. Il software non certifica che le note dei revisori descrivano fatti storici veri.
- La posizione è relativa al **segmento**, non all'intero libro e non a un documento remoto. Alla modifica del testo va verificata nuovamente.

## Accettazione

- Vitest su parole inventate, altre scene, parafrasi, maiuscole/whitespace, citazioni ripetute, segmenti mutati, gate delle remediation di un report legacy/manomesso e possibilità di rifiutare.
- Playwright desktop/mobile sull'interfaccia dei rapporti moderni e legacy; nessun overflow, nessun nuovo fetch.
- CI sull'HEAD finale della PR (npm ci, typecheck, Vitest, smoke, Vite build, Playwright desktop/mobile); merge solo verde e successiva verifica separata CI main, GitHub Pages e cleanup.
