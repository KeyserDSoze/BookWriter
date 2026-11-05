# Contratto di sincronizzazione local-first

> **Implementazione:** la fase 1 **manuale** è in PR #8 e l'autosync **opt-in** con outbox in PR #9. Le decisioni sono documentate in `docs/github-sync.md` e `ADR/0005-github-manual-sync.md`. Le sezioni “Discovery su un browser nuovo”, “Write path” e “Lease multi-device” seguenti descrivono in parte il **target architetturale**: outbox e autosync ora funzionano, ma non esistono ancora lease distribuiti, merge o credenziali cloud. La fase corrente importa da GitHub con PAT impostato localmente, richiede un primo commit manuale e consente autosync successivo; rifiuta i branch avanzati da altri dispositivi.

## Fonti e ruoli

1. **IndexedDB**: archivio operativo; ogni attività salva evento, output e checkpoint immediatamente, prima di dichiarare successo.
2. **Repository GitHub dei libri**: canon portabile e versionato in Markdown/frontmatter, più revisioni, valutazioni e manifest. La repository deve essere privata per bozze non pubbliche.
3. **Google Drive appDataFolder / OneDrive approot**: profilo di bootstrap/account e vault credenziali, non gli interi libri per default.
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

## Gestione conflitti

- Entità diverse: merge per file con ID stabili e revalidate.
- Stesso file modificato da due dispositivi: non auto-merge prosa. Presentare `base / locale / remoto`, scelta o merge dell'autore; preservare entrambe le versioni.
- Se un altro dispositivo termina una scena durante il lavoro corrente, fermare l'autopilot e rebase dei checkpoint prima di proseguire.
- Offline: editing locale e outbox pending; nessun autopilot multi-device garantito finché non si ristabilisce lease.

## Migrazione e integrità

Versione schema con migrations incrementali IDB + formato GitHub; indice rigenerabile; hash SHA-256 e checksums per manifest/snapshot; verify prima dell'attivazione. Import staging atomico, backup pre-migrazione, rollback. Nessun token in logs GitHub.

## Osservabilità

UI: `locale salvato`, `in coda per GitHub`, `sincronizzazione in corso`, `sincronizzato (commit SHA)`, `conflitto`, `offline`. Mostrare tempi, retry manuale e causa dell'errore, non presentare stato verde se solo locale.
