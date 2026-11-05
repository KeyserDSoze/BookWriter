# Changelog — BookWriter

Ogni rilascio su `main` deve avere una voce verificabile. Le PR descrivono il comportamento rilasciato; le issue raccolgono lavoro incompleto e criteri di accettazione.

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
