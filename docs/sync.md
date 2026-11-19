# Contratto di sincronizzazione local-first

> **Implementazione:** la fase 1 **manuale** è in PR #8, l'autosync **opt-in** con outbox in PR #9 e il lease per l'autopilot AI in PR #12. La PR #14 introduce il confronto visuale e il recupero delle differenze con doppio backup locale (ADR 0008). **Dalla 0.14.0** il profilo cloud (Google Drive `appDataFolder` / OneDrive `approot`: impostazioni, vault delle credenziali, elenco dei libri) e l'aggiornamento Git «fast-forward» sono implementati: [ADR 0153](../ADR/0153-cloud-profile-sync-google-drive-onedrive.md), [guida](cloud-profile-sync.md). Le decisioni sono documentate in `docs/github-sync.md`, `ADR/0005-github-manual-sync.md` e `ADR/0006-indexeddb-autosync-outbox.md`. Le sezioni “Discovery su un browser nuovo”, “Write path” e “Lease multi-device” seguenti descrivono in parte il **target architetturale**: outbox e autosync funzionano, ed esiste un lease GitHub best effort per il runner AI; mancano fencing transazionale forte e merge semantico automatico dei testi. La fase corrente importa da GitHub con il PAT (impostato a mano o recuperato dal vault cloud), richiede un primo commit manuale e consente autosync successivo; rifiuta i branch avanzati da altri dispositivi, salvo l'aggiornamento fast-forward di un libro senza modifiche locali.

## Fonti e ruoli

1. **IndexedDB**: archivio operativo; ogni attività salva evento, output e checkpoint immediatamente, prima di dichiarare successo.
2. **Repository GitHub dei libri**: canon portabile e versionato in Markdown/frontmatter, più revisioni, valutazioni e manifest. La repository deve essere privata per bozze non pubbliche.
3. **Google Drive appDataFolder / OneDrive approot** (dalla 0.14.0): piano di controllo dell'account — impostazioni AI, vault delle credenziali ed elenco dei libri con stato —, **mai il testo dei libri**. Vedi [cloud-profile-sync.md](cloud-profile-sync.md) e ADR 0153.
4. **ZIP**: snapshot compatti ad alta velocità di restore; non sostituiscono i commit Markdown e non contengono PAT o chiavi per default.

## Discovery su un browser nuovo

1. L'autore accede con Google o Microsoft e autorizza il relativo app folder.
2. Il profilo cloud restituisce endpoint, model routing, repository configurate e, solo se ha optato per modalità seamless, le credenziali del vault cloud.
3. Si listano le repository autorizzate (solo quelle esplicitamente associate ai libri); si legge `.bookwriter/manifest.json`.
4. Se uno snapshot ZIP ha `schemaVersion` compatibile, `sha256` valido e `remoteCommitSha` verificato, lo si importa in staging; altrimenti si ricostruisce dai Markdown.
5. Si rigiocano i commit successivi / differenze remote fino a `HEAD`; si ricostruiscono indici e stato IndexedDB; si riprendono job sospesi **solo su comando e dopo verifica del lease**.

## Write path

- Ogni stage completato: transazione IDB (output canon/staging, event, summary, checkpoint, outbox event).
- Milestone: completamento scena, capitolo, modifica canon entità, revisione/rollback o modifica al piano; aggregare in un unico commit GitHub, non commit per token.
- `outbox` idempotente con `operationId`, `baseRemoteSha`, `changedPaths`, `contentHashes` e stato.
- Committare soltanto se HEAD corrisponde alla base attesa; in caso contrario pull e reconciliation, conflitto esplicito se stesso path divergente. Mai push `force`.
- Ogni N scene / milestone significativo (configurabile): aggiornare snapshot ZIP, `manifest.json` e relativa checksum; non salvare il solo ZIP a ogni modifica.
- Snapshot non devono diventare un blob non limitato: retention con latest + checkpoint milestone configurabili, dimensioni monitorate, garbage collection con conferma.

## Lease multi-device

Per ogni libro una sola sessione autopilot remota alla volta. `.bookwriter/lease.json` contiene `holderId`, `runId`, `expiresAt`, `baseSha`. Acquisizione/rinnovo in GitHub con optimistic concurrency su SHA e heartbeat ragionevole; controllo lease **prima di ogni write remoto e generazione costosa**. Nessun lavoro remoto quando offline o lease incerto. Un lease scaduto può essere riassegnato con rilettura e conferma all'utente; nessun last-write-wins.

## Freeze di capitolo prima del canon remoto (ADR 0011)

A partire dalla v0.8.0, la review per singola scena non è una milestone canonica sufficiente: dopo un capitolo completo devono intervenire sette specialisti, cinque lettori e un direttore editoriale. Ogni correzione accettata produce nuove verifiche. Soltanto la conclusione positiva e la sinossi congelano il capitolo; la coda autosync allora può inviare il checkpoint. Riaprire un capitolo o avviare una revisione retroattiva invalida il suo freeze e quello dei successivi. Per dettagli vedi `docs/editorial-board.md`.

## Budget per chiamate dei revisori (ADR 0012)

Con opt-in per libro, il preflight stimato consulta tariffario dell'autore, usage dichiarato e riserva per la chiamata seguente, e può fermare il runner prima di contattare il provider. Ogni richiesta inviata viene tracciata in anticipo per non sottostimare chiamate fallite o senza usage. Il budget non è transazionale fra dispositivi e non sostituisce la fattura provider. Vedi `docs/ai-budget.md`.

## Consumi AI e budget (ADR 0010)

La v0.7.1 mostra i token effettivamente riportati dai provider nelle attività del libro, separati per modello ed endpoint. Non è ancora possibile conoscere il saldo crediti attraverso una API generica, né viene imposto un limite economico al runner. Report mancanti, fallimenti e richieste interrotte possono corrispondere a addebiti sconosciuti; vedi `docs/ai-usage.md` e issue #17.

## Proposte non canoniche di fusione (ADR 0009)

La v0.7.0 introduce un task AI `merge` per proporre il testo combinato di una singola scena divergente. La creazione richiede lease GitHub attivo e controlli della revisione locale/HEAD Git; l'output è una bozza in IndexedDB, non una scrittura del canone. L'utente può scrivere senza AI, rifiutare o selezionare una proposta da storico, ma l'applicazione richiede la transazione a doppio backup ADR 0008 e mantiene lo stato `draft`. Il provider non riceve PAT e API key; l'invio di prosa e segreti richiede un consenso esplicito.

## Gestione conflitti

**Implementazione v0.6.0:** l'autore può confrontare scene, sezioni del progetto ed entità canoniche rispetto alla baseline GitHub; per ogni differenza seleziona locale o remoto. Una transazione conserva copie complete di entrambe le versioni, aggiorna il libro locale, azzera l'outbox obsoleta e disattiva autosync. Il commit GitHub non viene modificato fino a un push manuale successivo. Guida `docs/conflict-recovery.md` e ADR 0008. Le regole seguenti includono anche target futuri:

- Entità diverse: merge per file con ID stabili e revalidate.
- Stesso file modificato da due dispositivi: non auto-merge prosa. Presentare `base / locale / remoto`, scelta o merge dell'autore; preservare entrambe le versioni.
- Se un altro dispositivo termina una scena durante il lavoro corrente, fermare l'autopilot e rebase dei checkpoint prima di proseguire.
- Offline: editing locale e outbox pending; nessun autopilot multi-device garantito finché non si ristabilisce lease.

## Migrazione e integrità

Versione schema con migrations incrementali IDB + formato GitHub; indice rigenerabile; hash SHA-256 e checksums per manifest/snapshot; verify prima dell'attivazione. Import staging atomico, backup pre-migrazione, rollback. Nessun token in logs GitHub.

## Osservabilità

UI: `locale salvato`, `in coda per GitHub`, `sincronizzazione in corso`, `sincronizzato (commit SHA)`, `conflitto`, `offline`. Mostrare tempi, retry manuale e causa dell'errore, non presentare stato verde se solo locale.

## Modalità server personale — progetto completo e prima tranche

Il [progetto F02](../features/F02-personal-server.md), deciso in [ADR 0167](../ADR/0167-optional-personal-server-and-shared-engine.md), distingue libro locale e libro affidato al server. Per quest'ultimo il file server è archivio operativo, IndexedDB è replica, e runner, lease **e push GitHub con PAT** girano sul server anche senza browser. I browser non accodano un secondo push per gli stessi checkpoint.

La tranche attuale implementa nuove creazioni sul server e aggiornamenti espliciti delle repliche; **non** il riallineamento automatico completo o la connessione cloud descritti sotto. [Matrice dello stato effettivo](personal-server-development.md).

Riallineamento previsto: **profilo Google/Microsoft → GitHub → server**. Cloud facoltativo, poi verifiche/import sicuri GitHub, poi inventario/snapshot/comandi server. Non è una precedenza dei dati: GitHub vecchio non sovrascrive un server avanti; divergenze conservano entrambe le copie e richiedono riconciliazione. Nuovi libri adottati da client differenti compaiono su tutti i client autorizzati.

Autorità per epoca, revisioni server e comandi idempotenti sostituiscono il confronto per soli orologi fra repliche. La connessione segue il profilo/vault cloud, non il manoscritto. Offline si leggono repliche e si conservano bozze; nessun fallback automatico al runner locale. Il trasferimento di autorità richiede un protocollo confermato.

[Flussi completi, multi-PAT e conflitti](personal-server.md) · [Commit file, eventi e ACK GitHub](personal-server-protocol.md). Accodamento per compito, distanza di due minuti, limiti, `force:false` e controllo SHA restano vincoli anche nel progetto server.
