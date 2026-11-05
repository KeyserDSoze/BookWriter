# Avvio locale e prime prove

## Requisiti

Node.js 22+, npm, browser moderno con IndexedDB/Web Crypto. Repository privata raccomandata per i libri inediti.

```sh
cd src/frontend
npm install
npm run dev
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

Aprire l'indirizzo Vite locale. Non serve un server applicativo. Per GitHub Pages, abilitare **Settings → Pages → Source: GitHub Actions** e fare merge su `main`; il workflow imposta Vite base `/BookWriter/`.

## Cosa funziona in questa prima versione

- UI responsive con navigazione desktop e mobile, tema chiaro/scuro.
- Creazione libro da un brief in linguaggio naturale, salvataggio in IndexedDB.
- Endpoint OpenAI-compatible multipli con chiave cifrata localmente via AES-GCM; configurazione modello default e routing per attività/alcuni override per libro.
- Autopilot browser: brainstorming, validazione, 5 audience review, adversarial, outline JSON validato, prosa scena per scena, review e aggiornamento di un canon strutturato.
- Log delle attività con output, modello, timestamp, riepilogo preliminare e stop su errore API.
- Pausa/ripresa, checkpoint persistente dopo ogni stage e richiesta autore che determina analisi d'impatto e revisione retroattiva di scene già canoniche.
- Lettore e atlante della memoria narrativa.

## Backup ed esportazioni

La pagina **Archivio** esporta e importa ZIP content-only (senza credenziali) o full backup. I backup full possono essere cifrati con passphrase AES-GCM; l'export in chiaro ha un avviso forte e una conferma. I libri importati vengono duplicati, senza cancellare gli originali. PDF, EPUB e DOCX sono generati localmente dalla prosa canonica: copertine, immagini e layout editoriale avanzato sono ancora da realizzare.

## Non ancora implementato

- Login OAuth Google o Microsoft e vault remoto multi-device.
- GitHub PAT, sincronizzazione Markdown, lease tra dispositivi e snapshot ZIP.
- Nessuno: ZIP import/export e output EPUB, PDF e DOCX sono disponibili in questa fase; da aggiungere validazione editoriale avanzata, cover e immagini.
- Recupero granulare da tutte le condizioni di crash, generazione summaries via modello economico dedicato, budget guard, ricerca fattuale con fonti, diff/rollback visuale.
- Conversione completa delle entità/memory nel formato Markdown Narrarium; attualmente vivono nel modello IDB.\n- Enforcement rigoroso delle soglie di segreto, valutazioni factual con ricerche esterne e ricostruzione totale del canon dopo riscritture profonde.
- Copertura dei test browser da ampliare per Safari iOS, Chrome Android e provider AI reali; i primi test Playwright Chromium desktop/mobile verificano navigazione, backup e reload.

Non usare questa versione per contenuti di valore senza esportazione manuale o backup dei dati del browser: IndexedDB può essere cancellato.

## API e modello

In **Impostazioni**, fornire un `Base URL` HTTPS OpenAI-compatible che esponga `POST /chat/completions`; la API deve accettare chiamate CORS dal browser. Impostare la chiave API e un ID modello nella route di default, poi salvare. Alcuni provider non espongono `GET /models`; l'ID si può inserire manualmente. Ogni risposta JSON strutturata deve aderire al formato richiesto; in caso contrario il task si arresta e il log riporta il motivo.

La chiave non viene inserita nel repository né in segreti Actions; è cifrata nel database locale con una chiave non estraibile conservata nello stesso IndexedDB. È una protezione di storage accidentale, **non E2EE** e non resiste a un attaccante con capacità di eseguire JS sulla pagina.

## Stato reale

Questa è una **base di sviluppo**. Non sono stati eseguiti test end-to-end in questa sessione né sono stati testati i flussi con credenziali utente. Controllare la CI prima di considerare la build utilizzabile.
