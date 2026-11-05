# ADR 0001 — SPA local-first su GitHub Pages

- **Stato**: Accettato
- **Data**: 2026-11-05

## Contesto

Serve un'app autonoma, mobile e desktop, con costi infrastrutturali minimi, IndexedDB persistente e deployment nella repository BookWriter su GitHub Pages.

## Decisione

React + TypeScript + Vite + shadcn/ui, distribuiti staticamente. IndexedDB è la cache operativa/working database; engine AI nel tab aperto, con checkpoint persistenti. Separare codice di dominio, orchestrazione, storage e UI. Nessuna credenziale nei bundle.

## Conseguenze

Installazione semplice e deploy continuo. Impossibile nascondere il JS o proteggere API key lato browser da script maligni. Impossibile garantire autopilot continuato a tab chiuso o su mobile sospeso. Un worker/server autonomo richiede un futuro ADR con backend e modello di sicurezza dedicato.
