# ADR 0002 — Identità cloud e vault credenziali

- **Stato**: Accettato con threat model esplicito
- **Data**: 2026-11-05

## Contesto

Niente password iniziale. L'autore vuole Google o Microsoft per recuperare PAT GitHub, endpoint e chiavi AI su dispositivi diversi automaticamente.

## Decisione

Google OAuth + Google Drive appDataFolder oppure MSAL SPA + Microsoft Graph OneDrive approot, come provider di configurazione e bootstrap. Gli account restano distinti salvo collegamento esplicito. Il vault locale usa WebCrypto AES-GCM e non estrae le key salvo caso d'uso esplicito. Modalità seamless: l'account cloud può recuperare le credenziali, quindi è protetto dall'account/cloud **non è E2EE**. Modalità opzionale realmente E2EE con passphrase indipendente da usare anche su nuovi dispositivi. Conservare il PAT solo in storage applicativo privato, mai nel repo narrativo.

## Conseguenze

L'autore può passare da mobile a desktop senza password aggiuntiva in modalità seamless; accetta però il rischio del provider cloud e dei token nel runtime del browser. Per privacy forte serve passphrase. La login non protegge l'accesso al codice statico Pages. PAT fine-grained per sole repository e revocabile. Nessun `PASSWORD` GitHub Actions secret richiesto.
