# ADR 0164 — Ripresa dopo un ricaricamento e blocco lasciato dallo stesso browser

- Stato: accettato, preparazione locale
- Data: 2026-11-17
- Versione preparata: 0.29.0
- Integra ADR 0007 (writer lease), 0075 (clock), 0077 (recupero multi-tab) e 0150 (app installabile e lavoro in background).

## Problema

Con il libro collegato a GitHub, un F5 mentre l'autopilot lavora produceva questo:

1. la pagina nuova recupera l'esecuzione interrotta (ADR 0077) e mette il libro «In pausa»: corretto;
2. «Riprendi» fallisce con «Questo libro è già in scrittura da un altro dispositivo»: il blocco `bookwriter-lock/<bookId>` della pagina scomparsa non è stato rilasciato (una pagina che si ricarica non può farlo) e resta valido fino alla scadenza (TTL 120 s), poi serve un margine di 60 s e un recupero manuale in Archivio;
3. dopo il ricaricamento nulla riparte da solo.

L'app non «si accorgeva» di essere lei stessa l'autrice del blocco perché l'identificativo di sessione del blocco è casuale per ogni avvio e non veniva ricordato.

## Decisioni

1. **Sessioni di scrittura ricordate.** Prima di acquisire il blocco, `withWriterGuard` registra la sessione in `meta["writer-sessions:v1:<bookId>"]` (ultime 8 per libro). Dato locale del dispositivo: mai in ZIP, GitHub, cloud o nel documento del blocco, nessun nuovo campo nel protocollo.
2. **Sostituzione immediata, solo del proprio blocco.** `acquireWriterLease(..., { writerLockHeld: true })` sostituisce subito un blocco **attivo** se la sua sessione è fra quelle ricordate per quel libro **e** il chiamante tiene il Web Lock di scrittura del libro (condiviso da tutte le schede del browser: se lo teniamo, nessun'altra pagina di questo browser sta scrivendo, quindi quella pagina è finita). Il commit è il solito fast-forward `force:false` dall'ultima HEAD letta; se un rinnovo tardivo della pagina scomparsa vince la corsa, il nostro PATCH fallisce chiuso. La pagina scomparsa non può più rinnovare né confermare nulla (`renew`/`assert` vedono un'altra sessione). Un blocco di **un altro dispositivo** non si sostituisce mai in questo modo: restano TTL, margine di 60 s e recupero esplicito. Senza il lock locale, o con una sessione non ricordata, nulla cambia.
3. **Ripresa automatica dopo un ricaricamento** (`application/auto-resume.ts`). `recoverInterruptedRuns` restituisce i libri che erano davvero in esecuzione con l'ultimo segno di vita (ultimo commit o inizio della chiamata persa). L'app li riprende da sola solo se: la pagina è stata caricata con tipo di navigazione `reload` (F5, scheda ripristinata dopo un crash; aprire da link, segnalibro o scheda nuova non riprende); il lavoro era recente (≤ 15 minuti: dopo ore o giorni non spende denaro a sorpresa); l'interruttore del dispositivo è acceso (Impostazioni → Questo dispositivo, predefinito **acceso**, `localStorage` `bookwriter.ui.autoResume`, mai nel libro o nel cloud). Un solo libro (il più recente). Budget, writer lock, lease e controlli sono quelli di «Riprendi». La chiamata AI in corso al momento del ricaricamento va persa e può essere stata addebitata: l'avviso lo dice.
4. **Archivio.** Il blocco lasciato da una pagina di questo browser è indicato come tale; il testo non attribuisce più a «un altro dispositivo» ciò che è dello stesso browser.

## Lavoro in background: cosa non si fa e perché

La domanda era se spostare l'autopilot in un worker o nel service worker, o se farlo lavorare a pagina chiusa da PWA o browser. Valutato e **non adottato**:

- Un **Worker dedicato** termina con la pagina: non sopravvive a F5 né alla chiusura; toglierebbe lavoro al thread dell'interfaccia, ma non risolve il problema.
- Uno **SharedWorker** vive finché almeno un documento è collegato; con una sola scheda ricaricata non è garantito che sopravviva, e il supporto sui browser mobili non è uniforme. Richiederebbe di spostare nel worker runner, osservabilità live e messaggistica: un refactor ampio per un beneficio incerto.
- Un **Service Worker** viene terminato dal browser dopo poco tempo di inattività e non è pensato per sequenze lunghe di chiamate con logica fra l'una e l'altra; Background Fetch e Periodic Background Sync sono API di Chromium con scopi diversi (trasferimenti, aggiornamenti a intervalli di ore).
- L'**installazione come PWA** non cambia questi limiti: l'app installata è la stessa pagina in una finestra propria. Su telefono il sistema sospende la pagina quando passi a un'altra app; lo schermo resta acceso solo finché l'app è in primo piano (Wake Lock, già presente).
- Lavorare davvero a pagina chiusa richiede un processo fuori dal browser (un piccolo runner sul PC o un servizio). Oggi chiavi AI e PAT non lasciano il browser: sarebbe una scelta di architettura e di sicurezza da decidere in un ADR a parte, non una modifica a questa.

## Limiti

- Il riconoscimento del proprio blocco si basa su un dato di IndexedDB: un profilo del browser clonato e usato in due luoghi insieme lo ingannerebbe; browser o profili diversi (compresa una finestra anonima) sono dispositivi diversi.
- Il primo F5 dopo l'aggiornamento non riconosce un blocco lasciato dalla versione precedente, che non ricordava la sessione: vale l'attesa di prima, una sola volta.
- Nelle PWA su iOS i dati possono essere separati da quelli di Safari: sono due installazioni diverse.
- Un ricaricamento perde comunque la chiamata in corso. Nessuna garanzia di lavoro a pagina chiusa.

## Verifiche

Vitest: sostituzione immediata con lock locale e sessione ricordata (fast-forward, pagina scomparsa che non può più rinnovare), nessuna sostituzione senza lock locale, per un blocco estraneo o per una sessione ricordata per un altro libro; sessione ricordata prima di acquisire; recupero che restituisce solo i libri davvero in esecuzione con il segno di vita; regola di ripresa (solo `reload`, finestra, interruttore, un solo libro, date non valide). Playwright desktop/mobile: F5 a metà chiamata che riprende da solo e si vede, interruttore spento che lascia in pausa, apertura da link che non riprende, interruttore e spiegazione in Impostazioni.
