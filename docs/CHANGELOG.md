# Changelog — BookWriter

Ogni rilascio su `main` deve avere una voce verificabile. Le PR descrivono il comportamento rilasciato; le issue raccolgono lavoro incompleto e criteri di accettazione.

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
