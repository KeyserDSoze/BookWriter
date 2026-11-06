# ADR 0023 — Riverifica remota OCR Library of Congress e quarantena volontaria

- **Stato:** Accettato per v0.10.0 (PR #35)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessori:** ADR 0021–0022; confronto analogo Wikisource in ADR 0020.

## Problema

La v0.9.9 legge, con consenso, un breve passaggio OCR da un file .txt istituzionale LoC e salva SHA-256 del contenuto intero, lunghezza, URL, offset e breve frase citata. Un backup ZIP/JSON importato può però contenere fingerprint inventati o passaggi modificati. La validità strutturale dello snapshot non equivale a un nuovo controllo contro il servizio LoC; le citazioni non devono essere presentate come autenticazioni certificate.

## Decisione

1. **Riverifica volontaria per uno snapshot `lococr:` attivo.** Il pannello mostra «Riverifica OCR online». Il dialogo esplicita l'ID pubblico, l'URL istituzionale del file, i due host, assenza di invio di romanzo, hash, quote, query, diritti attestati, API key o PAT e il carattere effimero del risultato. Solo dopo consenso il browser effettua l'audit.
2. **Mai fidarsi del solo `textUrl` importato.** Prima GET canonica `https://www.loc.gov/item/<itemId>/?fo=json` con ID pagina corrispondente. Si ricostruisce la lista ammessa di `resources[].fulltext_file|fulltext_derivative|djvu_text_file` sottoposta allo stesso filtro sicurezza della v0.9.9: `https://tile.loc.gov/storage-services/{service|master}/... .txt`, senza query/fragment/userinfo, niente host terzi, download/accesso/diritti ristretto o flag malformati. La fonte storica si può ricontrollare solo se **il suo esatto `textUrl` è ancora fra i collegamenti ammessi** del dettaglio LoC. Mai seguire link nuovi o ritirati in modo automatico.
3. **Seconda GET soltanto su file ancora ammesso.** I limiti sono gli stessi dell'acquisizione: timeout 12 s/GET, HTTPS, `credentials=omit`, redirect `error`, referrer `no-referrer`, cache `no-store`, JSON 240 KB e testo 160 KB massimi in streaming. Si respingono contenuti HTML/XML/JSON mascherati da OCR. Il file è letto solo in memoria per l'audit, non registrato come copia integrale.
4. **Confronto:** identità documento (`identity`), presenza esatta del file ammesso (`resource`), hash SHA-256 **del testo UTF-8 effettivamente ricevuto**, lunghezza UTF-16 (`digest`) e sottostringa letterale alla posizione originaria (`excerpt`). Esito `matches=true` solo se **tutti** coincidono. I risultati sono effimeri e non modificano IndexedDB/ZIP/GitHub; la schermata non conserva un «verde» dopo ricaricamento. Errore HTTP/CORS/timeout/JSON/nessuna disponibilità API/access restriction NON è un esito di verifica positiva né un'affermazione di falsificazione: messaggio di errore, nessun salvataggio.
5. **Seconda decisione autonoma dell'autore.** Se esiste una discordanza verificata, il pannello mostra un avviso e offre «Escludi OCR discordante» con **secondo dialogo esplicito**. Solo questa operazione rimuove l'ID da `locOcr.activeExcerptIds`: snapshot, citazioni/report precedenti, scene e versioni storiche restano intatti. Se il capitolo è frozen, si recupera la sinossi anteriore, si eliminano i freeze del capitolo e dei successivi e si avvia una nuova review. AutoSync off, outbox cancellata e activity registrata atomicamente.
6. **Concorrenza e privacy.** Web Locks `bookwriter:writer:<bookId>` e `bookwriter:github-outbox`, confronto CAS `updatedAt` dentro la transazione IndexedDB, libro non running e nessun ciclo editoriale attivo. Niente rete nell'operazione di quarantena. Il risultato del confronto resta solo nella UI e **non** diventa `rightsStatus=verified` o `evidenceStatus=authenticated`.
7. **Giudice:** nessuna certificazione automatica di verità storica o diritto d'autore. Le nuove review continuano a trattare `lococr:` come OCR non autenticato; un confronto positivo prova soltanto la corrispondenza al testo restituito durante la consultazione. I dati esterni non vengono promossi a istruzioni del modello; solo storico e giudice vedono la breve citazione.

## Limiti e decisioni aperte

- Una risposta LoC con link sparito o catalogo rinominato può causare discrepanza senza che l'opera originale sia falsa. L'autore verifica personalmente il documento. Una restrizione di download sopraggiunta blocca la seconda GET: non aggirarla.
- L'hash è calcolato dal browser, **non firmato dalla Library** e non autentica scansioni, edizioni storiche, attribuzione, qualità OCR, licenza, diritto di ripubblicare o cronologia originale.
- Un backup alterato può falsificare contemporaneamente URL, estratto e fingerprint. L'audit ricostruisce la relazione tra item e URL prima di scaricare, e confronta il testo remoto senza credere al backup; non garantisce però che lo stesso OCR corrisponda all'immagine originale.
- L'azione è opt-in, non automatica prima di ogni review, per evitare rete non consensuale e consentire lavoro offline. Non è una certificazione di affidabilità storica. CORS e disponibilità live non sono garantite da test con API simulate.
- Il controllo dei diritti e il confronto OCR/immagine originale rimangono aperti nell'issue #23.

## Accettazione

- Richiesta solo con consenso e per una fonte attiva, due sole GET agli host LoC fissi, nessun segreto trasmesso.
- La URL archiviata deve essere ancora nella lista ammessa del record corrente; nessuna risorsa revocata/ristretta viene scaricata.
- Hash/lunghezza/offset/frase confrontati sul testo attuale, errori di rete distinti da mismatch.
- Solo previa conferma ulteriore si disattiva la fonte; rewind protetto e storico immutabile.
- Vitest reti/backup alterati/URL/diritti/CAS/freeze, Playwright desktop e mobile, CI sulla HEAD definitiva, deploy e cleanup.
