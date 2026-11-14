# F01 — Autopilot supervisionabile, multiprovider, mobile, sync

## Progresso versionato

- [x] v0.13.2: ispezione locale live della singola richiesta dopo clic esplicito, risposta/reasoning separati, autoscroll sospendibile e coda di cinque righe sfumate nel riquadro fisso con contatori; stream paralleli isolati, trascrizioni finali/parziali opt-in non canoniche, revoca immediata dei testi volatili (ADR 0152).

- [x] v0.11.69 (issue #106): fonti storiche del revisore rivalidate su dossier live prima di nuovo reviewer, giudice, freeze e repair ripreso; stop senza chiamate AI su revisione ritirata, estratto cambiato o fonti dipendenti (ADR 0101).
- [x] v0.11.68 (issue #105): recupero supervisionato dei checkpoint editoriale stale/incompleti via conferma esplicita, snapshot audit/ZIP integrale, Web Locks e transazione locale, autosync sospeso e riavvio dal primo revisore senza perdere il canone (ADR 0100).
- [x] v0.11.67 (issue #104): gate strutturale sui 12 rapporti × segmenti prima del prossimo reviewer, del giudice e del freeze, con impronta del testo letto inclusi report pass e fail closed per checkpoint legacy/stale/incompleti (ADR 0099).
- [x] v0.11.66 (issue #103): segmentazione grapheme-safe per tutti i 12 revisori; limite vero 10.000 unità UTF-16, Unicode non spezzato, errore conservativo su runtime/input malformato e citazioni verificabili (ADR 0098).
- [x] v0.11.65 (issue #102): PDF Unicode offline per Latin Extended e cirillico con font PT Serif Regular/Bold sotto OFL e preflight TrueType cmap; WinAnsi Times invariato, emoji/CJK fail-closed (ADR 0097).
- [x] v0.11.64 (issue #101): EPUBCheck W3C 5.4.0 obbligatorio su matrice di 4 manoscritti sintetici (canon/draft, primo capitolo tardivo, XML/Unicode, testo lungo), file non vuoti e privacy verificati (ADR 0096).
- [x] v0.11.63 (issue #100): job CI EPUBCheck 5.4.0 ufficiale con release/digest fissati e fixture `buildEpub` sintetica, privacy e Unicode/escaping testati (ADR 0095); non certifica tutte le esportazioni.
- [x] v0.11.62 (issue #99): numerazione `Pagina X di Y` per pagine dei capitoli PDF canonici, frontespizio anche multipagina escluso; test bytes e browser desktop/mobile (ADR 0094). Deploy da verificare, issue #98 ancora aperta.
- [x] v0.11.61 (issue #97): frontespizio EPUB 3 XML-safe, spine e landmarks titlepage/bodymatter sul primo capitolo canonico, con test ZIP/XML browser desktop/mobile (ADR 0093); epic #4 resta aperta.
- [x] v0.11.60 (issue #96): PDF con preflight WinAnsi fail-closed, builder verificabile e test desktop/mobile su errore senza download e file valido (ADR 0092); l'Unicode completo resta nella epic #4.
- [x] v0.11.59 (issue #95): DOCX ZIP OPC generato da builder testabile, contenuto canonico XML-safe, download e parsing WordprocessingML in test desktop/mobile (ADR 0091); epic #4 ancora aperta.
- [x] v0.11.58 (issue #94): indice EPUB per capitoli e scene canoniche con ancore XHTML stabili, semantica `aria-labelledby` e test ZIP/XML reali desktop/mobile (ADR 0090); epic #4 ancora aperta.
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
- [x] v0.10.6 (PR #41): proposte di query storiche locali e deterministicamente limitate a temi pubblici/anni espliciti, staging manuale e consenso separato prima di Wikipedia, nessun invio del manoscritto, test Vitest e Playwright (ADR 0029).
- [x] v0.11.3 (PR #49): indice effimero delle menzioni di scoperte, consegne di oggetti e cambiamenti di stato nella prosa congelata, quote/offset letterali, UI consultiva, contesto solo per gli specialisti autorizzati e il giudice; nessuna promozione automatica nel canone (ADR 0036, issue #20).
- [x] v0.11.2 (PR #48): ranking locale di entità/termini/date per trovare scene rilevanti anche nei capitoli intermedi, finestre letterali focalizzate nel mezzo, disclosure dei limiti e audit numerico, privacy dei lettori invariata (ADR 0035, issue #20).
- [x] v0.11.1 (PR #47): dodici percorsi di mutazione dei dossier storici convergono nella catena cross-chapter con trigger historical_evidence, senza trattare le fonti come prosa cambiata; contesto limitato al revisore storico e giudice, lettori ciechi invariati, backup/CI/Playwright (ADR 0034, issue #20/#23).
- [x] v0.11.0 (PR #46): catena persistente di rivalidazione per riaperture manuali e retcon, gate predecessori congelati, campioni pubblici con offset ai quattro specialisti e al giudice, lettori ciechi invariati, audit del nuovo freeze e test Vitest/Playwright (ADR 0033, issue #20).
- [x] v0.10.9 (PR #45): validazione letterale di evidence per segmento per tutti e 12 i revisori, offset e contesto deterministici, blocco delle remediation con report legacy/stale, UI e test desktop/mobile (ADR 0032, issue #20).
- [x] v0.10.8 (PR #44): lockfile npm 10 reale, due installazioni `npm ci` pulite e workflow CI/Pages fail-closed; smoke di coerenza e integrità, ADR 0031, issue #43.
- [x] v0.10.5 (PR #40): dichiarazioni dell'autore su origine condivisa o derivazione di snapshot documentali, storico append-only, esclusione di falsa corroborazione transitiva, riapertura freeze e test desktop/mobile (ADR 0028).
- [x] v0.10.4 (PR #39): contesto esplicito per fonte (evento, periodo, luogo, edizione, incertezze), giudizio critico autonomo e blocco dei falsi conflitti fra eventi dichiarati diversi; compatibilità report legacy (ADR 0027).
- [x] v0.10.3 (PR #38): possibili divergenze tra 2–3 fonti storiche indipendenti, citazioni per fonte, motivazioni di supporto/contestazione e direttore critico; nessuna verità certificata (ADR 0026).
- [x] v0.10.2 (PR #37): collegamento a metadati di una risorsa immagine IIIF LoC selezionata dall'autore, due consensi, snapshot e isolamento storico/giudice, nessun pixel scaricato, CI desktop/mobile (ADR 0025).
- [x] v0.10.1 (PR #36): collazione visiva manuale su scansione LoC dichiarata dall'autore, confronto di brevi testi, isolamento storico/giudice, nessuna autenticazione automatica (ADR 0024).
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

- [x] v0.11.5: paginazione 30/80 delle menzioni candidate e registro derivato delle sole attestazioni autore correnti, con confronto manuale per nome esatto fra capitoli e storico delle rettifiche invariato. Nessuna semantica di contraddizione garantita (ADR 0038, issue #20).

- [x] v0.11.6: segnali locali, esplicitamente **non certificati**, fra attestazioni ancora valide (azione dopo morte, morti ripetute, date ISO in ordine inverso), con due prove letterali e motivazioni; nessuna riscrittura o lettura di segreti, CI desktop/mobile (ADR 0039, issue #20).

- [x] v0.11.7: anteprima **esplicita, temporanea e revocabile** di una coppia di alias da attestazioni correnti, confronti cross-name aggiuntivi senza sovrascrivere quelli letterali, zero canone/rete/persistenza (ADR 0040, issue #20).

- [x] v0.11.8: registro append-only di alias motivati legati a due attestazioni correnti, revoche/staleness senza riattivazioni, ZIP strict, Web Locks/CAS/outbox e confronti read-only; nessuna modifica canone né prompt dei revisori (ADR 0041, issue #20).

- [x] v0.11.9: recupero locale limitato a 8 testimoni attestati di capitoli precedenti durante le review dei 4 specialisti e giudice se c'è finding ancorato, con alias diretti validi, limiti e privacy dei cinque lettori ciechi; nessun verdetto automatico (ADR 0042, issue #20).

- [x] v0.11.10: giudizio critico strutturato su rilievi narrativi con testimone precedente valido, quattro dimensioni motivate, gate locale per accept/retry prima del repair anche dopo import; ZIP strict per metadata e UI di audit (ADR 0043, issue #20).

- [x] v0.11.11: confronto locale di scene precedenti canoniche congelate senza attestazioni autore (3 finestre), ipotesi letterale `priorSceneConflict`, giudice critico strutturato, gate su libri freschi anche al salvataggio del repair e ZIP strict (ADR 0044, issue #20).

- [x] v0.11.12: giudizio epistemico strict per conflitti sul sapere dei personaggi, con modalità narrativa fonte/corrente, percorso dell'informazione, condizioni conservative di accept e invalidazione al repair; UI e ZIP legacy-safe (ADR 0045, issue #20).

- [x] v0.11.13: piste bounded di possibili comunicazioni fra nomi in prosa precedente congelata (max 4), giudice con disposizione per ogni pista e blocco conservativo di false remediation di `knowledge`, ZIP strict e audit UI (ADR 0046, issue #20).

- [x] v0.11.14: registro autore append-only di `knowledge_mention` correnti con `learned_directly|reported_by_other|still_secret`, CAS+Web Locks, autosync disabilitato, audit/staleness e ZIP strict; nessun invio automatico ai modelli o aggiornamento del canone (ADR 0047, issue #20).

- [x] v0.11.15: opt-in e revoca append-only per interpretazione knowledge e cinque soli destinatari editoriali, pacchetto minimo e fail-closed, nessun nuovo dato ai lettori ciechi; ZIP revoca permessi importati, CAS/locks e UI (ADR 0048, issue #20).

- [x] v0.11.16: collocazione del sapere di un personaggio rispetto alla scena e distinzione fra ordine di manoscritto e storia, rettifiche append-only, invalidazione delle fonti, privacy AI anche dopo consenso knowledge, ZIP strict e UI per personaggio (ADR 0049, issue #20).

- [x] v0.11.17: confronto motivato a coppie di conoscenze correnti di personaggi distinti, same/different con storico e staleness, senza inferenza transitiva o trasferimento, privacy AI anche con opt-in pregresso, CAS+locks e ZIP strict (ADR 0050, issue #20).
