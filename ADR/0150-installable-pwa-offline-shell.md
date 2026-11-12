# ADR 0150 — App installabile (PWA), guscio offline e limiti del lavoro in background

- Stato: accettato
- Data: 2026-11-12
- Ambito: `manifest.webmanifest`, `sw.js`, icone, pulsante «Installa app», richiesta di storage persistente

## Decisione

BookWriter è installabile come PWA su desktop e smartphone (manifest standalone, icone 192/512/maskable PNG). Un service worker **minimo** serve da cache solo il guscio statico dell'app, per riaprirla offline: l'archivio dei libri è già in IndexedDB.

- Il service worker gestisce **solo richieste GET same-origin**: navigazione network-first (un deploy è visibile subito; la copia in cache serve solo offline) e `/assets/*` cache-first (file con hash, immutabili). POST e richieste cross-origin (provider AI, GitHub, Google, Microsoft, Crossref, Wikipedia, LoC, LM Studio) **non passano mai** dal worker: header `Authorization` e streaming restano intatti.
- Il worker si registra solo in produzione. Il server di sviluppo e i test E2E non lo usano.
- In modalità installata si chiede `navigator.storage.persist()` (best effort, senza prompt in Chromium) per ridurre il rischio di eviction dell'archivio locale.
- Il pulsante «Installa app» compare solo se il browser emette `beforeinstallprompt` (Chromium/Android); su iOS si usa «Aggiungi a Home».

## Cosa NON fa (limite dichiarato)

Installare la PWA **non** crea un lavoro in background. L'autopilot gira nella pagina: oggi tiene un Web Lock e uno Wake Lock dello schermo finché la scheda è visibile.

- Desktop: una scheda in background continua a ricevere le risposte di rete; i timer possono essere rallentati e il browser può congelare o scartare schede inattive. Se la scheda viene scartata o chiusa, al riavvio l'autopilot risulta in pausa e riprende dal checkpoint.
- Smartphone: con l'app in secondo piano o lo schermo spento il sistema sospende la pagina. Un service worker non può sostituirla: Background Sync / Periodic Sync hanno finestre di decine di secondi, mentre una chiamata AI locale o con ragionamento dura minuti. Inoltre un endpoint LM Studio su `localhost` non è raggiungibile da un altro dispositivo.
- Un vero lavoro continuo a browser chiuso richiede un componente server o un runner headless (esclusi dall'ADR 0001) e va deciso con un ADR separato.

## Verifica

Test smoke su manifest/icone/worker; verifica manuale in Chromium sul build di produzione: worker attivato, manifest raggiungibile, ricarica offline riuscita.
