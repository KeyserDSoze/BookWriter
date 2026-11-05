# UX responsive e flussi

## Pagine

- **Accesso**: “Continua con Google” e “Continua con Microsoft” oppure “Modalità locale” (facoltativa, senza sync cloud), spiegando che accesso non oscura il sito statico. Le connessioni OAuth abilitano i servizi cloud.
- **Libreria**: libri locali/remoti, ultima modifica, provider cloud, stato sync, import da repository, nuovo libro.
- **Nuovo libro**: brief libero esteso, materiale di ricerca, temi, vincoli, lunghezza, stile, POV, audience, lingua e piano capitoli opzionale.
- **Dashboard**: autopilot, progressi, task corrente e prossimo, costi, sincronia, criticità, suggerimenti.
- **Attività**: log ad albero fase > azione, summary e output, avanzamento osservabile; feedback contestuale e “correggi questo”.
- **Libro**: reader a capitoli e scene, diff, edit, canon e anteprima EPUB/PDF/DOCX.
- **Atlante**: personaggi, luoghi, fazioni, oggetti, timeline, segreti (author-only) e conoscenza per capitolo.
- **Idee**: long/mid/short, proposte, voti cinque reader personas, adversarial review, decisioni motivate e scarti.
- **Settings**: endpoint OpenAI-compatible multipli; models; router per attività e libro; budget, credenziali, provider cloud, PAT, privacy.
- **Import / Export**: ZIP contenuti/backup completo, password opzionale con avviso, test restore, stato remoto.

## Mobile

- Navigazione bottom bar per 4 aree principali e menu sheet per altre.
- Header compatto con stato autopilot persistente; barra “Sto facendo: [attività]” sticky con tap per dettagli.
- “Pausa”, “Intervieni” e “Riprendi” raggiungibili con un pollice; touch target minimo 44x44, form fullscreen e textarea con autosize.
- Lettore con tipografia adattiva, indice capitoli a drawer, revisione su dettaglio separato e tasto per tornare alla posizione di lettura.
- Log a timeline verticale filtrabile, non tabelle orizzontali.
- Se browser mobile diventa inattivo, spiegare lo stato sospeso e il resume da ultimo checkpoint.
- Tema chiaro/scuro/di sistema, aria-live sobrio, focus e navigazione tastiera, reduced motion, contrasto WCAG.

## Stati obbligatori visibili

`idle`, `planning`, `running`, `pause requested`, `paused`, `needs author`, `error`, `completed`, `offline`, `sync pending`, `sync conflict`.

Mai mostrare un finto completamento: distinguere task eseguito, testo generato ma non validato, testo canonizzato e commit sincronizzato.
