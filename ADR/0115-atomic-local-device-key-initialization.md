# ADR 0115 — Inizializzazione atomica della chiave cifrante per dispositivo

- Stato: accettato
- Data: 2026-11-11
- Issue: #122; epic #6/#10; seguito della #121
- Ambito: Web Crypto AES-GCM, IndexedDB meta, chiavi non esportabili; nessun backend

## Problema

La prima cifratura richiedeva get meta -> generateKey -> put meta in tre operazioni asincrone. Due schede o cifrature concorrenti potevano entrambe osservare una chiave assente, generare candidate differenti e poi sovrascriversi. Il cifrato prodotto da una candidata perdente non è più leggibile quando il record meta contiene l'altra chiave. Un lock solo JS non coordina schede diverse.

## Decisione

1. Conservare la stessa chiave di storage `meta["device-encryption-key"]`, la stessa CryptoKey AES-GCM 256 bit non esportabile e i medesimi cifrati `{iv,data}`. Non migrare né sostituire chiavi già presenti.
2. Leggere prima il record in sola lettura come ottimizzazione. Se manca, generare una candidata non esportabile **prima di aprire una transazione IDB di scrittura**: Web Crypto potrebbe sospendere il codice e far auto-committare una transazione inattiva.
3. Aprire `db.transaction("meta","readwrite")`. Nella **stessa transazione** leggere nuovamente il record: se già presente, usarlo e ignorare la candidata; se assente, inserirla con `add` e non `put`. Attendere sempre `tx.done` prima di restituire la chiave all'encrypt. IndexedDB serializza le transazioni readwrite confliggenti sullo store, anche fra schede della medesima origine: non esistono due candidati committati.
4. Un errore di IndexedDB, WebCrypto o una vecchia chiave già corrotta fallisce in modo conservativo. `decryptLocal` comunica che la credenziale deve essere reinserita nell'app senza riportare payload, IV, token o stack del provider. **Non** tentare di ricostruire la vecchia chiave da un ciphertext né sovrascrivere automaticamente un record esistente.
5. Nessuna chiave di cifratura è sincronizzata su GitHub/ZIP dei libri, né esportata; il browser che può eseguire BookWriter può ancora decifrare (non è E2EE). Le transazioni IndexedDB isolano schede della **stessa origine**, non dispositivi indipendenti.

## Prove e limiti

Vitest con molte `encryptLocal` in parallelo su IndexedDB vuoto, cifrati leggibili con `decryptLocal`, chiave non esportabile, cifrati precedenti ancora compatibili e record corrotto non sostituito. E2E Playwright desktop/mobile: due schede simultanee con chiamate generateKey ritardate deterministicamente, rilascio concorrente, cifrati recuperabili anche dopo reload, senza credenziali reali o chiamate esterne.

La correzione evita nuove perdite di chiavi da questo difetto. Non può recuperare vecchi cifrati effettivamente creati con una candidata sovrascritta: occorre reinserire le relative credenziali.
