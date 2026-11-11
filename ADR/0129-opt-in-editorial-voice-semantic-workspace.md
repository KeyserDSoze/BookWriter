# ADR 0129 — Lettura vocale e retrieval semantico locale esplicito

- Stato: accettato
- Data: 2026-11-12
- Issue: #148 embedding, #149 voce; dipende dal catalogo tag #147
- Ambito: strumenti di sola lettura nella pagina Libro; nessuna mutazione del canone

## Contesto

Con più modelli locali l'autore può scegliere un modello embedding e uno voce, ma limitarsi ai tag lascia inutilizzate le capacità. LM Studio supporta ufficialmente `POST /v1/embeddings`, non documenta `/v1/audio/speech`: richiamare il modello Phonon come se fosse TTS OpenAI-compatible sarebbe una falsa promessa.

## Decisione

1. Il lettore vocale MVP usa `SpeechSynthesisUtterance` e le voci del browser per le sole scene canoniche. Offre scelta scena/voce, velocità, play/pause/resume/stop, massimo 5.000 caratteri. Non fa richieste `fetch` né legge bozza, memoria privata o credenziali. Le voci del sistema possono dipendere da servizi online e la disponibilità di italiano varia.
2. Il semantic retrieval è **opt-in a ogni sessione**. `AppSettings.capabilityRoutes.embedding` deve identificare un modello taggato embedding con endpoint loopback letterale localhost/127.0.0.1. Non sono consentite richieste di manoscritto a provider remoti anche se autenticati. Preflight prima della rete e dell'eventuale decrypt.
3. L'indice è costruito da massimo 80 scene `canon` e 1.400 caratteri per scena, in batch di 8 `POST /embeddings`. Il vettore di ricerca viene ottenuto con una chiamata separata; se la famiglia del modello è Nomic Embed Text si usano prefissi document/query. Risposte: MIME JSON, corpo massimo 2 MB, deadline 40 s inclusa lettura, indici unici, dimensionalità finita e non nulla. No redirect/cookie/referrer, nessun retry automatico.
4. Ranking con similarità coseno senza trasformare un numero in un certificato di verità o continuità, risultati collegati alle scene. L'indice non viene persistito, è perso su cambio libro/revisione/navigazione/unmount; niente mutazioni del canone, auto-retrieval, nuovo worker, cron o sync GitHub.
5. La voce configurata come modello resta una preferenza **non usata**: adapter TTS, differenze STT/TTS, lingua, formati e consenso futuro rimangono in #149. Il modello Phonon multilingual non va descritto come supportante italiano o come funzionante su endpoint non documentati.
6. Test Vitest per selezione locale, contenuti minimizzati, JSON ostile, batch e rank; Playwright desktop/mobile per scelta esplicita, niente chiamate prima del clic, speech mock e risultati su scene canoniche. CI, Pages e cleanup stessa HEAD richiesti prima di chiudere issue.

## Non-obiettivi

Nessuna auto-indicizzazione del libro, nessuna memoria semantica persistente, nessuna indicizzazione di bozze/secret, nessuna generazione TTS tramite modello non verificato, nessuna trascrizione o voice cloning, nessun uso delle similarità come giudizio editoriale automatico.
