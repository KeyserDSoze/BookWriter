# E2E Unicode editoriale e persistenza delle impostazioni (v0.11.73)

## Sintomo

Il test `editorial-grapheme-segmentation.spec.ts` alimenta una scena di oltre 10.000 unità UTF-16 con il grafema emoji `👩‍💻` esattamente sul confine. In alcune esecuzioni di GitHub Actions il test non osservava i due prompt di revisione: `reviews.length` era zero dopo 30 secondi, mentre altri test di autopilot continuavano a funzionare.

## Causa e soluzione

Nel test il click su **Salva impostazioni** era seguito immediatamente da `page.reload()`. Il click Playwright aspetta l'evento DOM, ma il callback React avvia `saveEndpointSettings()` senza attendere l'operazione: l'handler deve cifrare la chiave API mock via WebCrypto e poi scrivere `settings/global` in IndexedDB. Su runner più veloce, il reload poteva interrompere l'operazione e il nuovo autopilot non aveva la chiave e/o il modello necessari.

Ora il test deve:
1. Attendere la conferma UI esatta `Impostazioni salvate in IndexedDB.`, emessa dopo `await saveSettings`.
2. Verificare in IndexedDB il model ID atteso e **solo la presenza** di un secret cifrato (mai leggere o loggare credenziali).
3. Ricaricare e ripetere il controllo di persistenza prima di premere **Riprendi**.
4. Intercettare i primi due prompt del provider mock, verificare limite 10k, ricomposizione lossless e grafema ZWJ intero; mantenere la diagnostica di errore solo in caso di fail.

## Portata

Il difetto è nella sincronizzazione del **fixture Playwright**, non si introduce un ritardo artificiale né si cambia il trattamento delle chiavi degli utenti o il comportamento dell'autopilot. I riscontri a runtime non dimostrano da soli la causa di ogni fail storico; il percorso di salvataggio e l'assenza di un await identificano una race concreta. Dopo la modifica occorre verificare più run CI completi desktop/mobile.

[ADR 0105](../ADR/0105-editorial-test-settings-persistence.md) · [Issue #110](https://github.com/KeyserDSoze/BookWriter/issues/110) · [Epic #6](https://github.com/KeyserDSoze/BookWriter/issues/6).
