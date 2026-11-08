# Changelog — BookWriter

## 0.11.21 — 2026-11-08 (issue #20; PR in preparazione)

**Consensi AI espliciti per singoli giudizi autore su possibili comunicazioni**

- Nuovo `BookProject.narrativeTransferShareDecisions?`, storico append-only max **180** su ID **esatto** della valutazione corrente: `status=allowed|revoked`, uno o più ruoli opt-in `continuity,timeline,secrets,characterVoice,judge`, motivazione privata 12–500 e timestamp. Nessuna autorizzazione tramite vecchi consensi sulle knowledge. Ultimo permesso per ID prevale e ogni rettifica/source stale elimina la divulgabilità.
- `buildSharedTransferPack` fail-closed: **max 12** concessioni approfondite e **3** citazioni per richiesta, per nomi esatti e capitoli precedenti congelati. Condivide solo **citazione, mittente, destinatario, verdetto fallibile, capitolo/scena e offset**; MAI rationale, segreti, dati topic, tempi, archivio o appunti privati.
- Prompt solo ai quattro specialisti nominati; al giudice esclusivamente dopo finding **knowledge** con prova del segmento corrente ancora ancorata, e solo se autorizzato `judge`. I cinque lettori ciechi, storico/stile/narrativa, writer e repair non ricevono questi nuovi pack. Il giudice deve riesaminare e può RESPINGERE: niente canone, accettazione o remediation automatica.
- UI delle singole piste correnti: **Condivisione AI specifica**, checkbox tutte vuote per default, motivazione obbligatoria, conferma forte sull'invio a provider esterno, grant/revoca e stato corrente. Web Locks writer+outbox, CAS, transazione atomica, autosync OFF e outbox eliminata; activity privo di spoiler e contenuti dei consensi. La revoca vale solo per invii futuri.
- ZIP content/full strict e compatibilità legacy, import fail-closed: ultimo grant importato revocato localmente o intero audit scartato se si supera cap180. Test dominio, application, backup cifrato/import con permessi revocati e Playwright desktop/mobile. [ADR 0054](../ADR/0054-transfer-consent-ai-role-gate.md), [guida](transfer-consent-ai.md).

**Limiti:** ordine del manoscritto ≠ cronologia degli eventi; una pista/citazione con verdetto autore non prova consegna, apprendimento o verità. Le richieste AI esistenti possono consumare più token senza generare nuove chiamate.

## 0.11.20 — 2026-11-08 (PR #66, issue #20)

**Giudizi privati dell'autore per singole citazioni di possibili comunicazioni**

- `BookProject.narrativeTransferAssessments?` append-only max **120**: ID della coppia `same_information` corrente, due decisioni knowledge esatte in direzione mittente/destinatario, candidate ID dal campione della v0.11.19, `verdict=author_attested_report|possible_path|dismissed`, motivazione privata 20–650 e data. Un'attestazione è **lettura dell'autore**, non prova che qualcuno abbia ascoltato, creduto o acquisito una notizia.
- `createNarrativeTransferAssessment` rilegge e verifica l'esatta pista corrente e il collegamento; `buildNarrativeTransferAssessmentRegistry` è last-wins per fonte/direzione/coppia e invalida le scelte quando capitoli, prosa, conoscenze, legami o campioni cambiano. Nessuna riattivazione tacita di decisioni precedenti.
- Nel pannello **Piste comunicative della coppia** compaiono **Valuta questa pista**, tre verdetti non preselezionati, motivazione, conferma esplicita, giudizio corrente e storico. Senza un candidato letterale corrente non è possibile annotare; non esistono inferenze automatiche tra più personaggi.
- Salvataggio con Web Locks writer/outbox, CAS, blocco autopilot/redazione, transazione books+activities+outbox, autosync OFF e outbox eliminata. Activity senza nomi, prosa, verdict o note private. Nessuna mutazione di canone, segreti, timeline o prompt/consensi AI.
- ZIP content/full schema **strict**, max120, compatibilità legacy; archivi e push manuali possono contenere spoiler e le fonti importate non sono autenticate. Test dominio, application, privacy, ZIP cifrato e Playwright desktop/mobile. [ADR 0053](../ADR/0053-author-transfer-assessment-ledger.md), [guida](author-transfer-assessments.md).

**Limite:** il giudizio si riferisce solo a una menzione letterale non probatoria, non decide l'identità semantica, l'effettiva trasmissione, la cronologia della storia o la conoscenza canonica.

## 0.11.19 — 2026-11-08 (PR #65, issue #20)

**Anteprima locale dei possibili passaggi di notizie fra due knowledge confermate**

- Nuovo `previewKnowledgeTransferForPair` consultivo e on-demand: solo coppie `same_information` dirette e correnti già attestate, mai via confronto automatico delle parole o chiusura transitiva. Ricerca due direzioni mittente→destinatario utilizzando la **sola citazione del destinatario**.
- Filtro opzionale con nomi mittente/destinatario **letteralmente esatti** su `buildInformationTransferTrace`, senza cambiare l'esito dello scanner preesistente dei revisori. Campionamento invariato: massimo 240 scene precedenti congelate, 6.000 caratteri/scena, 12 formule/scena, 4 risultati per verso. Citazioni e offset letterali, contatori di esclusioni e limiti visibili.
- Pulsante **Esamina piste possibili** per ogni link `same_information` nel registro privato; anteprima effimera con entrambi i versi, messaggi potenziali, copertura e avviso esplicito che l'assenza di frasi non prova mancanza di comunicazione. Dopo rettifica o invalidazione del link la vista non è disponibile.
- Nessun aggiornamento a prosa/canone, memoria, segreti, timeline, freeze, outbox, registro o consent AI; nessun nuovo HTTP/AI, promozione a verità o passaggio certo. Test Vitest e Playwright desktop/mobile. [ADR 0052](../ADR/0052-knowledge-transfer-preview.md), [guida](knowledge-transfer-preview.md).

**Limite:** formule esplicite e ordine del manoscritto non sono cronologia narrativa, verità della voce, ricezione o conoscenza. La ricerca è bounded e può omettere dialoghi rilevanti.

## 0.11.18 — 2026-11-08 (PR #64, issue #20)

**Verifica consultiva dei collegamenti di conoscenza confermati dall'autore**

- `reviewNarrativeKnowledgeTopicTriangles` usa solo le decisioni **last-wins correnti**: segnala **soltanto** quando sono presenti direttamente tutti i tre verdetti A/B «stessa informazione», B/C «stessa informazione», A/C «informazioni differenti». Nessuna transitività applicata su coppie mancanti e nessun legame/errore narrativo inferito.
- Pannello con tre prove letterali, tre attori e tre verdetti già confermati; massimo **12** avvisi con conteggio totale e degli omessi. Rettifica e invalidazione delle fonti rimuovono immediatamente i pattern obsoleti.
- Analisi puramente locale ed effimera: nessun nuovo dato persistito, nessuna chiamata AI/HTTP, nessun intervento su canone, segreti, memoria, freeze o activity, nessuna autorizzazione automatica per gli agenti. Citazioni private visibili solo nel pannello; le decisioni preesistenti possono essere incluse in backup/push manuali.
- Test Vitest di triangoli completi, assenza di inferenze da due coppie, rettifica e stale; Playwright desktop/mobile per conferme, rendering e reload. [ADR 0051](../ADR/0051-knowledge-topic-triangle-advisories.md), [guida](knowledge-topic-triangle-advisories.md).

**Limite:** una possibile incoerenza fra interpretazioni dell'autore non dimostra una contraddizione narrativa né la verità, la cronologia o il trasferimento della notizia.

## 0.11.17 — 2026-11-08 (PR #63)

**Relazioni a coppie fra informazioni di personaggi distinti — solo su conferma autore**

- Nuovo `BookProject.narrativeKnowledgeTopicDecisions?` (append-only max **120**): due ID **distinti e canonici** di `NarrativeKnowledgeDecision` correnti, riferiti a personaggi con nome letterale differente, `verdict=same_information|different_information`, motivazione privata 20–650 e timestamp. È una interpretazione **esplicita dell'autore**, non una prova automatica di identità, verità o passaggio della notizia.
- `buildNarrativeKnowledgeTopicRegistry`: last-wins su coppia **non ordinata** di ID, audit delle rettifiche, invalidazione completa dopo modifica/riapertura/riattestazione/cambio conoscenza di una fonte, senza resurrezione di vecchie scelte. **No transitive closure**: A/B e B/C non implicano A/C. Nessun collegamento inferito da parole simili.
- UI **Collegare informazioni fra personaggi**: selezione di due fonti `knowledge_mention affirmed` ancora congelate, due citazioni visibili, due scelte, motivazione e conferma. Vista delle coppie correnti con tempi privati eventualmente già annotati a fianco, ma **l'ordine dei capitoli non è cronologia della storia**. Storico consultabile anche con fonti stale.
- Scrittura locale con Web Locks writer/outbox, CAS revisionale, blocco autopilot/redazione attiva, transazione atomica `books+activities+outbox`, autosync OFF e coda GitHub eliminata; log attività **senza attori, citazioni, temi, motivazioni private o segreti**.
- ZIP `content/full` schema strict per ID, coppia canonica, verdict, data, motivazione e max120, legacy compatibile; fonti importate rivalidate, senza autenticazione dell'autore. Backup e push GitHub manuale possono divulgare spoiler.
- Privacy: **nuovi collegamenti NON trasmessi ai 12 revisori, al giudice, writer o repair** nemmeno se esiste consenso v0.11.15 per quote e classificazione della singola conoscenza. Nessuna nuova chiamata AI/HTTP, canone, memoria, segreti o timeline modificati; nessuna deduzione sulla trasmissione. Test Vitest dominio/application/privacy, ZIP chiaro/cifrato/manomesso, Playwright desktop/mobile su due fonti, rettifica e invalidazione. [ADR 0050](../ADR/0050-author-pairwise-knowledge-subject-links.md), [guida](knowledge-topic-links.md), issue #20.

**Limiti:** la somiglianza semantica non viene certificata, i legami sono solo a coppie di nomi letterali distinti; il confronto dei tempi rappresenta una vista delle interpretazioni dell'autore, non una timeline causale verificata.


## 0.11.16 — 2026-11-08 (PR #62)

**Quando un personaggio sa: momento della conoscenza e ordine narrativo separati**

- Nuovo registro opzionale `narrativeKnowledgeTimingDecisions?` append-only (max **200**) per l'**ID esatto di una interpretazione `knowledge` già corrente** su menzione confermata e scena congelata. `accessMoment=acquired_in_scene|known_before_scene|not_yet_known|uncertain`, `narrativeOrder=chronological|flashback_or_reordered|undetermined`, motivo privato 20–650, data. `still_secret` non può dichiarare acquisizione nella/prima della scena; gli altri verdetti non possono dichiarare `not_yet_known`.
- `buildNarrativeKnowledgeTimingRegistry`: ultime decisioni per ID, rettifiche archiviate, fonti cambiate/riaperte/riattestate invalidate. Vista per personaggio **ordinata per capitolo/scena/offset del manoscritto**, NON per tempo della storia e NON per equivalenza semantica fra notizie o personaggi.
- UI **Quando i personaggi sanno?** con fonte verificata, doppia selezione momento/ordine, motivazione, conferma esplicita, registro per personaggio, storico e indicazione dei dati obsoleti. Nessuna conclusione causale o modifica al canone.
- Salvataggio locale protetto: Web Locks writer/outbox, CAS `updatedAt`, niente aggiornamenti durante autopilot/ciclo attivo, transazione atomica books+activities+outbox, autosync OFF e coda eliminata. Log attività senza motivazioni, spoiler, nomi o contenuto riservato.
- Backup ZIP `content/full` con schema **strict** e compatibile con archivi precedenti; i riferimenti temporali importati vengono rivalidati rispetto alle fonti e **non autenticano l'autore**.
- Privacy: **tutti i nuovi campi temporali sono esclusi dai prompt AI**, anche dove esiste un opt-in knowledge v0.11.15. Il consenso a una classificazione non vale automaticamente per la cronologia. Nessuna nuova chiamata AI, nessuna annotazione convertita in fatto, inventario, timeline o segreto canonico. Test Vitest di dominio, application, privacy e ZIP; Playwright desktop/mobile su scelta/reload e fonte invalidata. ADR 0049, [guida](knowledge-timing-registry.md), issue #20.

**Limiti:** il sistema non interpreta automaticamente flashback o informazione trasmessa fra personaggi; `chronological` è una classificazione dell'autore, non un fatto verificato. Il registro visualizza **ordine di esposizione del testo**, non ordine degli avvenimenti. Backup e push GitHub manuali possono contenere note private.


## 0.11.15 — 2026-11-07 (PR #61)

**Consenso esplicito per singola conoscenza e destinatario AI**

- Nuovo `narrativeKnowledgeShareDecisions?` append-only (max240): permesso `allowed|revoked` sull'**ID esatto di una decisione knowledge ancora corrente**, destinatari `continuity|timeline|secrets|characterVoice|judge` esplicitamente selezionati, motivazione privata 12–500 e data. Niente concessioni generali, implicite, a lettori ciechi, agli altri specialisti o ai writer. Nessuna casella preselezionata.
- Nuovo `buildSharedKnowledgePack` locale e fail-closed: max **4 citazioni** da capitoli strettamente precedenti congelati, nomi letterali presenti nel segmento e permessi validi per ruolo. Solo **quote, attore, posizione, offset e classificazione** dell'autore, mai le motivazioni private, le note o `memory.secrets`. Le classificazioni sono interpretazioni fallibili, non fonti di verità o istruzioni.
- Le quattro chiamate di revisori autorizzabili ricevono il pack esclusivamente per il loro ruolo, il **giudice solo per finding di conoscenza letteralmente ancorati**. I 5 lettori ciechi, gli altri 3 specialisti e i modelli di scrittura restano senza il nuovo pacchetto. Nessuna chiamata AI extra, ma possibili token aggiuntivi nei prompt autorizzati.
- Revoca, rettifica della conoscenza, riattestazione o riapertura della fonte invalidano i permessi futuri senza cancellare lo storico. La revoca NON elimina dati già trasmessi ai provider AI. UI con selezione ruolo, motivazione, conferma forte, audit e revoca.
- Persistenza con Web Locks writer/outbox, CAS revisionale, transazione atomica libro+attività+outbox, autosync disabilitato e coda eliminata. Log attività **senza nomi, ruoli, citazioni o rationale**.
- ZIP `content/full`: schema strict su destinatari, duplicati, stati, motivi e max240; importazione **revoca ogni permesso attivo prima di usare la copia**, conservando l'audit quando possibile (altrimenti elimina il registro di autorizzazioni importato in modo fail-closed). I push GitHub manuali possono ancora esportare note private: avviso esplicito.
- Vitest su scoping 12 ruoli+giudice, privacy, default deny, fonte precedente, status/staleness, revoche, CAS e ZIP; Playwright desktop/mobile sul consenso e sua revoca senza chiamate AI/GitHub. [ADR 0048](../ADR/0048-per-knowledge-editorial-recipient-consent.md), [guida](knowledge-sharing-consent.md), issue #20.

**Limiti:** nessuna identità/verità certificata, nessun grafo del sapere completo, nessun nuovo dato promosso a canone o modifica autonoma di memoria e segreti. Il nome e la citazione pubblica possono comunque rivelare spoiler all'AI **se** l'autore autorizza un destinatario. La revoca riguarda solo gli invii futuri.


## 0.11.14 — 2026-11-07 (PR #60)

**Registro privato e motivato delle conoscenze dell'autore**

- Nuovo `narrativeKnowledgeDecisions?` nel `BookProject`, **max 160 decisioni append-only**, con fonte `sourceEventDecisionId`, attore ancorato, verdetto `learned_directly|reported_by_other|still_secret`, motivazione (12–500) e timestamp. Sono interpretazioni dell'autore, NON verità semantiche, fatti certificati o memoria canonica.
- Scelte possibili solo da **attestazioni `knowledge_mention` `affirmed` correnti**: scena canonica congelata, quote/offset, timestamp freeze e checksum attuali. L'ultima decisione per fonte prevale; successiva riapertura, modifica, rigelo o nuova attestazione invalida la vecchia senza cancellare la cronologia. Nessun alias o trasferimento transitivo inferito.
- Scrittura locale protetta con Web Locks writer+outbox, CAS revisionale, blocco durante autopilot/redazione, transazione atomica libro+attività+outbox. **Autosync disabilitato e outbox svuotato**; log senza rationale/spoiler privati. Nessuna chiamata AI o push automatico.
- UI nel pannello eventi: scelta fonte attuale, tre classificazioni e motivazione, conferma esplicita, elenco corrente e storico rettifiche/stale. ZIP `content/full` validato con schema **strict** per ogni nuova decisione, max160, enum, date e limiti; legacy leggibile, import non autentica l'autore. Test dominio, application, ZIP chiaro/cifrato/manomesso e Playwright desktop/mobile.
- **Privacy:** le nuove interpretazioni NON entrano nei prompt dei dodici revisori, del giudice o di altri modelli. Nessuna modifica automatica a canone, `memory.secrets`, inventario, timeline e prosa. La sincronizzazione GitHub *manuale* o l'export ZIP possono comunque divulgare note: l'interfaccia avvisa esplicitamente.
- ADR 0047, [guida](author-knowledge-registry.md), issue #20, package/lockfile 0.11.14.

**Limiti:** solo eventi di conoscenza riconosciuti dall'indice locale e attestati, non un grafo completo di personaggi e segreti. Una voce narrata non garantisce informazione vera; un campo `still_secret` non aggiorna il canone. I consumatori AI richiederanno un consenso e una policy futura.


## 0.11.13 — 2026-11-07 (PR #59)

**Piste locali di trasmissione di informazioni tra personaggi**

- Nuovo `buildInformationTransferTrace` locale e bounded: fino a **4 menzioni letterali** di comunicazioni fra due nomi da capitoli precedenti congelati e scene canoniche; massimo 240 scene scansionate, 6k caratteri per scena e 10k per query. Frase originale/offset, mittente/destinatario, tema condiviso, fonte, freeze e timbro testo, contatori di candidati/scene omessi. Riconoscimento lessicale italiano, non comprensione semantica.
- I quattro specialisti `continuity,timeline,secrets,characterVoice` vedono i nuovi estratti nelle chiamate esistenti; i cinque lettori ciechi e gli altri tre specialisti **non** li ricevono. Il giudice riceve il pack solo per finding `knowledge` con ancora corrente, non per rilievi generici. Una comunicazione citata NON significa notizia appresa o vera.
- Per conflitti di `knowledge` con piste pertinenti, `informationTransferReview` **strict** aggiunge un giudizio motivato per ogni ID testimone effettivamente presente (`possible_path|unrelated|unreliable_report|unknown`). Nessun ID inventato, duplicato o obsoleto. `possible_path` e `unknown` **impediscono di approvare** una remediation fondata su accesso impossibile; il giudice può respingere. Restano tutti i requisiti `narrativeReview` e `knowledgeReview` della v0.11.12.
- Validazione al giudizio, in `repairPrompt` e nella callback sul libro fresco prima del salvataggio di prosa AI. Dashboard con riquadro `Esame dei possibili passaggi informativi`; ZIP strict per il nuovo campo nei giudizi e storici, legacy ancora leggibili.
- Test Vitest per citazioni/offset, privato e futuro esclusi, termini/nomi, limiti, 12 ruoli, rifiuti e gate; ZIP ostili/round-trip; Playwright desktop/mobile con comunicazione precedente, giudice critico e freeze senza riscrittura. ADR 0046, [guida](information-transfer-traces.md), issue #20.

**Limiti:** indizi lessicali, copertura parziale, possibile dialogo inattendibile. Non si certifica un evento né si crea un grafo canonico. Nessuna nuova chiamata AI/HTTP, modifica canon/memoria/segreti/possessi/timeline o nuovo stato top-level; più token nelle richieste esistenti sono possibili.


## 0.11.12 — 2026-11-07 (PR #58)

**Giudizio epistemico sul sapere dei personaggi**

- `knowledgeReview` strict aggiuntivo e obbligatorio per decisioni del giudice relative a `narrativeConflict.dimension=knowledge` (eventi attestati) o `priorSceneConflict.dimension=knowledge` (scene precedenti non attestate). Valuta **modalità narrativa della fonte precedente e corrente**, **percorso di accesso alla notizia**, **fondatezza del conflitto** e ragioni indipendenti.
- Il giudice può respingere falsi conflitti sulla conoscenza con spiegazione: dialoghi, dicerie, sogni, narrazione incerta e apprendimento fuori scena sono compatibili con il testo. In questi casi il software non autorizza remediation. `accept` di conflitti knowledge richiede, oltre al `narrativeReview` preesistente con stesso soggetto, assenza di spiegazione artistica e conflitto ritenuto supportato, **entrambe le fonti classificate narrazione diretta, percorso di accesso esplicitamente escluso e valutazione epistemica supported_knowledge_conflict**.
- Per conflitti di altra dimensione `knowledgeReview` è vietato; legacy ancora leggibili, ma un vecchio conflitto di conoscenza senza valutazione nuova non può ottenere nuove riscritture dopo resume/import.
- Il gate si ripete nel `repairPrompt` e alla callback sul libro fresco prima di salvare testo AI, come da v0.11.11. Dashboard con riquadro autonomo **Valutazione percorso delle conoscenze**. ZIP valida rigorosamente il nuovo campo in `editorialCycle`, `editorialRounds` e `priorRounds`.
- Test Vitest su entrambi i tipi di fonte, ragioni brevi/campi extra, narrazione diretta/dialoghi/sogni/accesso fuori scena, gating e staleness; ZIP round-trip e payload malevoli; Playwright desktop/mobile su ciclo 12 agenti, giudice che respinge e prosa invariata. ADR 0045, [guida](knowledge-provenance-review.md), issue #20.

**Limiti:** la modalità di una frase resta un'interpretazione del modello, non una classificazione semantica certificata. Nessuna nuova chiamata AI, accesso supplementare ai cinque lettori ciechi, modifica automatica del canone o grafo persistente delle conoscenze. Le istruzioni aggiuntive possono usare più token delle chiamate già previste.


## 0.11.11 — 2026-11-07 (PR #57)

**Confronto critico su scene precedenti congelate senza attestazioni autore**

- Nuovo `buildUnattestedSceneContext` locale e deterministico: massimo 3 finestre letterali di prosa **canoniche e congelate, da capitoli precedenti**, derivate dal ranking già bounded (massimo 1.600 candidati esaminati, quattro selezionati internamente). Offset, timestamp di freeze, impronta locale non crittografica, indicatori lessicali e conteggi dei limiti; nessun segreto, canone privato, fonte futura, AI o rete nel pack.
- Solo i quattro specialisti `continuity/timeline/secrets/characterVoice` possono marcare `priorSceneConflict` con scena capitolo, quote/offset/timbro e ipotesi. Citazione verificata nella **finestra realmente fornita al revisore**, oltre alla `finding.evidence` del segmento corrente. Non si può combinare con `narrativeConflict` da evento attestato. Ruoli non autorizzati e fonti obsoleti rifiutati.
- Il giudice indipendente fornisce lo stesso `narrativeReview` su identità, cronologia, causalità e contesto artistico. Può respingere motivatamente un conflitto fallace; `accept` richiede fonte corrente, valutazione supportata, identità comune ritenuta tale, nessuna spiegazione artistica plausibile e incompatibilità cronologica o causale. Il giudizio è **fallibile**, non verità narrativa.
- Validazione ripetuta nel `repairPrompt` **e nella callback di salvataggio della prosa AI su libro fresco**, proteggendo da sorgenti mutate durante la chiamata, pause e ZIP import. `validateReport` e `validateJudgment` usano il libro attuale della transazione. ZIP con schema rigoroso per la nuova marcatura annidata in cicli e storici, legacy compatibile.
- Dashboard con citazione precedente e offset e motivazioni del giudice; test Vitest su fonti false, freeze, modifiche, ruoli, alias, limiti, fallback, privacy, rigetto, repair, ZIP ostili; Playwright desktop/mobile su 12 agenti, nessuna attestazione, giudice che respinge senza correzioni.
- Nessuna chiamata AI extra, nuova migrazione, mutazione autonoma del canone, memoria, segreti, inventari o timeline; nuovi pack possono aumentare i token delle richieste esistenti. ADR 0044, [guida](unattested-scene-review.md), issue #20.

**Limiti:** ranking lessicale NON semantico e a copertura parziale; citazioni dalla prosa NON attestano l'avvenimento, l'identità o la causalità. I finding ordinari fuori da questa marca seguono ancora il controllo editoriale esistente.


## 0.11.10 — 2026-11-07 (PR #56)

**Giudizio narrativo strutturato e gating prudente delle remediation**

- Gli specialisti `continuity`, `timeline`, `secrets`, `characterVoice` possono marcare `narrativeConflict` solo se citano un `priorEventDecisionId` **già presente fra i testimoni precedenti realmente forniti nel loro prompt**. L'ID viene rivalidato al salvataggio; `finding.evidence` resta prova letterale **solo del segmento corrente**.
- Il giudice indipendente deve fornire `narrativeReview` per ogni conflitto marcato, con valutazioni/motivazioni separate su **identità**, **cronologia**, **causalità**, **contesto artistico** e una conclusione. Un giudizio strutturato è rifiutato per finding senza marca; i legacy rimangono compatibili.
- Per `accept`, il gate richiede fonte ancora corrente, stesso soggetto ritenuto tale dal giudice, nessuna spiegazione artistica plausibile, conflitto ritenuto supportato e almeno un'incompatibilità di cronologia o causalità. I falsi positivi possono essere **respinti motivatamente**, senza riscrivere. Prima di ogni `chapterRepair` il gate viene ripetuto, anche dopo resume o import ZIP.
- Dashboard con ipotesi marcate dello specialista, ID testimone e quadro narrativo critico leggibile; backup ZIP contenuto/completo con validazione rigorosa dei due nuovi metadati nei rapporti e nelle decisioni, senza invalidare gli altri campi legacy.
- Test Vitest su fonti, limiti, schema/decisioni, falsi positivi, contesto artistico, resume/import e ZIP ostili; Playwright desktop/mobile su flusso con 12 agenti, giudice che respinge con quattro dimensioni, scena invariata.
- Nessuna nuova chiamata AI, stato canonico, migrazione obbligatoria, accesso ai segreti dei cinque lettori ciechi o promozione automatica di identità. [Guida](structured-narrative-adjudication.md), ADR 0043, issue #20.

**Limite:** il giudice rimane fallibile e le condizioni strutturate non certificano verità semantica. Il nuovo controllo riguarda solo le ipotesi con testimone precedente attestato; i prompt più lunghi possono usare più token nelle chiamate esistenti.


## 0.11.9 — 2026-11-07 (PR #55)

**Prove precedenti dell'autore nella review contestuale con giudice critico**

- Le chiamate esistenti ai quattro specialisti di **continuità**, **timeline**, **segreti** e **voce dei personaggi** ricevono ora, quando pertinenti, fino a **8 testimoni precedenti** validati localmente dalle decisioni evento `affirmed`, anche senza modifiche retroattive. I testimoni includono citazioni letterali, offset, capitolo/scena, ID dell'attestazione, conteggio fonti pertinenti/omesse e provenienza `literal_name|saved_alias`.
- La selezione è basata su nomi **interi**, non sottostringhe, e soltanto su capitoli precedenti congelati; un alias diretto è usato solo se registrato come `linked` con **entrambe le attestazioni fonte precedenti**. Nessun alias temporaneo o transitivo, nessuna fonte futura/non canonica/stale.
- Il giudice riceve i testimoni solo quando i findings hanno **ancora narrativa corrente**; le istruzioni rendono espliciti i controlli critici su identità, flashback, cronologia, dialoghi e POV. Può respingere una remediation non giustificata, sempre motivandola. `finding.evidence` rimane citazione del **solo segmento corrente** e il gate non è allentato.
- I **cinque lettori ciechi** e gli altri specialisti non ricevono questo pack. Nessun segreto, motivazione dell'autore, dossier privato o dati futuri viene copiato nel nuovo pacchetto. Nessuna chiamata AI aggiuntiva, persistenza, migrazione ZIP, auto-remediation o aggiornamento a memoria, oggetti, segreti o timeline.
- Test Vitest su prove valide, invalidazioni, privacy, copertura e alias; test di integrazione prompt giudice indipendente; Playwright desktop/mobile su 12 chiamate isolate e rilievo respinto con freeze. ADR 0042, `docs/attested-contextual-review.md`, issue #20.

**Limite:** recupero lessicale/strutturato non semantico; fino a 8 fonti può aumentare i token della review già prevista. La presenza di una frase o attestazione non dimostra un'incoerenza.


## 0.11.8 — 2026-11-07 (PR #54)

**Registro locale persistente delle ipotesi alias motivate**

- Nuovo storico append-only `BookProject.narrativeAliasDecisions` (max 120): scelta esplicita e motivazione dell'autore (12–500 caratteri) su due nomi, conferma o esclusione del legame, ancorate agli ID di **due attestazioni evento correnti**.
- Revalidazione a ogni consultazione: la decisione più recente sulla coppia prevale senza riattivare quelle vecchie; freeze cambiati, scene mutate, rettifiche/rifiuti delle attestazioni rendono gli alias **storici**, mai fatti canonici.
- Scrittura atomica con Web Locks, CAS, attività e svuotamento outbox, autosync disabilitato. ZIP import/export compatibile con backup precedenti, nuovi campi strict per evitare payload ostili e nessuna modifica delle credenziali remote dopo import.
- Nei segnali di continuità vengono aggiunte le coppie motivate ancora correnti (`identityBasis=saved_alias`) **dopo** i segnali letterali, **prima** delle anteprime temporanee; limite 40 e omissioni contate. Senza inferenze transitive, deduzioni di identità o modifiche a canone, memoria, segreti, possessi e timeline.
- Vitest su rettifiche, staleness, backup manomessi, concorrenza, outbox e confronti; Playwright desktop/mobile su conferma, reload, revoca e isolamento rete. ADR 0041, `docs/persisted-author-aliases.md` e issue #20.

**Limiti:** decisioni attribuite all'autore ma non autentiche dopo import; ancore locali non firmate, legami consultivi non certificati; nessuna espansione dei prompt dei dodici agenti.


## 0.11.7 — 2026-11-07 (PR #53)

**Anteprima temporanea e consensuale degli alias nei segnali di continuità**

- Da «Tracce di continuità da verificare» l'autore può scegliere **due nomi distinti con attestazioni correnti**, confermare una singola ipotesi alias e visualizzare confronti **aggiuntivi** tra nomi diversi. Nessun riconoscimento automatico, transitorio o fuzzy.
- I segnali di nome letterale restano invariati e non vengono cancellati dal confronto. Le nuove piste riportano **entrambi i nomi**, citazioni, offset, capitoli e motivazioni con etichetta `alias_preview`; i nomi non diventano una singola entità canonica.
- La scelta vive **soltanto nello stato React della scheda** ed è associata all'ID del libro: azzeramento esplicito o reload la rimuovono. Nessuna modifica a IndexedDB/ZIP/GitHub snapshot, credenziali, canone, segreti, possessi, timeline o prompt dei dodici revisori.
- Confronto locale, massimo 40 segnali complessivi e omissioni dichiarate. Test Vitest su coppie inesistenti, rettifiche, staleness, additività, risurrezione/date e Playwright desktop/mobile su conferma, azzeramento e mancata persistenza. [Guida](explicit-alias-preview.md), ADR 0040, issue #20.

**Limite:** l'anteprima non è un'associazione identitaria verificata né una decisione persistente dell'autore. Nessuna deduzione semantica o correzione automatica.


## 0.11.6 — 2026-11-07 (PR #52)

**Tracce di continuità da attestazioni autore, senza inferenze automatiche**

- Confronti deterministici e soltanto consultivi fra attestazioni `affirmed` ancora valide in capitoli diversi: possibile azione successiva a morte, seconda menzione di morte senza una «risorge» attestata intermedia e date di scena ISO `YYYY-MM-DD` in ordine inverso rispetto ai capitoli.
- Ogni segnale contiene **entrambe le citazioni letterali**, offset, capitoli, scene e ragioni dell'autore; mostra spiegazioni alternative (flashback, omonimie, soprannaturale) e avverte che l'ordine dei capitoli non equivale alla cronologia degli eventi.
- Max 40 segnali mostrati, conteggio delle omissioni; decisioni stale, respinte e rettificate escluse. Nessuna nuova persistenza, migrazione, rete o AI e nessuna modifica automatica a segreti, oggetti, timeline, prosa, canon o prompt dei lettori.
- Test unitari su date invalide, rettifiche, risurrezione, staleness, isolamento e limiti; Playwright desktop/mobile con doppia attestazione e verifica del canone immutato. ADR 0039, `docs/attested-continuity-signals.md` e issue #20.

**Limite:** segnali testuali euristici, mai contraddizioni certificate; il controllo dell'autore e il giudice critico restano fondamentali.


## 0.11.5 — 2026-11-07 (PR #51)

**Registro locale delle attestazioni narrative e navigazione completa dell'indice**

- L'indice delle menzioni già rilevate è paginato, 30 alla volta: l'autore può raggiungere anche le posizioni 31–80. Nessun ampliamento dello scanner o nuovi eventi impliciti.
- Vista derivata delle sole attestazioni autore **ancora valide**, con citazione, offset, motivazione e posizione capitolo/scena. Rettifiche e decisioni obsolete restano nello storico e sono contate separatamente. La vista non dipende dal cap di 80 menzioni.
- Raggruppamento esplorativo per soggetto letteralmente uguale in più capitoli, per confronto manuale: **non** è una rilevazione semantica di contraddizioni e non riconosce alias/omonimie.
- Nessuna nuova persistenza, rete, chiamata AI, esposizione ai lettori ciechi o modifica di canone/segreti/timeline/possessi. Test unitari e browser desktop/mobile su staleness, rettifiche, limite di indice e navigazione. ADR 0038, guida `docs/narrative-event-ledger.md`, issue #20.

**Limiti:** l'attestazione è una dichiarazione non autenticata; checksum non crittografico, euristiche incomplete e nessuna prova storica o causale.


## 0.11.4 — 2026-11-07 (PR #50)

**Annotazioni motivate dell'autore su singole menzioni di eventi**

- Dal pannello redazione l'autore può registrare `affirmed`/`dismissed` per una menzione letterale congelata con motivazione, conferma esplicita, citazione/offset e storico append-only (massimo 400 record). Una decisione non è una modifica automatica al canone né una prova semantica.
- Riaperture, nuovo `frozenAt`, citazione cambiata o modifica della scena rendono la decisione **non corrente** senza cancellare lo storico; il checksum rapido è solo un indicatore di freschezza non crittografico.
- Web Locks, CAS `updatedAt`, attività e commit IndexedDB atomico; autosync spento e outbox svuotata per richiedere nuova scelta manuale sulla pubblicazione. Nessuna nuova chiamata HTTP/AI e nessuna esposizione ai 5 lettori ciechi.
- Snapshot del libro e ZIP preservano lo storico, con schema stretto e limiti anti-payload ostile; un ZIP importato non autentica la decisione. Guida `docs/narrative-event-decisions.md`, ADR 0037 e issue #20.
- CI PR #50 verde: TypeScript, 287 test Vitest, smoke npm, build e 36 test Playwright Chromium desktop/mobile superati.

**Limite:** nessun aggiornamento automatico a timeline, canone, segreti, oggetti o prompt editoriali; occorrono policy future per la promozione di eventi in memoria causale.

Ogni rilascio su `main` deve avere una voce verificabile. Le PR descrivono il comportamento rilasciato; le issue raccolgono lavoro incompleto e criteri di accettazione.

## 0.11.3 — 2026-11-07 (PR #49)

**Indice locale consultivo delle menzioni di eventi narrativi**

- `narrative-event-candidates.ts` costruisce **sul dispositivo** un indice effimero di menzioni letterali in scene **canoniche e congelate**: conoscenze dichiarate («scopre che»), consegne di oggetti («consegna a») e cambiamenti di stato («scompare», «parte», ecc.), con capitolo/scena, soggetto, eventuale destinatario, data dichiarata, citazione letterale e **offset verificabile**.
- Ogni elemento resta `unverified_literal_pattern`: può riferirsi a dialoghi, sogni o menzogne. **Non** modifica il canone, segreti, timeline, conoscenze o possessi e non certifica fatti/contraddizioni. Dopo una riapertura, il capitolo non congelato **esce** automaticamente dall'indice.
- Nuovo riquadro espandibile «Indice eventi candidati» nel pannello redazione, con quote e provenance consultabili; massimo 30 visualizzati. I campioni cross-chapter possono includere fino a quattro menzioni per scena per **solo** gli specialisti autorizzati e il direttore. I cinque lettori ciechi non ricevono questo contesto aggiuntivo; il gate del finding resta il segmento corrente.
- Limiti dichiarati: primi **20.000 caratteri per scena**, 4 menzioni per scena, 1.600 scene e 80 voci per libro; niente rete, nuovi modelli o richieste AI. Test Vitest e Playwright desktop/mobile su citazioni, privacy, stato congelato, dialoghi, negazioni e limiti. ADR 0036, [guida](narrative-event-candidates.md), issue #20.

**Limite esplicito:** schemi lessicali italiani ristretti, NON comprensione semantica di ciò che personaggi sanno o possiedono. Servirà una futura conferma autore per promuovere una menzione a fatto del canone.

## 0.11.2 — 2026-11-06 (PR #48)

**Recupero locale mirato delle scene per la rivalidazione cross-chapter**

- Recupero **deterministico e locale** `local_structured_lexical_v1`: il ranking confronta entità dichiarate, termini lessicali e date esplicite della scena da rivedere con le scene già congelate a monte. Conserva un ancoraggio al capitolo origine e all'ultimo predecessore, e usa gli slot rimanenti per scene pertinenti **anche in capitoli intermedi**. Massimo quattro scene e due per capitolo; non si effettuano nuove chiamate AI/HTTP.
- Per le scene lunghe le finestre letterali con offset vengono spostate verso i **termini corrispondenti**, inclusi quelli a metà scena; il resto del testo rimane dichiaratamente non visionato. Ogni scena riporta `matchSignals` e `selectionReason`, senza presentarli come prova di contraddizione.
- Contatori di candidati, scansionati, non scansionati e omessi nel prompt; massimo **1.600 scene** scansionate, per scena 16.000 caratteri distribuiti fra inizio, centro e fine per ranking. Gli autori vedono nell'audit del freeze ID e conteggi campionati; vecchi report/ZIP restano leggibili e lo schema importato convalida i nuovi contatori in modalità strict.
- I quattro specialisti autorizzati e il giudice ricevono i campioni; lo storico solo con `historical_evidence` come in v0.11.1, i cinque lettori ciechi restano isolati. `finding.evidence` resta una citazione letterale del **segmento corrente**.
- Vitest su scena pertinente intermedia, finestre nel mezzo e offset, limiti, privacy, precedenza di origine/ultimo predecessore e audit; Playwright desktop/mobile sull'avviso di rivalidazione; ADR 0035, [guida](targeted-continuity-retrieval.md), issue #20.

**Limiti:** matching lessicale/strutturato ≠ comprensione semantica né rilevamento certo delle contraddizioni. Fatti impliciti, sinonimi, scene oltre il cap e passi non campionati possono sfuggire. Gli agenti devono continuare a ragionare in modo critico; l'audit non certifica la completezza.

## 0.11.1 — 2026-11-06 (PR #47)

**I dossier storici entrano nella catena di rivalidazione dei capitoli successivi**

- Tutti i **dodici** use-case storici con rewind di un capitolo congelato (Wikipedia, Crossref, LoC, OCR, collazioni, IIIF, Wikisource, trascrizioni manuali, relazioni di provenienza e quarantene) marcano ora i capitoli già scritti di valle con il trigger strutturato `historical_evidence`. L'origine più antica ancora pendente resta prioritaria e l'audit precedente viene invalidato.
- **Distinzione esplicita fra aggiornamento delle fonti e riscrittura della prosa**: il marker contiene solo ID, capitolo e causa; la sola operazione sul dossier non modifica le scene. Resta il rewind conservativo delle sinossi, outbox e autosync.
- Oltre ai quattro specialisti di continuità, in questa sola circostanza anche lo specialista storico vede **campioni letterali delle scene pubbliche precedenti** e il direttore riceve un avviso che le scene del romanzo **non sono fonti documentali**. I cinque lettori ciechi non ricevono il nuovo contesto.
- La UI distingue `dossier storico modificato` da una correzione narrativa e continua a non presentare il nuovo freeze come certificazione storica o semantica.
- Backup ZIP con nuovo trigger vincolato all'enum, versioni precedenti compatibili; test unitari su catena, OCR/trascrizioni, isolamento ruoli e audit, smoke su tutte e dodici le integrazioni, e Playwright desktop/mobile per la provenienza connessa al rewind.
- ADR 0034, [guida](historical-continuity-rechecks.md), issue #20 e #23; nessuna nuova ricerca automatica o nuova chiamata AI.

**Limiti:** l'aggiornamento di una fonte non dimostra contraddizioni storiche, i campioni non coprono ogni scena e non certificano l'indipendenza delle fonti. I prompt dei revisori possono essere più lunghi. I controlli si applicano ai dodici percorsi esistenti, non a modifiche future non ancora integrate.

## 0.11.0 — 2026-11-06 (PR #46)

**Catena di rivalidazione della continuità dopo modifiche retroattive**

- Riapertura manuale e revisioni retroattive marcano i capitoli successivi già scritti con origine, data, causa e ID delle scene toccate, senza copiare trama o segreti. La modifica più antica ha precedenza; il marker sopravvive ai checkpoint e ai riavvii.
- La redazione procede in ordine cronologico: non si può revisionare e **congelare** un capitolo successivo se un capitolo precedente non è ancora scritto, canonico e congelato. L'autopilot sceglie il primo pronto, prevenendo votazioni su premesse instabili.
- I quattro specialisti di continuità, timeline, segreti e voce ricevono campioni di **scene pubbliche precedenti** dell'origine e dell'ultimo predecessore, con ID, data, riferimenti dichiarati, finestre di testo **letterali con offset** e marcatura `complete|partial`/numero di scene omesse. Il giudice riceve lo stesso contesto e può respingere falsi rilievi. I cinque lettori ciechi non ricevono nuove memorie o segreti.
- Dopo il nuovo freeze, un audit locale registra origine, data e scene campionate; la UI mostra l'obbligo pendente e lo storico, senza chiamare il risultato una verifica semantica certificata.
- Test Vitest su catene multiple, fonti assenti, finestre parziali, ruoli separati, cronologia e audit; test IndexedDB/outbox/Web Locks e Playwright desktop/mobile per riapertura e segnali UI. ADR 0033, [guida](cross-chapter-continuity.md), issue #20.

**Limiti:** il campione è bounded (max 2 scene per origine e ultimo predecessore, max 4 in totale, scene lunghe solo in finestre) e **non esaurisce tutte le possibili contraddizioni**. Una citazione letterale non dimostra un conflitto; il giudice mantiene l'ultima valutazione. I prompt possono essere più lunghi e costosi, pur senza nuove chiamate AI. Le altre vie di riapertura di dossier storici non sono ancora unificate con questo marker.

## 0.10.9 — 2026-11-06 (PR #45)

**Redazione più rigorosa: citazione narrativa letterale e remediation ancorate al segmento**

- Ogni nuovo finding dei dodici agenti richiede almeno 12 caratteri **letteralmente presenti nel segmento letto**; consentite solo differenze maiuscole/a capo/spazi. Il validatore rifiuta parafrasi, citazioni di altre scene, omissioni inventate e risultati basati su segmenti nel frattempo cambiati. Il report non viene archiviato finché non supera il gate.
- `NarrativeEvidenceAnchor` viene costruito **dal codice**: indice del segmento, posizione, citazione originale, numero di occorrenze e breve contesto. Non deriva da campi inventati dal modello. Il giudice riceve `anchorStatus` ricalcolato, distinto dalle opinioni del revisore.
- La **remediation accettata** è rifiutata deterministicamente dall'autopilot se la prova manca, è stata manomessa oppure è diventata obsoleta per modifica della scena. I vecchi rapporti rimangono leggibili e respingibili, non possono autorizzare nuove riscritture senza verifica; le decisioni archiviate non vengono eliminate.
- Interfaccia desktop/mobile: posizione, testo trovato, occorrenze, contesto e avviso esplicito per legacy, tampering o testo cambiato. La presenza di una citazione non è prova che il rilievo sia corretto né che una fonte storica sia vera.
- Test unitari su prove inventate, scene diverse, whitespace, ripetizioni, segmenti stale, accettazione bloccata e rifiuti leciti; Playwright desktop/mobile per etichette e compatibilità legacy. ADR 0032, [guida](editorial-narrative-evidence.md), issue #20.

**Limiti:** il gate è una verifica testuale, NON semantica; critica e proposta di correzione richiedono ancora giudizio indipendente. I rilievi di omissione vanno ancorati a testo esistente e possono richiedere intervento umano. I report precedenti non sono automaticamente promossi a fonti verificate.

## 0.10.8 — 2026-11-06 (PR #44)

**Rilasci npm più riproducibili: lockfile generato realmente e installazioni fail-closed**

- Generato `src/frontend/package-lock.json` **da npm 10 su Node 22, collegato al registro npm reale**, senza ricostruzione manuale. Due installazioni pulite consecutive da lock con `npm ci` verificate sul runner GitHub Actions. Il bootstrap temporaneo è stato rimosso prima del merge.
- CI e GitHub Pages usano `npm ci --no-audit --no-fund` invece di `npm install`. Se manifest e lockfile divergono l'installazione fallisce anziché risolvere automaticamente versioni diverse. Entrambi i workflow controllano anche che npm non abbia modificato il lock.
- Nuovi smoke test verificano root e versione, dipendenze dirette, versioni esatte di Tailwind/Vite, presenza di un vero albero npm, protocolli HTTPS e integrità sha degli archivi pubblici; controllano anche entrambi i workflow.
- ADR 0031, guida alla manutenzione del lockfile e aggiornamenti README/AGENTS/feature, issue #43. Nessuna modifica alla prosa, ai libri salvati, alle API di ricerca o al routing modelli.

**Limiti:** il lockfile riduce il drift delle versioni ma non rende immutabili ambiente runner, registry, piattaforme native o provider. Non sostituisce i test, non verifica automaticamente la sicurezza di tutti i pacchetti e non garantisce un sito raggiungibile prima di Pages verde.

## 0.10.7 — 2026-11-06 (PR #42)

**Ripristino CI e deploy Pages dopo risoluzione incoerente delle dipendenze Tailwind**

- Dopo il merge della v0.10.6, sia CI che build GitHub Pages si sono fermate su `npm install` con `ETARGET: No matching version found for @tailwindcss/oxide@4.3.5`. La CI della PR #41 era verde: il guasto è nella risoluzione senza lockfile di `@tailwindcss/vite` e `tailwindcss`, dichiarati con `^`.
- I due pacchetti sono fissati **esattamente alla versione pubblicata 4.3.4**, con smoke test che impedisce aggiornamenti divergenti del plugin Vite e del framework. Nessuna modifica ai dati o al comportamento del generatore di proposte.
- Il workflow `Cleanup merged branches` riconosce anche `fix/*`, senza allargare le altre condizioni: PR realmente unita, branch nella stessa repository, nessun'altra PR aperta e HEAD del branch identica a quella della PR integrata.
- ADR 0030, runbook e documentazione aggiornati. Verifica integrale TypeScript/Vitest/smoke/build/Playwright mobile+desktop su HEAD PR e verifica dopo il merge di CI main, deploy Pages e pulizia branch.

**Limiti:** senza un `package-lock.json` versionato il restante albero delle dipendenze può ancora cambiare. Non si presume che un `npm install` riuscito una volta garantisca la stessa risoluzione futura: la migrazione a lockfile con `npm ci` resta un intervento distinto.

## 0.10.6 — 2026-11-06 (PR #41)

**Proposte locali di ricerche storiche dai capitoli, con controllo umano prima della rete**

- Il dossier storico del capitolo propone fino a cinque **argomenti di ricerca** tramite una funzione TypeScript locale e deterministica. Riconosce solo un vocabolario pubblico e limitato (per esempio telegrafo, ferrovie, fotografia) e anni di quattro cifre presenti vicino al tema nelle scene; altrimenti propone `storia`. Non invia né copia passaggi, nomi propri, segreti, prompt o credenziali.
- Pulsante `Genera proposte locali` e schede responsive; ogni proposta deve essere **aggiunta manualmente alla bozza modificabile** e poi sottoposta al flusso già esistente `Cerca fonti pubbliche`, con ulteriore dialogo che mostra le query esatte. Generazione/anteprima/aggiunta non effettuano chiamate ai provider e non persistono il dossier.
- Massimo cinque suggerimenti deduplicati per tema, bounded a 16 scene e 24.000 caratteri/scene; nessuna inferenza LLM, nuova tariffa AI o traffico esterno. Limiti delle query pubbliche del dossier, fonti attive, rewind e consenso rete restano invariati.
- Test Vitest su estrazione, date fuori contesto, segreti, ripetizioni e limiti; Playwright desktop/mobile su anteprima senza rete, bozza, consenso annullato, invio delle sole query approvate e layout. ADR 0029, [guida](historical-query-proposals.md), issue #23.

**Limiti:** il vocabolario non copre tutta la storia e le proposte potrebbero non essere pertinenti. Il filtro riduce l'esposizione del manoscritto, ma **non può dimostrare** che un anno o un tema siano pubblici: l'autore deve verificare e approvare ogni query prima di inviarla. Non è un fact-check né una ricerca effettuata in background.

## 0.10.5 — 2026-11-06 (PR #40)

**Dipendenze documentali dichiarate dall'autore: impedire falsa indipendenza fra fonti**

- Nuovo pannello nel capitolo per associare due **snapshot esatti e attivi** di Wikipedia, Wikisource, trascrizioni LoC o OCR LoC, con attestazione `same_original`, `derived` oppure `unknown`, nota motivata (24–400 caratteri) e secondo dialogo di consenso. Nessuna richiesta a servizi esterni; non si asserisce verifica tecnica, autenticità o indipendenza storica.
- Registro append-only `sourceRelations` per capitolo, fino a 60 dichiarazioni, ordinamento deterministico della coppia, ID e timestamp, conserva le rettifiche. L'ultima dichiarazione valida per coppia prevale; `unknown` rettifica un sospetto ma non costituisce prova di indipendenza. Le relazioni restano nell'audit dopo aggiornamento delle revisioni, ma si applicano soltanto quando **entrambi gli ID esatti sono attivi**.
- Il validatore di citazioni rifiuta l'uso congiunto di fonti con originale comune o derivazione dichiarata, **anche se il legame è transitivo**; restano attivi i controlli per revisioni duplicate e citazioni letterali. Lo storico e il direttore ricevono le sole relazioni attive come dati non attendibili; gli altri 11 agenti non le vedono.
- Salvataggio local-first con doppio Web Lock (writer/outbox), CAS su `updatedAt`, attività di audit, autosync disabilitato, outbox pulita e rewind dei capitoli congelati e successivi. Conservazione dei legami attraverso i refresh dei vari dossier, archivi ZIP/IndexedDB e sincronizzazione GitHub opt-in.
- Test Vitest di dipendenze dirette/transitive, rettifiche, revisione obsoleta, dati importati malformati e isolamento, più Playwright mobile/desktop sul consenso e invalidazione freeze. ADR 0028 e [guida autore](historical-source-dependencies.md), issue #23.

**Limiti:** una dichiarazione dell'autore non verifica l'identità reale degli originali. L'assenza di un legame registrato non garantisce che due fonti siano indipendenti. Le fonti potrebbero riprodurre una medesima testimonianza senza indicarlo; il controllo è **conservativo e manuale**, non una verifica archivistica automatica.

## 0.10.4 — 2026-11-06 (PR #39)

**Contesto per ogni divergenza storica e seconda valutazione obbligatoria del direttore**

- I nuovi report `conflicting_excerpts` devono includere `conflictContext`: un record per ciascuna fonte con evento/oggetto, periodo, luogo, edizione e limitazioni. Ogni campo ignoto è `null`, non una supposizione inventata. `comparison.eventIdentity` e una motivazione registrano se l'agente pensa che i documenti descrivano lo stesso evento.
- Il validatore controlla cardinalità e identità esatta delle fonti, la presenza esplicita di campi mancanti, dimensioni e validità delle motivazioni. Se l'agente dichiara eventi `different`, non può segnalarli come contraddizione sullo stesso fatto. **Non certifica corrispondenza semantica, autenticità, diritti o indipendenza reale.**
- Per decidere ogni finding di tipo `conflicting_excerpts`, il direttore deve fornire `conflictReview` con valutazione indipendente dell'evento, cronologia, geografia, edizione e indipendenza, più conclusione. Non può accettare una remediation dichiarando contemporaneamente che gli eventi sono differenti; può respingere con motivazione.
- Il pannello editoriale espone la matrice di contesto e la valutazione del direttore anche da telefono; i report storici v0.10.3 senza nuovi campi restano leggibili con avviso di controllo incompleto. Nessuna nuova ricerca o invio del romanzo a servizi esterni; gli altri undici revisori restano ciechi. Test Vitest, smoke e Playwright desktop/mobile.
- ADR 0027, documentazione autore, issue #23.

**Limiti:** contesto e identità dell'evento sono ipotesi di modelli AI, non controllo documentale o verifica automatica dei fatti. I nuovi campi non inventano una fonte mancante e non autorizzano modifiche automatiche al canone.

## 0.10.3 — 2026-11-06 (PR #38)

**Redazione storica: proposte di divergenza fra fonti indipendenti, con verifica testuale e giudizio critico**

- Il revisore storico può usare `historical.assessment=conflicting_excerpts` per una **possibile** divergenza: deve indicare da due a tre fonti attive indipendenti, una citazione letterale distinta per ciascuna e `sourcePositions` con giudizio motivato `supports|disputes|unclear` per ogni fonte.
- Il validatore rifiuta ID di fonti non attive, revisioni dello stesso documento spacciate per indipendenti, citazioni assenti, posizioni incomplete/duplicate oppure senza almeno una `supports` e una `disputes`. I report precedenti rimangono leggibili senza migrazioni.
- Il direttore editoriale riceve citazioni, contesto delle fonti e posizioni come **interpretazioni non affidabili**, può respingere i falsi conflitti motivando e non modifica direttamente prosa o canone; il pannello mostra la posizione per fonte e l'avviso sulla mancata verifica semantica.
- Nessuna nuova chiamata a servizi esterni o ricerca automatica, nessun invio del romanzo a Wikipedia/LoC/Crossref. I dati storici restano visibili solo allo specialista e al giudice, non agli altri undici revisori. Test unitari per casi validi e attacchi, più CI Playwright desktop/mobile.
- ADR 0026 e [guida alle divergenze](historical-source-disagreements.md); lavoro incrementale dell'issue #23.

**Limiti:** la corrispondenza letterale di due estratti non prova che i documenti siano davvero in disaccordo, che descrivano lo stesso evento, siano storicamente attendibili o abbiano licenze valide. Le posizioni sono proposte del modello e non certificazioni. Il direttore conserva la responsabilità del giudizio e l'autore può intervenire.

## 0.10.2 — 2026-11-06 (PR #37)

**Library of Congress: collegamento puntuale ai metadati di risorse immagine IIIF, senza scaricare scansioni**

- Dopo una collazione `locscan:` attiva, nuova sezione **Riferimenti IIIF scansioni**: dialogo per cercare candidati dalla singola scheda LoC. Il browser legge solo `https://www.loc.gov/item/<itemId>/?fo=json`, selezionando fino a 30 `resources[].info` / `resources[].files[*].info` sotto `https://tile.loc.gov/image-services/iiif/{service|master}:.../info.json`. Niente miniature, anteprime, PDF, immagini o URL non consentiti.
- Scelta esplicita dell'autore della risorsa e due attestazioni separate (stessa pagina/folio già dichiarata e diritti sui metadati), più conferma con ID, pagina, URL e destinatari. Prima del salvataggio l'item JSON viene **riletto** e l'URL selezionato deve essere ancora presente/ammesso. Una sola GET verso il relativo `info.json` verifica identificativo del servizio e dimensioni dichiarate, senza scaricare né analizzare pixel.
- Restrizioni item/risorsa `access_restricted`, `download_restricted`, `rights_restricted` e flag non validi bloccano la richiesta. JSON item max 240 KB, IIIF max 96 KB, timeout 12s/GET, streaming limitato, no redirect, credenziali, cookie, referrer, proxy o ricerche private. Errori CORS/429/JSON/mismatch non producono modifiche parziali.
- Snapshot `lociiif:<itemId>:<timestamp>:<hash16>` con item, ID OCR `lococr:`, collazione `locscan:`, pagina, risorsa, indici, dimensioni e impronta **solo dei metadati tecnici**. Max 40 storici, disattivazione automatica su fonti obsolete, salvataggio Web Locks/CAS, rewind freeze/downstream, autosync off e outbox/activity atomica. Solo specialista storico e giudice ricevono i metadati; gli altri 11 revisori sono ciechi. `lociiif:` non può essere una fonte `historical.sourceIds`.
- Test Vitest provenienza, URL/diritti, identità/fail-closed, domain, concorrenza e Playwright desktop/mobile; ADR 0025 e `docs/loc-iiif-page-provenance.md`.

**Limiti:** `info.json` identifica tecnicamente un servizio e le dimensioni ma **non dimostra che l'immagine sia la stessa pagina dell'OCR**, né autentica scansione, fatto storico, titolo, licenza o copyright. L'associazione della pagina è dichiarata dall'autore; nessuna immagine è recuperata dal programma. I test mock non provano CORS o disponibilità reale in tutte le collezioni.

## 0.10.1 — 2026-11-06 (PR #36)

**Library of Congress: collazione assistita dall'autore della scansione rispetto all'OCR, senza falsa verifica visiva**

- Nuova azione **Confronta OCR con scansione** accanto a ogni `lococr:` attivo. La UI apre la **scheda canonica LoC** già registrata (non un'immagine inventata). L'autore deve leggere **personalmente** la scansione se presente, specificare pagina/folio (4–140 caratteri) e trascrivere dalla pagina una breve frase (36–900 caratteri). Due checkbox distinte per attestazione della consultazione visiva e base dei diritti/condivisione AI/GitHub/ZIP; il dialogo finale mostra **l'intera trascrizione** e le conseguenze del salvataggio.
- Nessun download o OCR di immagini e nessuna richiesta API: confronto **locale deterministico di due stringhe**, usando solo normalizzazione NFKC, minuscole e collasso spazi. `text_overlap` significa contenimento testuale, `text_discrepancy` significa che il testo dichiarato non compare nell'OCR: **non sono autenticazioni dell'originale storico o del copyright**.
- Snapshot append-only `locscan:<itemId>:<timestamp>:<sha16 OCR>` sotto `locOcr.collations`, massimo 40 record. Si conserva OCR esatto, hash, scheda/ispezione di origine, collocazione/pagina, testo osservato, data e attestazioni; i precedenti rimangono in audit. Se OCR/scheda/ispezione diventano obsoleti, le vecchie collazioni non sono fornite alle nuove review.
- Solo **revisore storico e giudice critico** ricevono collazioni come dati esterni non attendibili. Una discrepanza deve fare sorgere dubbi su una remediation basata sul solo OCR. Gli altri undici revisori restano ciechi; `locscan:` non può diventare un ID di fonte indipendente in `historical.sourceIds`. Nessun testo esterno viene aggiunto alla prosa.
- Persistenza IndexedDB atomica sotto Web Locks writer/outbox e CAS `updatedAt`, disattivazione autosync/outbox, activity, recupero sinossi e riapertura congelati/downstream. Nessuna modifica del romanzo. Test Vitest di stringhe, attestazioni, refresh, isolamento agenti e transazioni + Playwright desktop/mobile sul consenso e assenza rete. ADR 0024 e `docs/loc-scan-collation.md`.

**Limiti:** il software NON ha analizzato la scansione visuale; l'autore potrebbe sbagliare pagina, copiare dall'OCR o non avere i diritti. La corrispondenza di due testi digitati non dimostra provenienza visiva, verità, autenticità o licenza. In una prossima tranche valutare collegamento puntuale a pagina IIIF e relativi permessi, senza inventare un'identità delle immagini.

## 0.10.0 — 2026-11-06 (PR #35)

**Library of Congress OCR: riverifica live opzionale del file esatto e quarantena volontaria**

- Per ogni breve fonte `lococr:` attiva, pulsante **Riverifica OCR online** con consenso separato: prima GET al dettaglio canonico `www.loc.gov/item/<id>/?fo=json`, seconda GET **solo** al file `.txt` specifico archiviato, se è ancora fra le risorse istituzionali ammesse. Due host HTTPS fissi e allowlist: nessun romanzo, citazione, hash, nota diritti, query o credenziale inviata alla Library.
- Controllo rigido di identità documento, presenza del file nel catalogo, divieti di download/accesso, **SHA-256 del contenuto**, lunghezza e frase letterale allo stesso offset. Esiti distinti (`identity|resource|digest|excerpt`). Gli errori CORS/429/rete/JSON/risorsa negata **non diventano un esito positivo o negativo**. La verifica è temporanea nella schermata: non modifica libro, IndexedDB, ZIP, GitHub né stato dei diritti.
- Con discordanza, pulsante **Escludi OCR discordante** disponibile solo dopo un secondo consenso esplicito. Elimina soltanto l'ID dalle fonti attive, preservando tutti gli snapshot, audit, report precedenti e prosa. Se il capitolo era congelato, riapre la review e invalida i freeze successivi con recupero sinossi. Web Locks writer/outbox, CAS `updatedAt`, autosync off, outbox e activity in transazione atomica; nessuna rete nella quarantena.
- Lo stesso parser di risorse applica il blocco per `access_restricted`, `download_restricted` e `rights_restricted` ai metadati e singole risorse, rifiutando flag incoerenti e URL non consentite. Streaming limitato 240 KB JSON / 160 KB file OCR, 12 secondi per GET, niente redirect/cookie/referrer o proxy.
- Test Vitest di ritorno live, backup con hash/frase/offset alterati, host/risorsa non più consentita, copyright/restrizioni sopraggiunte, CORS/429/HTML, CAS/freeze, Playwright desktop/mobile per doppio consenso, privacy e confronto; ADR 0023, `docs/loc-ocr-reverification.md`.

**Limiti:** SHA-256 e testo remote **non autenticano la scansione storica, la verità dei fatti, il copyright o l'accuratezza OCR**. Il controllo non è automatico durante le review; i test con risposte simulate non attestano CORS reale né disponibilità di OCR per tutte le collezioni LoC.

## 0.9.9 — 2026-11-06 (PR #34)

**Library of Congress: brevi OCR istituzionali recuperati realmente con diritti attestati dall'autore**

- Nuova sezione **Estratti OCR istituzionali** per capitolo: richiede una scheda LoC e relativa ispezione attiva con riferimento a risorsa testuale e nessun accesso ristretto esplicito. L'autore sceglie base di utilizzo `public_domain|permission`, nota 16–280 caratteri, spunta attestazione e conferma un secondo dialogo che avverte su invio AI/ZIP/GitHub, OCR e copyright.
- Due GET strettamente limitate: dettaglio `https://www.loc.gov/item/<id>/?fo=json`, verifica dell'identità e dell'assenza di restrizione esplicita; poi **un solo file .txt** tra `resources[].fulltext_file|fulltext_derivative|djvu_text_file` solo se sotto `https://tile.loc.gov/storage-services/{service|master}/`. Niente OCR/PDF/HTML/immagini, URL esterne, redirect, cookie, referrer o credenziali.
- Timeout 12 s/GET, lettura streaming limitata a 240 KB di JSON e 160 KB di testo UTF-8; stop su errori CORS/429/JSON/host/identità/formato/limite **senza salvare nulla**. Nessuna ricerca privata o testo del libro inviati a LoC.
- Il browser memorizza soltanto una **porzione letterale di una riga OCR** fino a 900 caratteri, URL istituzionale, SHA-256 del testo ricevuto, lunghezza, offset e timestamp, con ID `lococr:<itemId>:<timestamp>:<sha16>`. `evidenceStatus=institutional_ocr_unverified`; `rightsStatus=author_attested_unverified`: NON equivalgono a originali autenticati, verità storica o licenze certificate.
- Nuove `HistoricalClaim.sourceEvidence` possono citare `lococr:` attivi soltanto con frase letterale propria, senza promuovere `loc:` / `locdetail:`; OCR e trascrizioni manuali dello stesso item non diventano supporti indipendenti. Solo storico e giudice vedono i brani, gli altri 11 ruoli sono ciechi; nessuna scena viene modificata automaticamente.
- Snapshot immutabili max 40 storici / 4 attivi, disattivazione su scheda o ispezione superata, conservazione durante refresh Wikipedia/Crossref/Wikisource/LoC/manuale. Web Locks, CAS, rewind freeze, invalidazione downstream, autosync off, outbox atomica, activity. Test Vitest di fonte/rete/diritti/dominio/concorrenza e Playwright desktop/mobile, ADR 0022, guida `docs/loc-ocr-excerpts.md`.

**Limiti:** i contenuti possono essere OCR errati o trascrizioni derivate, non fonti primarie certificate; i diritti sono attestati dall'autore e non verificati automaticamente. La disponibilità reale di `.txt`/CORS varia per oggetto: i mock non attestano la raggiungibilità browser. Nessuna scansione/PDF e nessuna verifica contro l'immagine originale.

## 0.9.8 — 2026-11-06 (PR #33)

**Library of Congress: ispezione per singola scheda di disponibilità e diritti, senza scaricare originali**

- Nuovo comando per ogni scheda LoC attiva: **Verifica accesso e diritti della scheda**. Dialogo con ID esatto e consenso dell'autore; GET read-only verso `https://www.loc.gov/item/<itemId>/?fo=json` con endpoint fisso. Solo l'ID pubblico è inviato, non query, romanzo, segreti, PAT o chiavi AI.
- Lettura esclusiva di indicatori/catalogo `digitized`, `access_restricted`, `rights_advisory`/`rights`, `access_advisory` e presenza di link a risorse digitali/testuali. **Nessun PDF, OCR, immagine, URL di risorsa o testo originale viene scaricato o salvato**; l'indicatore di una risorsa non certifica che sia realmente disponibile o riutilizzabile.
- Stato dei diritti sempre `undetermined`, evidenza `catalog_metadata_only`. Campi assenti restano `null` (sconosciuto), non «permesso». Risposte identificate dall'ID istituzionale esatto, streaming massimo 240 KB, timeout 12s, zero credenziali/redirect/referrer, errori CORS/429/JSON fail-closed.
- Snapshot separati in `ChapterArchiveCatalog.inspections` fino a 60, revisione append-only con ID `locdetail:<itemId>:<timestamp>`, consultabili via ZIP/backup/GitHub se l'autore sincronizza. Refresh del catalogo preserva lo storico ma disattiva le ispezioni su schede ritirate. I metadati `loc:` e `locdetail:` **non sono citazioni documentali**.
- Solo specialista storico e giudice ricevono gli avvisi, segnalati come metadati non attendibili; gli altri 11 revisori restano ciechi. Concorrenza Web Locks/CAS, riapertura freeze e downstream, outbox atomica e autosync disabilitato. Test Vitest dominio/API/transazioni e Playwright desktop/mobile; ADR 0021, `docs/institutional-item-inspection.md`.

**Limite:** non è ancora acquisizione del testo di un originale istituzionale né una verifica giuridica delle licenze. I test browser con mock non certificano che LoC accetti CORS nel browser reale. L'autore deve esaminare personalmente l'originale e le condizioni di riutilizzo.

## 0.9.7 — 2026-11-06 (PR #32)

**Wikisource: riverifica remota dell'impronta delle revisioni e quarantena volontaria**

- Ogni estratto `itwsr:` attivo può essere **riverificato online** con consenso separato. Il browser invia SOLO il numero della revisione al dominio fisso `it.wikisource.org`, senza trasmettere query, manoscritto, citazioni, segreti, PAT, API key o SHA-256. Un solo GET, nessun retry automatico.
- Il controllo confronta ID pagina, titolo, namespace, ID/timestamp revisione, digest SHA-256, lunghezza e frase letterale all'offset salvato. Stato mostrato in pagina **soltanto temporaneamente**: non è un certificato della fonte e non viene persistito su libro, backup o GitHub.
- Un mismatch genera un **avviso**, mai una correzione silenziosa. Il pulsante **Escludi fonte discordante** richiede una seconda conferma dell'autore, rimuove soltanto il riferimento attivo e preserva testo e report già archiviati.
- Esclusione atomica protetta da Web Locks e CAS `updatedAt`: ripristino sinossi, invalidazione downstream dei freeze, autosync disattivato, outbox cancellata, activity di audit. Nessun fetch nel salvataggio locale. Errore API/CORS/429/timeout non vale né successo né discrepanza e non muta il libro.
- Nuovi test Vitest di verifica remota (manomissione backup, mismatch, errori), application (concorrenza e rewind) e Playwright desktop/mobile. ADR 0020 e `docs/wikisource-reverification.md`.

**Limiti:** confronto con una risposta online MediaWiki, NON autenticazione di manoscritto originale, fatto storico o diritti. Il controllo è su richiesta e temporaneo, non precede automaticamente ogni review; le fonti locali non riverificate restano trattate come trascrizioni non autenticate.

## 0.9.6 — 2026-11-06 (PR #31)

**Wikisource: citazioni legate al wikitesto della revisione esatta, non alla pagina corrente**

- Il lookup storico usa due fasi: ricerca consensuale senza estratti `TextExtracts`, seguita da `query+revisions&revids=...` e `rvprop=ids|timestamp|content&rvslots=main`. Confronto obbligatorio di pagina, namespace, titolo, `revid` e timestamp tra le risposte; l'assenza/mismatch del contenuto causa fallimento del batch senza salvataggi parziali.
- I nuovi estratti sono **porzioni letterali di wikitesto** di massimo 1000 caratteri scelte da righe di prosa semplice. Nessuna esecuzione di template/trasclusione o text parsing fittizio: pagine prive di righe citabili non producono evidenza.
- Il browser calcola `SHA-256` dell'intero wikitesto della revisione e salva metodo, offset e lunghezza, con nuovo ID `itwsr:<pageId>:<revid>:<sha256-16>`. Le `sourceEvidence` possono fare riferimento solo a nuovi snapshot attivi con prova strutturale, mai ad associazioni legacy non accertate.
- **Migrazione conservativa:** gli estratti v0.9.5 `itws:...` restano nello storico e nei report precedenti, ma non sono disponibili alle nuove review perché provenivano dall'estratto della pagina corrente. Riacquisizione solo dopo consenso dell'autore.
- UI con SHA-256/offset e avvisi visibili; storico con banner legacy, giudice con revisionProof e istruzioni per non confondere coerenza testuale, autenticità dell'opera e stato dei diritti.
- Lettura API limitata **in streaming a 150 KB**, protezioni su JSON, CORS, HTTP 429, contenuti nascosti o incoerenti, doppia query e assenza di testo. Test su provenienza, migrazione/audit, privacy, fail-closed e Playwright desktop/mobile; ADR 0019 e guida aggiornata.

**Limiti:** hash locale e ID remoto **non autenticano** l'opera/edizione originale né certificano licenza o attendibilità storica. I backup possono essere alterati prima dell'importazione; per verificarli nuovamente serve rifare una consultazione remota. L'API/CORS reale non è certificata dai test con mock.

## 0.9.5 — 2026-11-06 (PR #30)

**Wikisource: ricerca pubblica consensuale di brevi trascrizioni con ID revisione**

- Nuova sezione per capitolo **Trascrizioni Wikisource**, con 1–3 query pubbliche scritte dall'autore, anteprima e conferma dell'invio a `it.wikisource.org`. Nessuna query automatica da prose, memoria, segreti, canone, credenziali o API key.
- Adapter read-only MediaWiki su host fisso, `origin=*`, `explaintext=1`, `rvprop=ids|timestamp`, fino a 2 estratti/query, timeout 12s, 150 KB max, senza cookie/redirect/credenziali. Risposta API malformata, timeout, 429 o CORS falliscono senza salvataggio parziale.
- Dossier `wikisource` distinto da Wikipedia, DOI, LoC e trascrizioni manuali: snapshot immutabili `itws:<pageId>:<revisionId>`, title/URL canonico ricostruito, testo breve acquisito, data revisione, query, data consultazione e storicizzazione fino a 70 voci.
- Il revisore storico può citare solo la specifica versione attiva con una `sourceEvidence` letterale per fonte; due revisioni della stessa pagina non valgono come fonti indipendenti. Il direttore riceve quote verificabili, revisioni e stato `community_transcription_unverified`; gli altri 11 ruoli sono ciechi agli estratti.
- Rewind sicuro dei freeze e delle sinossi, Web Locks, `updatedAt`, outbox cancellata e autosync off; backup/ZIP e altre ricerche preservano gli snapshot Wikisource. Test Vitest ed E2E desktop/mobile, ADR 0018 e guida `docs/wikisource-transcriptions.md`.

**Limiti importanti:** Wikisource ospita **trascrizioni collaborative**, non originali autenticati. La sola disponibilità di un estratto non prova né l'autenticità, né un fatto storico, né il pubblico dominio: diritti e attribuzione della singola opera devono essere verificati manualmente. I mock browser non attestano l'effettiva disponibilità di `TextExtracts`/CORS né l'esatta atomicità fra estratto e ID revisione restituito dall'API.

## 0.9.4 — 2026-11-06 (PR #29)

**Estratti storici trascritti dall'autore: provenienza e diritti dichiarati**

- **Versione online corretta**: il footer desktop e l'header mobile leggono `package.json.version`, eliminando il precedente testo fisso «v0.3.0» che non corrispondeva alla versione distribuita.
- **Pulizia dei branch**: workflow dedicato su push a `main`, con cancellazione solo di branch di PR già unite, mai di PR aperte, `main` o riferimenti il cui SHA sia stato modificato; vedere `docs/branch-maintenance.md`.
- Nuovo pannello **Estratti da originali consultati dall'autore**: un documento del catalogo Library of Congress già approvato, pagina/folio e trascrizione breve (24–1200 caratteri), data/edizione opzionale, conferma della base dei diritti e motivazione.
- Nessuna nuova richiesta verso archivi durante il salvataggio; l'app non scarica originali, immagini, PDF, OCR o testi completi. Checkbox + conferma che mostra la trascrizione e spiega l'invio futuro a modelli AI e la possibile sincronizzazione GitHub.
- Dossier `manualEvidence` conservativo: ID `locex:<itemId>:<timestamp>`, snapshot immutabili, fino a 40 versioni/5 documenti attivi, associazione alla scheda LoC valida. Le trascrizioni riferite a schede inattive sono conservate ma escluse dalle nuove review.
- La redazione storica può citare `locex:...` solo mediante `sourceEvidence[{sourceId,quote}]` effettivamente presente nella trascrizione. Gli ID di catalogo `loc:...` e i DOI `crossref:...` restano **non probatori**. Due trascrizioni dello stesso originale non sono due fonti indipendenti.
- Il direttore visualizza `evidenceStatus=author_transcribed_unverified` e la collocazione, con istruzioni a non certificare l'autenticità; gli altri undici agenti non vedono gli estratti. Interfaccia con provenienza e diritti dichiarati.
- Web Locks, CAS `updatedAt`, salvataggio e activity atomici, rewind dei capitoli congelati, autosync off e outbox cancellata. Test Vitest e Playwright desktop/mobile, ADR 0017, `docs/archival-excerpts.md`.

**Limiti:** originali e licenze sono attestati dall'autore, **non verificati autonomamente** dall'app. Una citazione letterale prova corrispondenza al testo digitato, non provenienza, autenticità, diritto di pubblicazione o veridicità del documento. È ancora aperta la consultazione indipendente dei documenti originali e delle loro versioni.

## 0.9.3 — 2026-11-06 (PR #28)

**Cataloghi storici istituzionali: piste di ricerca LoC, non evidenza documentale**

- Pannello per capitolo **Archivi istituzionali** con 1–3 query pubbliche inserite dall'autore e conferma esplicita dell'invio delle stringhe esatte alla Library of Congress.
- Adapter browser read-only API JSON LoC, senza chiavi, cookie o redirect, origini/URL canonici controllati, fino a 3 schede/query, timeout e limiti dimensione. La rete CORS e i rate limit possono impedire il funzionamento senza proxy o backend.
- Record storicizzati con titolo, ID LoC, URL ricostruita, data/descrizione se presenti, query e timestamp in IndexedDB e snapshot ZIP/GitHub; dati Wikipedia e Crossref preservati fra ricerche.
- **Nessuna prova simulata:** le schede sono metadati, non documenti letti; `loc:...` vietato nei sourceIds documentali. Soltanto il revisore storico e il direttore editoriale possono consultarle come piste.
- Aggiornamenti con Web Locks, fencing `updatedAt`, stop in caso di errore, rewind e invalidazione dei freeze successivi, autosync off e outbox eliminata.
- Test privacy, URL ostili, rete, persistenza, concorrenza e Playwright mobile/desktop. ADR 0016, guida `docs/institutional-archives.md`, issue #23.

**Limiti:** API LoC non garantisce CORS nel browser; è necessaria consultazione umana degli originali e delle condizioni di utilizzo. Nessun OCR, testo completo o verifica primaria automatica.

## 0.9.2 — 2026-11-06 (PR #27)

**Verifica delle citazioni storiche per singola fonte (anti-falsa corroborazione)**

- Ogni fonte citata in un nuovo rilievo storico deve avere una propria citazione letterale, collegata mediante `sourceEvidence[{sourceId,quote}]`. Il validatore verifica il testo **nell'estratto specifico**, non in una qualsiasi delle fonti elencate.
- Una sola citazione storica legacy resta valida soltanto per un rilievo con un unico `sourceId`; due revisioni della stessa pagina Wikipedia non costituiscono fonti indipendenti.
- Il direttore riceve `citedQuote` e `quoteMatches` per ciascuna fonte per valutare criticamente pertinenza e possibili contraddizioni. La Dashboard mostra ciascuna citazione accanto alla relativa fonte e segnala i report vecchi privi di prove individuali.
- Nuove regressioni Vitest su falsa corroborazione, citazioni scambiate, revisione duplicata e separazione dei contesti. ADR 0015, issue #23.

**Limiti:** Wikipedia è terziaria; corrispondenza letterale non prova verità, indipendenza delle voci o accuratezza del giudizio storico. Nessuna consultazione di fonti primarie o studi DOI integrali.

## 0.9.1 — 2026-11-05 (PR #25)

**Bibliografia DOI verificabile per capitolo: metadati Crossref separati dalle prove storiche**

- Nuovo pannello **Bibliografia DOI** per ciascun capitolo nella Dashboard/Redazione: da 1 a 5 DOI immessi dall'autore e consultati solo dopo conferma delle stringhe esatte da inviare a `api.crossref.org`.
- Adapter browser `GET https://api.crossref.org/works/{doi}`, senza credenziali/cookie/redirect, con filtro DOI rigido, timeout, controllo dei payload, richieste seriali e salvataggio atomico; 404 significa soltanto che il DOI non è censito in Crossref.
- Dossier bibliografico distinto dagli estratti Wikipedia con titolo, autori, anno di pubblicazione, rivista/collana, editore, tipo dell'opera e URL generata da DOI, timestamp e storico degli snapshot. I metadati **non** comprendono abstract o testo completo né garantiscono l'accuratezza di un'affermazione.
- La bibliografia viene mostrata solo al revisore `historical` e al direttore editoriale come **pista da consultare**, senza contaminare gli altri 11 agenti o i lettori ciechi.
- **Divieto di usare metadati come prove:** `HistoricalClaim.sourceIds` continua a richiedere estratti effettivamente acquisiti e citazioni letterali valide. Un DOI Crossref non è accettato come ID di fonte documentale e non può certificare una proposizione.
- I riferimenti bibliografici sono conservati in IndexedDB e nei backup/snapshot del libro; aggiornare le schede DOI riapre un capitolo congelato, invalida i successivi, ripristina la sinossi precedente e disabilita autosync con Web Locks e controllo `updatedAt`.
- Copertura test Vitest su DOI non validi, privacy, rete non autorizzata, blocco della serializzazione concorrente, rewind sicuro, separazione dei prompt e contrasto delle false citazioni DOI; test Playwright desktop/mobile sul consenso e sull'intero ciclo storico.
- ADR 0014, `docs/crossref-bibliography.md`, README, AGENTS, sicurezza e issue #23.

**Limiti:** il DOI non garantisce peer review, testo disponibile, veridicità o affidabilità della pubblicazione; i metadati Crossref non sono una fonte primaria. L'integrazione con archivi istituzionali e fonti primarie effettivamente lette resta una fase successiva.

## 0.9.0 — 2026-11-05 (PR #24)

**Dossier storico tracciabile per capitolo, ricerca pubblica con consenso e verifica delle citazioni dell'AI**

- Dashboard **Redazione multi-agente → Dossier storico**: fino a 5 query per capitolo, scritte dall'autore e inviate a Wikipedia italiana **solo dopo una conferma che mostra le stringhe esatte**. Non parte alcuna ricerca automatica dal testo inedito, dai personaggi o dalla timeline privata.
- Adapter MediaWiki Action API anonimo e browser-only: `https://it.wikipedia.org/w/api.php`, CORS `origin=*`, niente cookie/credenziali, redirect disabilitati, timeout, risposta max 170 KB, massimo 3 pagine per query e host/URL allowlist.
- Dossier in IndexedDB con query, fonti, link articolo, ID pagina e revisione, estratti, data consultazione, ricerche senza risultati e storico delle revisioni citate. Backup ZIP e snapshot del libro mantengono i metadati senza nuove credenziali.
- Il revisore **storico** (una delle 12 chiamate indipendenti) riceve soltanto il dossier documentale del capitolo, mentre gli altri 11 ruoli, inclusi i cinque lettori ciechi, non ricevono le nuove fonti.
- Ogni finding storico dichiara una delle tre valutazioni: `consistent_with_excerpt`, `contradicts_excerpt`, `unverified`; i primi due stati richiedono source IDs validi e una **frase realmente presente** in un estratto consultato. Il software respinge fonti inventate, citazioni inesistenti e valutazioni non verificabili mascherate da documentate.
- Il direttore editoriale riceve le fonti e gli estratti associati ai rilievi storici insieme agli estratti delle scene, per poter **accettare o respingere** una remediation motivando. I risultati esterni non riscrivono il manoscritto automaticamente.
- Aggiornare le fonti dopo il congelamento riapre il capitolo, invalida i successivi e ripristina la sinossi globale precedente; operazione serializzata con Web Locks e controllo revisioni, autosync sospeso e outbox scartata.
- Link alla pagina Wikipedia e alla specifica revisione, con attribuzione agli autori; gli estratti sono **fonti terziarie**, non certificazione di verità storica né ricerca d'archivio.
- Test Vitest su privacy, origine HTTPS, finti link, query, report e citazioni, rete e concorrenza IndexedDB; test Playwright desktop/mobile su consenso, passaggio al revisore storico, giudice scettico e congelamento.
- ADR 0013, guida `docs/historical-sources.md`, issue #23, documentazione di sicurezza e roadmap.

**Limiti:** ricerche manuali per argomenti pubblici, solo Wikipedia IT e non fonti primarie o secondarie. Una frase riportata correttamente può essere falsa o fuori contesto. Per fact-checking storico approfondito occorreranno archivi istituzionali, bibliografia attendibile, più fonti indipendenti ed estrazione di query da approvare prima dell'invio esterno.

## 0.8.1 — 2026-11-05 (PR #21)

**Budget stimato per libro, prezzi AI per endpoint/modello e stop preventivo delle richieste**

- Nuovo pannello **Budget AI del libro** sulla Dashboard: opt-in, soglia in euro per periodo, massimo token output richiesto e tariffario manuale per input/output (€/milione di token) su ciascun modello e provider configurato.
- Prima di ogni chiamata del runner — compresi sette specialisti, cinque lettori, direttore, remediation, consolidamento e sinossi — calcolo preventivo dei token input con riserva UTF-8, dell'output configurato e dei costi stimati da usage del periodo. Se non c'è margine, l'autopilot va in pausa **prima di contattare il provider**.
- Anche le proposte AI di fusione delle scene usano lo stesso controllo; le bozze manuali restano gratuite.
- Ogni richiesta potenzialmente fatturabile viene marcata `aiRequested` in IndexedDB **prima del fetch**. Se la risposta manca di token, la rete cade o l'attività viene interrotta, il budget si blocca conservativamente alle richieste successive senza trattare il consumo ignoto come gratuito.
- I listini sono inseriti dall'autore e non includono crediti residui inventati. L'interfaccia mostra stime monetarie da token dichiarati e prezzi configurati, non fatture o saldo del provider.
- Nessuna tariffa/prezzo predefinito. La protezione è **facoltativa**, retrocompatibile con i libri esistenti e permette di alzare la soglia mantenendo lo storico; disattivare e riattivare apre un nuovo periodo su scelta esplicita.
- Backup ZIP content-only conserva budget per libro e activity; backup completo conserva anche le tariffe globali, con validazione degli importi.
- Test Vitest su prezzi mancanti, provider/modelli distinti, risposte senza usage, attività fallite, riserva e limiti, più integrazione runner e scena AI. Test Playwright desktop/mobile su configurazione, stop prima della chiamata e uso sconosciuto.
- ADR 0012, nuova guida `docs/ai-budget.md`, issue #17 e documentazione della sicurezza.

**Limiti:** non è un hard cap delle fatture: il provider potrebbe addebitare chiamate interrotte, ignorare `max_tokens` o applicare tariffe/cache diverse da quelle inserite. Il calcolo input usa un'approssimazione prudente in byte UTF-8, non il tokenizer ufficiale. Il portale del provider rimane la fonte della fatturazione effettiva.

## 0.8.0 — 2026-11-05 (PR #19)

**Redazione multi-agente per capitolo — verifica critica, remediation e congelamento**

- Dopo il completamento delle scene, ogni capitolo entra in una redazione composta da **sette specialisti** (causalità, segreti, timeline, accuratezza storica da verificare, voce personaggi, stile, struttura) e **cinque lettori** (genere, generalista, scettico, personaggi, mistero).
- **Richieste AI separate** per revisore e segmento. I lettori sono ciechi ai segreti privati; gli specialisti ricevono le porzioni pertinenti del canone; il revisore dei segreti legge il registro privato. Memoria breve per ruolo e sinossi progressive del libro.
- Rapporti JSON verificati: esito, prova testuale, gravità, motivazione e remediation proposta. Il direttore editoriale dispone anche di **estratti della scena originale** e canone pertinente per verificare la fondatezza della prova; giudica ogni rilievo, può accettarlo o **respingerlo con spiegazione**, e non può ignorare rilievi in silenzio.
- La riscrittura riguarda solo scene con correzioni approvate; seguono la riconciliazione di memoria, timeline e segreti e un'altra tornata completa di dodici letture.
- Fino a **tre tornate di correzione automatica**. Se persistono problemi accettati, il processo si ferma e chiede istruzioni all'autore, senza inventare consenso.
- Quando i rilievi sono risolti o respinti criticamente, la sintesi progressiva aggiorna il capitolo e il libro, **congela il capitolo** e consente solo allora di scrivere il successivo.
- I capitoli congelati mantengono lo storico di rapporti, decisioni e motivazioni e una fotografia della **sinossi globale in quel punto**. **Rivaluta** ripristina quella fotografia, disabilita autosync e invalida gli assensi di tutti i capitoli successivi; nessuna sinossi è troncata silenziosamente e i legacy non ricostruibili bloccano il rewind.
- Nuove route modelli `chapterAudit`, `chapterReaders`, `chapterJudge`, `chapterRepair`, configurabili globalmente e per libro; riutilizzo di `consolidate` e `summarize`.
- Il push GitHub e l'autosync di prosa non avvengono mentre capitoli scritti attendono congelamento. I checkpoint si salvano in IndexedDB dopo ogni attività.
- Pannello responsive **Redazione multi-agente** con analisi per revisore, prove testuali, remediation e motivazioni di rifiuto, stato dei capitoli e riapertura manuale.
- Vitest per ruoli e contesti indipendenti, valutazione critica, freeze e cicli correttivi, rewind di snapshot/legacy e scarto di risposte AI obsolete. Test Playwright desktop/mobile e ADR 0011, guida utente e issue #20.
- Dipendenza Playwright fissata alla release stabile 1.64.1 per evitare risoluzioni di prerelease incomplete nel registry CI.

**Limiti:** la review storica segnala ipotesi ma **non verifica fonti esterne**. Un capitolo lungo può richiedere oltre dodici chiamate per segmento e consumare molti crediti; il ledger v0.7.1 non impone ancora tetti. La memoria privata troppo grande si blocca con un errore anziché troncarsi. Le sessioni browser non lavorano con pagina chiusa; il lease multi-dispositivo rimane conservativo.

## 0.7.1 — 2026-11-05 (PR #18)

**Dashboard per libro dei token AI dichiarati dai provider**

- Nuovo pannello **Consumi AI registrati** sulla Dashboard, con token input, output e totale noto per il libro attivo.
- Aggregazione per endpoint e modello: i token Sol/Astra/Luna e di provider diversi non vengono confusi.
- Contatori distinti per report completi, parziali e senza usage, con avviso sulle attività fallite/interrotte che possono aver consumato token senza un report dal provider.
- UI responsive desktop/mobile, con tabella a scorrimento locale e test per evitare overflow della pagina.
- Nessun credito residuo, costo in euro o limite di spesa inventato. Il saldo reale è nel portale del provider e il prezzo per token dipende dai suoi listini.
- Calcolo puro da attività IndexedDB già presenti: nessuna nuova API, tracking esterno, chiave o costo AI per generare le statistiche.
- Unit test per token validi/invalidi, report mancanti, multi-provider e attività manuali; Playwright desktop/mobile con isolamento dei consumi fra due libri.
- ADR 0010, issue #17, documentazione utente e backlog per listini configurabili, soglie e stop preventivo.

**Limiti:** il totale noto può essere inferiore ai consumi fatturati, perché provider e richieste fallite non garantiscono usage. La versione 0.7.1 è osservabilità, **non** controllo automatico dei crediti o tetto di spesa.

## 0.7.0 — 2026-11-05 (PR #16)

**Diff parola per parola e proposte di fusione delle scene, con approvazione esplicita**

- Evidenziazione locale/GitHub delle differenze testuali; algoritmo LCS con limiti di complessità per mobile e fallback per paragrafi o scene intere su testi lunghi.
- Laboratorio di fusione direttamente nella schermata di confronto delle scene, con editor manuale gratuito e opzione per proposta AI previa conferma del trasferimento di entrambe le versioni e dei segreti all'endpoint selezionato.
- Nuova attività `merge` configurabile con endpoint/modello globale o per libro; nessun nome modello o tariffario hardcodato.
- Il runner delle proposte AI usa lease GitHub, Web Locks, controllo dello SHA remoto e della revisione locale prima/dopo la generazione. Le bozze non modificano il canone.
- IndexedDB v2: store `mergeDrafts` con storico proposte, originali locale/remoto, modello, token se noti, stato proposto/rifiutato/accettato. Persistenza dopo reload.
- Approvazione umana in più passaggi: selezione della bozza, recupero a doppio backup e conferma canonica nel Lettore. Le scene fuse restano `draft` finché l'autore non le conferma. Prima della conferma runner AI, revisioni e ogni push GitHub sono bloccati lato servizio; autosync resta disattivato.
- ZIP di contenuti ampliato in modo compatibile per includere lo storico bozze. Un ZIP importato non può riutilizzare bozze proposte come autorizzazioni canoniche.
- Test unitari di diff, limiti e recovery, finti provider e GitHub, ZIP roundtrip, più test Playwright desktop/mobile per editor manuale, persistenza e doppio backup.
- ADR 0009 e documentazione per l'autore; issue #15.

**Limiti:** la fusione AI è una proposta editoriale, non un controllo di continuità affidabile o un merge semantico perfetto. Il provider AI può addebitare la chiamata anche se la bozza viene rifiutata; i token sono mostrati solo quando il provider li comunica. Il browser deve restare aperto e i backup ZIP content-only contengono la prosa in chiaro.

## 0.6.0 — 2026-11-05 (PR #14)

**Confronto visuale GitHub e recupero narrativo protetto**

- Confronto read-only tra libro locale e snapshot HEAD GitHub; baseline comune opzionale dal commit dell'ultima sincronizzazione.
- Differenze per brief, vincoli, idee, review, singoli capitoli/scene, personaggi, luoghi, fazioni, oggetti, segreti, cronologia e stato narrativo. Scelta esplicita locale/GitHub per ciascuna unità, default locale.
- Recupero della versione GitHub come nuovo libro indipendente; oppure applicazione sul libro originale dopo creazione **atomica di due copie di sicurezza** (locale e GitHub) e activity audit.
- Controllo Web Locks e validazione di SHA remoto, timestamp e baseline locale prima della transazione. Nessun push, delete o force GitHub durante il ripristino.
- Disabilitazione dell'autosync dopo la risoluzione e richiesta di review manuale prima della successiva sincronizzazione.
- Test Vitest di merge conservativo, eliminazioni, baseline, conflitti e backup; test Playwright Chromium desktop/mobile.
- Documentazione: ADR 0008, guida `docs/conflict-recovery.md`, runbook e issue #3/#10.

**Limiti:** non è un merge semantico automatico né un diff parola-per-parola. Le copie sono salvate nel browser e vanno esportate anche in ZIP per una protezione esterna. Modifiche GitHub avvenute dopo la verifica sono bloccate dal successivo controllo SHA.

## 0.5.0 — 2026-11-05 (PR #12)

**GitHub writer lease — controllo della scrittura AI tra browser**

- Lease remoto per ogni libro collegato: branch `bookwriter-lock/<bookId>`, file `.bookwriter/lease.json`, commit solo fast-forward.
- Sessione di scrittura con UUID effimero: acquisizione obbligatoria prima dell'AI, verifica pre/post chiamata e prima del checkpoint, heartbeat ogni 25 secondi, TTL due minuti.
- Un altro dispositivo con lease attivo impedisce l'avvio dell'autopilot prima di spendere crediti. In caso di perdita del lock o indisponibilità GitHub il risultato in corso non viene canonizzato.
- Lock Web Locks fra tab del browser, rilascio best effort a fine sessione. Recupero manuale solo dopo scadenza più 60 secondi, con conferma.
- Stato del lease e recupero nell'Archivio mobile/desktop.
- Test di concorrenza con GitHub simulato, rinnovo, rilascio, takeover e perdita di possesso; ADR 0007 e runbook aggiornato.

**Limitazioni:** lease e recovery sono conservativi e basati sull'orologio del browser: non sono un database distribuito con fencing atomico. Il lease protegge il runner AI; modifiche manuali esterne e conflitti della prosa richiedono ancora risoluzione separata. Nessuna esecuzione con scheda chiusa.

## 0.4.0 — 2026-11-05 (PR #9)

**GitHub Autosync — fase 2a, opt-in**

- Outbox persistente in IndexedDB scritta nella stessa transazione dei checkpoint narrativi significativi (outline, review, consolidamento e revisione).
- Worker browser che invia automaticamente quando la scheda è aperta, riprende al reload/ritorno online e usa Web Locks contro invii concorrenti tra tab.
- Coalescing dei checkpoint, retry esponenziale limitato, stato bloccato e comando di riprova, visibili nella sezione Archivio.
- Marcatori di operazione nel commit e nel canon remoto per riconoscere commit riusciti quando la risposta è stata persa; ACK atomico che non elimina modifiche effettuate durante l'invio.
- Autosync disattivato per default, disponibile solo dopo il primo commit manuale e previa autorizzazione aggiuntiva per repo pubbliche.
- Suite Vitest per outbox, worker e recovery, più CI desktop/mobile.

**Non incluso:** lease distribuito tra dispositivi, risoluzione conflitti, ZIP snapshot remoti, Google/Microsoft OAuth. L'autopilot opera soltanto con la pagina attiva.

## 0.3.0 — 2026-11-05 (PR #8)

**GitHub Sync — fase 1, manuale**

- Connessione per libro con PAT fine-grained GitHub cifrato in IndexedDB.
- Verifica permessi e visibilità delle repository, consenso se pubbliche.
- Proiezione della memoria narrativa in Markdown/frontmatter Narrarium.
- Commit multi-file tramite Git Data REST con SHA e rifiuto degli aggiornamenti non fast-forward, mai force push.
- Import di libri e attività da `.bookwriter/project.json` senza sovrascrivere i dati locali.
- Test unitari per proiezione, privacy e conflitti; test UI Chromium desktop/mobile confermati tramite CI.
- Documentazione: `ADR/0005-github-manual-sync.md`, `docs/github-sync.md`, aggiornamenti AGENTS, README, feature e issue #3.

**Non incluso:** autosync, lease multi-device, snapshot ZIP remoti, login Google/Microsoft, E2EE tra dispositivi.

## 0.2.1 — 2026-11-05 (PR #7)

- Suite Playwright Chromium desktop e mobile.
- Correzione della navigazione mobile sticky e della larghezza dei tab.
- Test persistenza IndexedDB e round-trip ZIP.

## 0.2.0 — 2026-11-05 (PR #1)

- Prima SPA React/TypeScript responsive con tema chiaro/scuro.
- Orchestrazione autonoma da brief a scene, audience review e registrazione delle attività.
- Configurazione endpoint e routing dei modelli.
- Persistenza IndexedDB e AES-GCM locale delle API key.
- Backup ZIP e importazione non distruttiva, export EPUB/DOCX/PDF.
- GitHub Pages su `https://ghostwriting.ws`.
