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

## Autosync del browser (ADR 0006)

La modalità opt-in accoda in IndexedDB gli ID delle operazioni e lo stato dei checkpoint, **mai** API key o PAT. Il marker GitHub `.bookwriter/sync.json` contiene solo ID del libro, ID operazione e revisione; i commit sono in chiaro nella repository del libro. Web Locks impedisce due sincronizzazioni concurrenti sullo stesso origin/browser, ma non è un lease multi-device. Un conflitto del branch ferma la coda. Non usare due autopilot contemporaneamente su due dispositivi. Se il tab è chiuso, l'autosync non prosegue.

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
