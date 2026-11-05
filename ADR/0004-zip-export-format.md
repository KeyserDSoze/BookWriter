# ADR 0004 — Backup ZIP portabile e separazione credenziali

- **Stato**: Accettato
- **Data**: 2026-11-05

## Contesto

Il sistema è local-first, opera in IndexedDB e deve essere portabile su un altro browser. La chiave Web Crypto non estraibile usata per cifrare le API key nel dispositivo non va copiata e non potrebbe decifrare il database altrove.

## Decisione

Due tipi di ZIP:

1. `content`: include tutti i libri, log e checkpoint, esclude sempre configurazioni e credenziali.
2. `full`: include anche endpoint, routing dei modelli e API key; il payload è cifrato prima della compressione (PBKDF2-SHA256 310.000 iterazioni, salt casuale, AES-256-GCM, nonce casuale) se è fornita una passphrase di almeno 12 caratteri. Un export senza password richiede conferma esplicita con avviso.

Il file ZIP contiene `manifest.json` e un payload `content.json`, `vault.enc.json` o `vault.json`. **Non è crittografia ZIP tradizionale**: la password protegge il payload JSON, che BookWriter decifra quando importa lo ZIP. All'import, le API key vengono cifrate nuovamente con la chiave del browser di destinazione.

La procedura d'import è additiva: duplica gli ID dei libri e degli eventi, salvaguarda i progetti locali, valida schema/versione e dimensioni massime. L'utente sceglie separatamente se importare le configurazioni sovrascrivendo quelle locali.

## Conseguenze

Esportazione portabile senza passphrase per soli contenuti. Per le API key serve passphrase se si vuole che la copia resti sicura fuori dal browser. L'importazione in chiaro di un full backup espone i segreti: usare soltanto con piena consapevolezza. I ZIP content sono pensati per contenuti riservati: conservarli in uno storage accessibile solo all'autore.
