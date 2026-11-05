# ADR 0003 — Markdown canon su GitHub, ZIP snapshot, IndexedDB

- **Stato**: Accettato
- **Data**: 2026-11-05

## Contesto

Serve sincronizzazione efficiente tra dispositivi, piena cronologia di scrittura e compatibilità con Book.Jesus/Narrarium. Salvare solo ZIP a ogni modifica renderebbe opachi i diff e costosi i push.

## Decisione

IndexedDB per evento/attività/checkpoint; GitHub come source of truth remoto del canon Markdown con commit per milestone; ZIP periodici e versionati per restore rapido (contenuti senza credenziali). File `.bookwriter/manifest.json` con schemaVersion, head/logical revision, snapshot hash e mapping book. Outbox idempotente, SHA optimistic concurrency, conflict resolution esplicita. Lease cross-device per un solo autopilot scrivente.

## Conseguenze

Diff, rollback e reader Narrarium preservati; meno churn da blob ZIP. Maggiore complessità di import/migrazione e risoluzione conflitti. Nessun write a GitHub senza autorizzazione utente e repository target verificata. Evitare dati di credenziali in Git/ZIP content.
