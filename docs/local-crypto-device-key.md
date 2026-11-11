# Chiave di cifratura locale unica — issue #122

BookWriter protegge le credenziali salvate nel dispositivo con AES-GCM di Web Crypto e una chiave non esportabile in IndexedDB (`meta["device-encryption-key"]`). È una difesa delle credenziali nello storage, **non una E2EE**, e non protegge da JavaScript ostile eseguito nel browser.

## Più schede al primo utilizzo

Due schede potrebbero salvare contemporaneamente una chiave API appena inserita. L'inizializzazione controlla la chiave persistita, prepara eventualmente una candidata AES-GCM 256 bit e poi, **nella stessa transazione IndexedDB readwrite**, cerca nuovamente una chiave già presente: se c'è, usa quella; se non c'è, inserisce la candidata senza mai sovrascrivere. Attende la conferma del commit prima di cifrare il testo. In questo modo tutte le cifrature di quella origine usano la **stessa chiave salvata**, anche dopo un reload. Le chiavi non vengono inviate al server, a GitHub, a un modello AI né esportate nei documenti del libro.

## Se una vecchia credenziale non si decifra

Se una credenziale salvata in passato è stata cifrata con una chiave ormai persa, BookWriter mostra un errore che richiede di **reinserire la credenziale nelle Impostazioni**. Nessun software può recuperare da solo quella chiave persa a partire dal solo ciphertext; non è corretto dichiarare recupero automatico. Conserva eventuali backup già in tuo possesso e verifica che la nuova chiave funzioni prima di procedere con lavori che potrebbero generare costi.

La sincronizzazione tra dispositivi usa meccanismi distinti; questa transazione riguarda soltanto il database IndexedDB della medesima origine web.

Riferimenti: [ADR 0115](../ADR/0115-atomic-local-device-key-initialization.md), [issue #122](https://github.com/KeyserDSoze/BookWriter/issues/122), [regole per agenti](../AGENTS.md).
