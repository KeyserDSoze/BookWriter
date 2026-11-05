# ADR 0009 — Diff testuale e proposte di fusione narrative non canoniche

- **Stato:** Accettato per v0.7.0 (PR in verifica)
- **Data:** 2026-11-05
- **PR:** [#16](https://github.com/KeyserDSoze/BookWriter/pull/16)
- **Issue:** [#15](https://github.com/KeyserDSoze/BookWriter/issues/15)
- **Predecessori:** ADR 0005–0008

## Problema

La v0.6.0 permette di scegliere per singola scena una versione locale o GitHub, ma non permette di preservare idee e passaggi validi **all'interno** di due versioni divergenti. L'autore deve poter analizzare le differenze e richiedere una proposta AI senza consentire al modello di sovrascrivere il canone.

## Decisioni

1. **Diff deterministico e solo visuale.** Dividere la scena in token (parole e whitespace) ed evidenziare testo presente soltanto localmente (rosso), soltanto su GitHub (verde), oppure comune. Usare LCS con limite di 750 token per lato per evitare costo quadratico su mobile; sui testi maggiori applicare diff per paragrafi fino a 240 unità, poi visualizzare le versioni complete. Nessun algoritmo di diff modifica la prosa.
2. **Task `merge` configurabile.** Aggiungere una rotta modello `merge` nel router generale e negli override del libro, mantenendo gli endpoint OpenAI-compatible esistenti. Nessun identificativo modello Astra/Sol/Luna hardcodato. Il provider è scelto e configurato dall'autore.
3. **Consenso prima della chiamata AI.** La UI mostra endpoint e modello e chiede conferma prima di inviare **entrambe le scene e la memoria narrativa, compresi eventuali segreti**. La chiamata può consumare crediti e non può garantire rimborso. Le API key restano nell'archivio cifrato locale; non vanno nei prompt o nei commit Git.
4. **Prompts delimitati.** La memoria, i vincoli dell'autore, lo stile e il punto di vista della scena orientano la fusione; il testo locale/GitHub è trattato come **dato non attendibile**, non come istruzione. Non anticipare segreti nella scena, non eliminare indizi o payoff. Se il contesto supera i limiti di input, interrompere e chiedere all'autore di ridurre il materiale: non troncare silenziosamente canon e segreti.
5. **Lease e revision fencing.** Per i libri GitHub, il runner AI usa `withWriterGuard`: Web Locks fra tab, lease GitHub sul branch dedicato e verifica ownership prima/dopo la chiamata AI. Verificare HEAD canon GitHub e timestamp locale prima di persistente la bozza. Se la rete o il modello falliscono, o se la revisione cambia, nessuna proposta è accettata o canonizzata. Il controllo HEAD/browser resta non atomico tra i due sistemi (ADR 0007/0008).
6. **Bozze durevoli ma separate.** Migrare IndexedDB additivamente da versione 1 a 2 introducendo `mergeDrafts`. Salvare ogni proposta con UUID, ID scena, `localRevision`, `remoteHead`, testi originali, testo proposto, istruzione, modello/endpoint, token quando disponibili e stato `proposed/rejected/accepted`. Nessun PAT/API key nella bozza. Lo storico sopravvive al reload.
7. **Editor anche senza AI.** L'autore può scrivere e salvare una propria proposta usando l'editor manuale, senza crediti. I testi generati e le modifiche manuali vengono conservati come bozze; il rifiuto marca la bozza senza toccare il libro.
8. **Approvazione esplicita in due azioni.** Una proposta può essere selezionata tramite **Usa questa proposta per la scena**, ma non viene applicata finché non si conferma **Applica scelte con doppio backup**. La selezione propone un testo solo se entrambe le versioni della scena esistono e la bozza corrisponde esattamente alle revisioni visualizzate. L'input dell'autore è validato e limitato. Non sono ammesse proposte su campi generici, segreti o capitoli.
9. **Risoluzione transazionale.** La conferma riusa ADR 0008: dentro la transazione IndexedDB che crea due copie complete del libro, verifica nuovamente lo stato delle bozze, marca `accepted`, conserva il testo finale scelto, aggiorna la singola scena del libro principale, elimina il suo sommario obsoleto, imposta `status: draft`, lascia il libro `paused`, cancella l'outbox obsoleta e disattiva autosync. L'accettazione **non è canonizzazione** e non pubblica su GitHub.
10. **Backup compatibile.** Estendere il formato ZIP esistente con il campo opzionale `mergeDrafts`, mantenendo l'importazione degli ZIP v1 precedenti. Le bozze importate vengono rimappate con nuovi UUID e restano consultabili; le bozze `proposed` importate diventano `rejected` per impedire che una scelta precedente autorizzi modifiche a un nuovo libro.
11. **Seconda conferma editoriale e blocco delle esecuzioni.** Una fusione accettata aggiunge l'ID della scena a `editorialReviewSceneIds` (campo persistito nel libro). L'autopilot non può avviarsi da UI **né da API/runner** mentre esistono elementi in attesa; anche le richieste di revisione e i push GitHub manuali/automatici sono respinti lato servizio. Il Lettore mostra le scene da rileggere e offre **Conferma scena come canonica**, con consenso separato, controllo revisione e Web Locks. La conferma aggiorna la singola scena da `draft` a `canon`, annota l'audit, ma non invia alcun commit remoto. Con più scene, tutte devono essere confermate prima di riprendere il lavoro. L'autosync resta disabilitato fino a una successiva scelta esplicita.
12. **Integrità delle sincronizzazioni.** `pushGitHubBook` blocca in modo conservativo qualsiasi invio quando vi sono scene in revisione, anche se chiamato direttamente e anche con `automatic:true`. Rilegge inoltre la revisione locale prima di costruire il commit GitHub, evitando di pubblicare un manoscritto che il browser abbia modificato durante il push.

13. **Audit e trasparenza.** Registrare ogni generazione/bozza manuale nei log con modello, endpoint, input/output token se riportati dal provider (non inventare costi), evitando di copiare credenziali nei log. Registrare l'accettazione e l'associazione al doppio backup. UI accessibile da mobile, con anteprima diff e possibilità di espandere i testi completi.

## Limiti

- La correttezza artistica della fusione AI richiede lettura umana: una proposta non è una verifica automatica del canone, e il modello può comunque sbagliare sulle rivelazioni. Restano necessarie eventuali review narrative/continuity prima di canonizzare.
- Il diff è informativo, non una macchina di merge: la LCS privilegia una corrispondenza testuale, non semantica.
- La memoria narrativa completa può includere segreti; l'autore deve autorizzare il trasferimento all'endpoint AI scelto.
- Le bozze sono archiviate in IndexedDB e negli ZIP di contenuti; lo ZIP **content-only** contiene prosa e segreti in chiaro. Conservare i backup esterni in modo privato o cifrare lo ZIP completo con password.
- Il browser chiuso interrompe la generazione AI. Una risposta arrivata dopo aver perso il lease non viene salvata come bozza.
- Il budget economico non è ancora un ledger completo: mostrare solo i token realmente forniti dai provider, senza tariffari inventati.
- Il sistema evita sovrascritture GitHub con expected SHA e non usa `force push`; la selezione di un testo non è sincronizzazione immediata.

## Test di accettazione

- Diff che ricostruisce esattamente i testi originale/remoto e fallback su scene lunghe.
- Prompt e limiti del contesto, fallimenti HTTP, riconoscimento di cambi locali/HEAD, lease rifiutato.
- Generazione e rifiuto non modificano il canon; la proposta non viene accettata senza selezione esplicita.
- Accettazione produce una scena **draft**, due copie originali, audit, outbox disabilitata e nessun GitHub POST/PATCH; ripresa AI e push bloccati finché l'autore non conferma nel Lettore.
- Backup ZIP conserva il log bozze, ma le bozze importate non possono essere riutilizzate come approvazioni.
- Playwright desktop/mobile: diff, salvataggio bozza, reload, selezione, doppio backup, ripresa AI disabilitata, canonizzazione umana, ripresa riabilitata e verifica larghezza mobile.
- CI verde sulla HEAD prima del merge.

## Evoluzioni successive

Budget/price tracking per provider, tre-way editor grafico a segmenti, streaming parziale (con applicazione solo dopo risposta completa), revisione automatica di continuità del draft senza canonizzazione, e test su provider AI reali con consenso.
