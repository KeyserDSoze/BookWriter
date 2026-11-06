# F01 — Autopilot supervisionabile, multiprovider, mobile, sync

## Progresso versionato

- [x] PR #1: UI local-first, idea/review/autopilot prototipale, routing modelli, log e checkpoint.
- [x] PR #1: esportazioni ZIP e EPUB/PDF/DOCX, test iniziali.
- [x] PR #7: test Playwright mobile/desktop e navigazione mobile corretta.
- [x] PR #8: PAT GitHub locale, canon Markdown, commit manuale e import conservativo.
- [x] PR #9: autosync opt-in con outbox IndexedDB atomica, retry, Web Locks tra tab, recupero dei commit ambigui; CI e Playwright desktop/mobile superati.
- [x] PR #12: writer lease GitHub con heartbeat e recupero manuale, CI e Playwright desktop/mobile superati.
- [ ] PR #14: confronto visuale base/locale/remoto con scelta per scena/entità, doppio backup e recupero conservativo, in verifica CI.
- [x] PR #16: diff parole/paragrafi con fallback mobile, task AI `merge`, bozza manuale, storico ZIP e conferma umana di canonizzazione; CI e merge completati.
- [x] PR #18: telemetria token per libro/modello da report provider, CI verde e merge.
- [ ] PR #19: panel editoriale indipendente 7 specialisti + 5 lettori per capitolo, giudizio critico motivato, remediation accettate, re-review, freeze e riapertura retroattiva; in verifica CI (ADR 0011, issue #20).
- [x] PR #21 (v0.8.1): tariffe manuali EUR/milione per endpoint/modello, budget stimato per libro, stop prima di chiamate dei 12 agenti e della fusione AI, activity attempted e ZIP full; CI verde e merge su main.
- [x] PR #25 (v0.9.1): bibliografia Crossref DOI per capitolo, ricerche autorizzate, metadati distinti dalle prove, revisore e giudice informati, privacy e rewind dei capitoli congelati; CI verde e merge in main, ADR 0014.
- [x] PR #24 (v0.9.0): dossier storico per capitolo con query pubbliche approvate, link Wikipedia/revisioni, riferimenti validati nel revisore e nel giudice, invalidazione freeze retroattiva; in verifica CI (ADR 0013, issue #23).
- [x] PR #27 (v0.9.2): citazioni storiche per singola fonte, controlli anti-falsa corroborazione e giudice critico, con regressioni Vitest; ADR 0015.
- [x] PR #28 (v0.9.3): catalogo istituzionale Library of Congress con query approvate, metadati separati dalle prove, contesti privati, Web Locks/freeze e test CI (ADR 0016).
- [x] PR #29 (v0.9.4): trascrizioni di originali LoC consultati dall'autore, provenienza/diritti dichiarati, citazioni verificabili solo nella trascrizione, snapshot e test CI (ADR 0017).
- [x] v0.10.0 (PR #35): confronto live consentito per OCR LoC archiviati e quarantena manuale con rewind, hash/offset verificati senza promuovere licenze/autenticità, test desktop/mobile (ADR 0023).
- [x] v0.9.9 (PR #34): recupero controllato di brevissimo OCR istituzionale LoC con diritti dichiarati dall'autore, citazioni letterali per fonte, isolamento agente e freeze, CI desktop/mobile (ADR 0022).
- [x] v0.9.8 (PR #33): consultazione consensuale metadati di accesso/diritti LoC, snapshot e isolamento storico/giudice, nessun originale letto, CI desktop/mobile (ADR 0021).
- [x] v0.9.7 (PR #32): riverifica remota Wikisource consentita, eventuale esclusione manuale con rewind e audit; diritti/non autenticità non cambiano (ADR 0020).
- [x] v0.9.6 (PR #31): lettura `revids` esatta di Wikisource, SHA-256 e frammento letterale, legacy solo audit, prove testuali senza autenticazione storica, CI mobile/desktop (ADR 0019).
- [x] v0.9.5 PR #30: estratti Wikisource pubblici revisionati, consenso query, quote per fonte, revisioni/diritti non certificati (ADR 0018).
- [ ] Issue #23: fonti primarie e archivi istituzionali, bibliografia controllata, confronti fra fonti, e query estratte dai capitoli solo dopo conferma autore.
- [ ] Issue #17: ledger storico per cached tokens e tariffe versionate, integrazioni provider-native opzionali e budget distribuito tra dispositivi.
- [ ] Hardening del lease e revisione automatica del canon delle proposte (#10), OAuth Google/Microsoft (#2).
- [ ] Completezza canon Narrarium e controlli rigorosi sui segreti (#5).
- [ ] Budget, modelli per riassunti dedicati e test con provider reali (#6).

## Criteri di accettazione

- [ ] Da telefono e desktop tutte le pagine critiche sono utilizzabili senza scroll orizzontale e il task corrente è immediatamente visibile.
- [ ] L'autore può fornire un brief senza limite applicativo arbitrario, con stile e capitoli opzionali.
- [ ] L'autopilot mostra fase, ragione, modello, summary, output, step successivo e stato di sync per ogni attività.
- [ ] Può essere messo in pausa e ripreso da un checkpoint, senza duplicare scene o commit.
- [ ] L'autore può dire “non così” su qualsiasi elemento, vedere un impact plan e applicare correzioni retroattive tracciate; vincoli espliciti persistono.
- [ ] Brainstorm su tre orizzonti, review 5 personas, adversarial, continuità, storico/fattuale, segreti e rivelazioni sono task separati e verificabili.
- [ ] Più endpoint OpenAI-compatible configurabili e associabili a libri differenti; route per task/model con modello inseribile manualmente.
- [ ] Su errore API l'autopilot si ferma e mostra la causa senza key; retry solo esplicito.
- [ ] Due dispositivi non possono scrivere lo stesso libro in autopilot simultaneamente senza lease.
- [ ] IndexedDB resiste al reload e il riavvio rispetta esatto stato task/scene.
- [ ] Login Google o Microsoft abilita il recupero dei profili da appDataFolder / approot, con consenso richiesto.
- [ ] PAT scoped non compare in log, repo libro, HTML o bundle.
- [ ] Restore ZIP completo e content-only con schema validation, backup e opzione password; niente credenziali nel content-only.
- [ ] Commit remoto a milestone; ZIP snapshot periodico; pull delta e conflict UI con confronto base/locale/remoto.
- [ ] Se pagina viene sospesa, al ritorno la UI indica attività sospesa e propone resume. Non promettere esecuzione in background.
- [ ] Esportazione reale e valida di EPUB, PDF e DOCX.
- [ ] `npm run typecheck`, `npm run test`, `npm run build` e test e2e documentati nella CI, senza credenziali in fixtures.
