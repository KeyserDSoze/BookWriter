# UX responsive e flussi

## Pagine

- **Accesso**: “Continua con Google” e “Continua con Microsoft” oppure “Modalità locale” (facoltativa, senza sync cloud), spiegando che accesso non oscura il sito statico. Le connessioni OAuth abilitano i servizi cloud.
- **Libreria**: libri locali/remoti, ultima modifica, provider cloud, stato sync, import da repository, nuovo libro.
- **Nuovo libro**: due strade — da un'idea (anche solo titolo e una frase, numero di capitoli facoltativo) o da una sinossi capitolo per capitolo vincolante con anteprima dei capitoli rilevati; stile, audience e pausa facoltativa per approvare il piano.
- **Dashboard**: pannello «Lavoro dell'autopilot» con fasi, avanzamento, cosa sta facendo/perché/poi o prossimo passo, streaming con diagnostica richiudibile; pannello «Intervieni sull'autopilot» con le tre modalità e il registro degli interventi; ultimi task; sezione richiudibile con brief, redazione, costi, memoria e sincronizzazione.
- **Attività**: log ad albero fase > azione, summary e output, avanzamento osservabile; feedback contestuale e “correggi questo”.
- **Libro**: reader a capitoli e scene, diff, edit, canon e anteprima EPUB/PDF/DOCX.
- **Atlante**: personaggi, luoghi, fazioni, oggetti, timeline, segreti (author-only) e conoscenza per capitolo.
- **Idee**: long/mid/short, proposte, voti cinque reader personas, adversarial review, decisioni motivate e scarti.
- **Settings**: endpoint OpenAI-compatible multipli; models; router per attività e libro; budget, credenziali, provider cloud, PAT, privacy.
- **Import / Export**: ZIP contenuti/backup completo, password opzionale con avviso, test restore, stato remoto.

## Mobile

- Navigazione mobile a tab sticky in alto, sempre accessibile durante la lettura e i form, con sei sezioni principali.
- Header compatto con stato autopilot persistente; barra “Sto facendo: [attività]” sticky con tap per dettagli.
- “Pausa”, “Intervieni” e “Riprendi” raggiungibili con un pollice; touch target minimo 44x44, form fullscreen e textarea con autosize.
- Lettore con tipografia adattiva, indice capitoli a drawer, revisione su dettaglio separato e tasto per tornare alla posizione di lettura.
- Log a timeline verticale filtrabile, non tabelle orizzontali.
- Se browser mobile diventa inattivo, spiegare lo stato sospeso e il resume da ultimo checkpoint.
- Tema chiaro/scuro/di sistema, aria-live sobrio, focus e navigazione tastiera, reduced motion, contrasto WCAG.

## Stati obbligatori visibili

`idle`, `planning`, `running`, `pause requested`, `paused`, `needs author`, `error`, `completed`, `offline`, `sync pending`, `sync conflict`.

Mai mostrare un finto completamento: distinguere task eseguito, testo generato ma non validato, testo canonizzato e commit sincronizzato.
