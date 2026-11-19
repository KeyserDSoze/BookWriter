# F03 — Retry short-term e long-term condivisi

- Stato: **implementazione locale in preparazione, non rilasciata**; 2026-11-19.
- [ADR 0168](../ADR/0168-short-and-long-term-retry.md) · [Specifica](../docs/retry-policy.md).
- Vale sia per il frontend locale sia per il backend di [F02](F02-personal-server.md); non richiede il server per usare i retry nel browser.

## Consegne previste

- [x] Classificazione e pianificatore condivisi; contatori short/long distinti.
- [x] Politica endpoint, opt-in, minuti, limite/illimitato esplicito, Save/cloud/ZIP full.
- [x] Attesa IndexedDB atomica, annullamento e claim CAS.
- [x] Attesa file e stesso pianificatore; repliche escluse.
- [x] Ripresa con runId/budget originari e guardie/preflight.
- [x] UI impostazioni/attesa, annulla/riprova ora e descrittore puro con stato operativo.
- [ ] Nessuna attesa eseguibile importata da cloud/ZIP/GitHub; handoff e cambi di autorità invalidano la generazione precedente.
- [ ] Audit e usage per tentativo, gestione dei look-ahead ancora attivi e riconciliazione dopo crash prima di ulteriori richieste.

## Scenari di accettazione

1. Con `S=2`, dopo tre richieste fallite si pianifica `M` minuti; prima della scadenza zero nuove richieste. Alla scadenza un solo nuovo gruppo.
2. Con `L=3` si consentono tre ripartenze differite, non quattro; successo rimuove il piano e prosegue. Illimitato solo con scelta distinta.
3. Short-term spento/long-term acceso attende già dopo il primo fallimento; long-term spento conserva lo stop attuale. Legacy senza campi nuovi non acquisisce nuovi consensi.
4. Reload, cambio pagina, sleep o riavvio non azzerano i contatori e non recuperano a raffica gli intervalli mancati. Nessun lavoro browser a pagina chiusa.
5. Due schede o due risvegli simultanei: una sola acquisizione e una sola chiamata; un client del server non risveglia anche il runner browser.
6. Annulla/pausa/disabilitazione/cambio autorità interposti tra timer, claim e fetch impediscono la partenza tardiva. Lock occupato non consuma tentativi.
7. Budget sessione originario esaurito o usage ignoto con budget attivo impediscono la nuova chiamata, anche dopo molte pause; runId e contatori economici non si azzerano.
8. Abort dell'autore, credenziali/configurazione, contesto, lease perso, CAS, quota di storage/checkpoint o blocco editoriale non diventano retry long-term automatici.
9. Rete/provider temporaneamente indisponibile e risposta correggibile seguono soltanto la politica autorizzata, preservano usage noto/ignoto e non indeboliscono i gate.
10. Fallimento del salvataggio del piano, crash prima/dopo il claim e chiamata dall'esito incerto non generano un tentativo duplicato o un falso successo.
11. Edit narrativo o cambio del compito durante l'attesa invalidano il piano vecchio; ACK GitHub innocuo non lo azzera. Nessun riuso di prompt/apply o nota correttiva obsoleti.
12. Minuti/limiti malformati, date invalide e clock alterato falliscono senza troncamento o partenze anticipate; le due implementazioni host producono le stesse decisioni.
13. Politica cloud/ZIP valida importabile senza piano attivo né aumento dell'autorizzazione di run esistenti; niente prompt, segreti o pianificazione nel repo/cloud. Limiti e preferenze locali restano separati.
14. UI desktop/mobile mostra numeri e orari reali, controlli accessibili e stato diverso da una pausa manuale; nessuna Activity AI per il semplice conto alla rovescia.

## Gate e limiti

Unit test con clock virtuale, integrazione IndexedDB/file e Playwright desktop/mobile; per il server anche servizi Linux/Windows e riavvio a metà attesa. Confrontare la stessa sequenza di decisioni nei due adapter. Eventuali prove manuali con provider a pagamento richiedono consenso.

Test aggiunti: `autopilot-long-retry.test.ts`, `personal-server-client.test.ts`, contratti file in `src/server/test/server.test.mjs`, E2E `personal-server.spec.ts`. Non confondere questi test con collaudi di servizi, tunnel o provider reali.

La ripartenza differita è un consenso a nuove richieste potenzialmente addebitate, non prova che quelle fallite siano gratuite né una garanzia di successo. Non estendere la politica a PATCH GitHub, lease o update. Nessuna release frontend effettuata da questa preparazione.
