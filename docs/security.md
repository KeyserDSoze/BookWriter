# Sicurezza e threat model

## Modello di fiducia

BookWriter è una SPA statica distribuita tramite GitHub Pages. Il codice JavaScript/TypeScript compilato **non può essere nascosto** all'utente o a estensioni/browser compromessi; non esiste alcun backend che mantenga segreti. La login Google/Microsoft è un'autenticazione per accedere ad API cloud e file personali, non una vera barriera server-side davanti al bundle.

## Identità e accesso ai cloud storage

- Google: OAuth per Drive `drive.appdata` (application data folder) e identificazione dell'account. Registrare origini JavaScript autorizzate.
- Microsoft: MSAL Browser Authorization Code + PKCE e Microsoft Graph, scope app folder `Files.ReadWrite.AppFolder`, subject provider stabile. Registrare redirect SPA per URL Pages.
- Identificare i profili con `provider + providerSubject`, non solo con l'email. Richiedere collegamento esplicito per unificare identità Google e Microsoft.
- Non codificare client secret in SPA. Token OAuth preferibilmente in memoria; clear al logout e ridurre le lifetime disponibili.

## Stato dei collegamenti GitHub (fase 1)

Il PAT GitHub fine-grained viene inserito in **Archivio**, cifrato con Web Crypto e conservato in IndexedDB. Viene decifrato solo per chiamare `https://api.github.com` (CORS, `redirect: error`), mai inserito nel repository narrativo o nello ZIP. L'archivio locale cifrato non è un vault E2EE; per aprire il libro da altro dispositivo occorre inserire un nuovo PAT autorizzato. Il vault Google/Microsoft per recuperare il PAT resta in progettazione (ADR 0002).

Prima della prima sincronizzazione su repository **pubblica**, la UI richiede una scelta esplicita. L'import remoto non sovrascrive copie locali; la scrittura remota si interrompe se lo SHA è divergente. Non garantiamo ancora single-writer senza lease cross-device, quindi l'uso contemporaneo su più browser non è supportato.

## Protezione della sessione AI tra dispositivi (ADR 0007)

Per ogni libro collegato, un documento `.bookwriter/lease.json` vive su una **branch GitHub dedicata**, non nella branch del canon. Contiene solo ID del libro, ID casuale della sessione e date di validità; non contiene credenziali. Creazione, rinnovo e rilascio usano commit discendenti e `force:false`. Il runner verifica ownership prima e dopo le chiamate ai modelli e prima del checkpoint.

L'assenza di rete o il lock passato a un altro writer fermano la sessione in modo conservativo. Il browser può essere sospeso: i token già consumati da chiamate in corso non sono recuperabili. Il takeover di lease scaduti richiede una conferma e 60 secondi di margine, ma resta sensibile al clock skew: non è un lock distribuito transazionale perfetto. Non fare modifiche manuali concorrenti senza risolvere i conflitti del canon.

## Autosync del browser (ADR 0006)

La modalità opt-in accoda in IndexedDB gli ID delle operazioni e lo stato dei checkpoint, **mai** API key o PAT. Il marker GitHub `.bookwriter/sync.json` contiene solo ID del libro, ID operazione e revisione; i commit sono in chiaro nella repository del libro. Web Locks impedisce due sincronizzazioni concurrenti sullo stesso origin/browser, ma non è un lease multi-device. Un conflitto del branch ferma la coda. Non usare due autopilot contemporaneamente su due dispositivi. Se il tab è chiuso, l'autosync non prosegue.

## Recupero dei conflitti e protezione delle copie (ADR 0008)

Il confronto legge soltanto snapshot GitHub a commit SHA. La risoluzione crea due copie complete del libro e dei log in IndexedDB, rimuovendo da entrambe il collegamento remoto. Lo storage delle API key e del PAT resta in `settings`: non vengono esportati come metadati del manoscritto.

Il browser controlla i Web Locks, il commit GitHub e il timestamp locale prima della sostituzione. La transazione IndexedDB è atomica **solo nello stesso browser**; un dispositivo differente può avanzare GitHub subito dopo la verifica, nel qual caso il successivo push viene respinto per conflitto SHA. La copia di sicurezza rimane locale: esportare anche uno ZIP esterno. Niente force push, niente fusione cieca di prosa.

## Revisione editoriale indipendente e congelamento (ADR 0011)

Il panel usa richieste separate ai modelli AI: sette specialisti hanno contesti canonici necessari, mentre cinque lettori vedono solo prosa e sinossi pubbliche. Ogni rapporto contiene prova, motivo e remediation verificabile; il direttore editoriale è libero di respingere un rilievo infondato motivando, ma non può ometterlo.

Un capitolo con scene scritte, ma non congelato, impedisce il push manuale e il normale autosync del canon. La riapertura di capitoli prende Web Locks, disabilita l'autosync e invalida le revisioni successive; un browser differente resta vincolato al lease best effort e ai controlli SHA. Non inviare segreti ai lettori ciechi. La review storica NON consulta fonti esterne, quindi i rilievi sono ipotesi e non verifiche certificate.

Questa pipeline può consumare molte chiamate AI (12 per segmento, più giudizio, correzioni e riassunti). Il ledger v0.7.1 mostra token osservati, non saldo residuo né limite economico. Documenta il rischio e non iniziare test su provider reali senza consenso.

## Telemetria dei consumi AI (ADR 0010)

Il pannello `Consumi AI registrati` legge i token e i modelli già memorizzati negli Activity del browser. Non invia alcuna telemetria a server esterni, non legge API key o PAT e non inventa saldi crediti. Dati di attività fallite/interrotte possono essere incompleti anche se una chiamata AI è stata fatturata: mostrare sempre questo limite.

## Laboratorio editoriale con AI (ADR 0009)

Le proposte di fusione delle scene usano l'endpoint/modello `merge` configurato dall'autore. La UI richiede consenso esplicito prima di inviare le due versioni della scena, i vincoli del libro e **la memoria con i segreti** all'endpoint terzo. Le scene remote sono trattate come testo non attendibile nei prompt; il modello può sbagliare nonostante questa barriera, quindi la proposta resta **draft**.

Le proposte sono salvate in `mergeDrafts` (IndexedDB v2), con testi originali e attributi di audit ma senza PAT o API key. Il backup ZIP di contenuti include **scene e segreti in chiaro**, comprese le bozze; va mantenuto privato. Il backup cifrato completo protegge il payload solo se l'autore imposta una passphrase.

L'AI usa Web Locks e lease GitHub, ricontrolla SHA e revisione locale, poi salva la proposta senza modificare il canon. L'approvazione richiede doppio backup e marca la scena come `draft`; nessun push automatico.

## PAT e chiavi modello

- Raccomandare credenziali limitate per repository e revocabili; per GitHub fine-grained PAT con **Contents R/W** sul solo gruppo di repository del libro. Le chiavi OpenAI-compatible possono fatturare: evitare log e invio a domini inattesi.
- Ogni endpoint deve essere HTTPS (eccetto localhost solo in sviluppo); fetch con `redirect: "error"`, nessuna key in query string, errori redatti.
- **Vault locale**: IndexedDB conserva credenziali cifrate con AES-GCM e CryptoKey non estraibile quando disponibile; questo riduce l'esposizione a letture accidentali del DB, non protegge da XSS attivo nello stesso origin.
- **Vault senza password condiviso tra dispositivi**: salvare configurazione/credenziali in storage privato del provider con il suo controllo di accesso. Una chiave recuperabile automaticamente da quello stesso account non rappresenta E2EE: la protezione deriva dall'account e dal servizio cloud.
- **Vault E2EE opzionale**: richiedere passphrase di recupero indipendente; derivazione PBKDF2/Argon2id (secondo disponibilità), salt random, AES-256-GCM, nonce random univoco; nessun hash della password usato direttamente come chiave. La modalità E2EE richiede unlock su nuovo dispositivo.
- Valutare in futuro GitHub App / gateway BFF per togliere il PAT dal browser; necessita di una nuova decisione e infrastruttura.

## Repository del libro

Il canon, le idee e soprattutto i segreti letterari possono essere sensibili: raccomandare repository **private**. Non scrivere PAT, API key, OAuth token o vault nel repo del libro, negli ZIP di soli contenuti, nei commit GitHub Actions o nelle note AI. Se la repo è pubblica, avvisare chiaramente prima della prima sincronizzazione.

## Backup ZIP

Distinguere `book-content.zip` da `full-portable-backup.zip`.
- Content ZIP: dati narrativi, operazioni, checkpoint, logs redatti; **senza credenziali**.
- Backup completo: esportazione esplicita che può includere configurazione/credenziali; default **cifrato con password fornita all'export**. Export non cifrato richiede conferma con avviso, non è abilitato implicitamente.
- All'import validare schema e versioni, file count/size/path, credenziali e repo target; creare snapshot locale prima dell'overwrite, import in staging e commit atomico.

## Altri rischi

XSS e dipendenze compromesse possono rubare credenziali utilizzate in browser. CSP rigorosa compatibile con gli endpoint configurabili (valutare consentire endpoint whitelist per installazione); dependency audit, sanitize HTML/Markdown e nessuna esecuzione di codice AI-generated. CORS dipende dall'endpoint API scelto e può impedire richieste browser anche con URL/API key validi.

## Riferimenti

- https://developers.google.com/workspace/drive/api/guides/appdata
- https://learn.microsoft.com/graph/onedrive-sharepoint-appfolder
- https://learn.microsoft.com/en-us/entra/msal/javascript/browser/about-msal-browser
- https://www.rfc-editor.org/rfc/rfc9700
