# F01 — Autopilot supervisionabile, multiprovider, mobile, sync

## Progresso versionato

- [x] PR #1: UI local-first, idea/review/autopilot prototipale, routing modelli, log e checkpoint.
- [x] PR #1: esportazioni ZIP e EPUB/PDF/DOCX, test iniziali.
- [x] PR #7: test Playwright mobile/desktop e navigazione mobile corretta.
- [x] PR #8: PAT GitHub locale, canon Markdown, commit manuale e import conservativo.
- [x] PR #9: autosync opt-in con outbox IndexedDB atomica, retry, Web Locks tra tab, recupero dei commit ambigui; CI e Playwright desktop/mobile superati.
- [x] PR #12: writer lease GitHub con heartbeat e recupero manuale, CI e Playwright desktop/mobile superati.
- [ ] PR #14: confronto visuale base/locale/remoto con scelta per scena/entità, doppio backup e recupero conservativo, in verifica CI.
- [ ] PR #16: diff parole/paragrafi con fallback mobile, task AI `merge`, bozza manuale, storico ZIP e approvazione solo con doppio backup; in CI.
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
