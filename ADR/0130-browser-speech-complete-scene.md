# ADR 0130 — Lettura integrale per revisione vocale con eventi isolati

- Stato: accettato
- Data: 2026-11-12
- Issue: #151, estensione di #149
- Ambito: Web Speech API, solo pagina Libro; nessuna alterazione del canone

## Problema

La versione iniziale della lettura vocale interrompeva ogni scena al carattere 5.000. Una voce del browser può inoltre bloccarsi o interrompere una utterance e il suo evento finale può arrivare dopo un cambio di scena.

## Decisione

1. Leggere integralmente **solo** `scene.status === "canon"`. Segmentare `scene.text.trim()` per codepoint Unicode in blocchi lunghi massimo 700 caratteri, cercando confini di frase e poi parola. La concatenazione dei blocchi ricostruisce esattamente il testo di partenza ripulito dei soli spazi esterni. Oltre 280.000 codepoint rifiutare con messaggio, senza troncamento implicito.
2. Riprodurre un segmento alla volta. `onend` passa al segmento successivo, mostra il numero del blocco e segnala la conclusione. Pausa/riprendi usa il motore Web Speech.
3. Ogni riproduzione riceve un contatore di generazione: prima di fermare, cambiare scena/voce/libro, aggiornare la revisione o lasciare il lettore, il contatore viene invalidato, quindi i vecchi `onend/onerror` non possono avviare un blocco. Nessun retry o continuazione dopo errore.
4. Nessun API `fetch` o invio deliberato del manoscritto a un modello voce. Le voci Web Speech del browser/OS possono utilizzare servizi online; l'interfaccia deve avvertire. L'adapter TTS/STT effettivo del modello resta in #149.
5. Test: segmentazione reversibile, Unicode, limiti, scene lunghe, nessuna lettura delle bozze, progress, pause/resume/stop e cancellazione delle callback obsolete su Playwright desktop/mobile.

## Conseguenze

Ascolto editoriale completo di una scena senza cambiare canone, prezzi, router AI o sync. Verificare Frontend CI, Pages e cleanup sulla HEAD definitiva prima di chiudere #151.
