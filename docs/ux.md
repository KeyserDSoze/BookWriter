# UX responsive e flussi

## Navigazione

- **Libreria** da sola; poi tre gruppi: **Scrittura** (Dashboard, Libro, Mondo, Revisioni), **Controllo** (Attività, Costi, Archivio), **Configurazione** (Modelli e redazione: solo questo libro; Impostazioni: tutti i libri). Revisioni mostra quante modifiche attendono; un punto verde indica l'autopilot al lavoro.
- Una sola intestazione per pagina: gruppo, titolo, a cosa serve la pagina, libro attivo e tema. La barra dell'autopilot compare nelle pagine del libro, non in Libreria e Impostazioni.
- Gli indirizzi sono veri percorsi (`/worldbuilding`, `/revisioni`, `/costi`…, con `?book=`); i vecchi `#/` si riscrivono. Su desktop il menu laterale si **comprime alle icone** (pulsante in alto): sul passaggio del mouse compare solo il nome, riaprendolo si vede tutto; la scelta si ricorda su questo dispositivo, la barra del telefono non cambia.
- Le due pagine di configurazione sono divise in schede, ricordate nell'indirizzo (`?tab=`): Impostazioni → Modelli AI, Account e cloud, Conversazioni AI, Questo dispositivo, Server personale (sperimentale); Modelli e redazione → Modelli, Redazione, Ricerca web.

## Pagine

- **Accesso**: “Continua con Google” e “Continua con Microsoft” oppure “Modalità locale” (facoltativa, senza sync cloud), spiegando che accesso non oscura il sito statico. Le connessioni OAuth abilitano i servizi cloud.
- **Libreria**: libri locali/remoti, ultima modifica, provider cloud, stato sync, import da repository, nuovo libro.
- **Nuovo libro**: due strade — da un'idea (anche solo titolo e una frase, numero di capitoli facoltativo) o da una sinossi capitolo per capitolo vincolante con anteprima dei capitoli rilevati; stile, audience e pausa facoltativa per approvare il piano.
- **Costi**: budget AI del libro, tariffe, ledger CSV, storico per task e consumi registrati; la Dashboard mostra solo una sintesi con collegamento.
- **Dashboard**: pannello «Lavoro dell'autopilot» con fasi, avanzamento, cosa sta facendo/perché/poi o prossimo passo, streaming con diagnostica richiudibile; pannello «Intervieni sull'autopilot» con le tre modalità e il registro degli interventi; ultimi task; sezione richiudibile con brief, redazione, costi, memoria e sincronizzazione.
- **Attività**: log ad albero fase > azione, summary e output, avanzamento osservabile; feedback contestuale e “correggi questo”.
- **Libro**: reader a capitoli e scene, diff, edit, canon e anteprima EPUB/PDF/DOCX.
- **Atlante**: personaggi, luoghi, fazioni, oggetti, timeline, segreti (author-only) e conoscenza per capitolo.
- **Idee**: long/mid/short, proposte, voti cinque reader personas, adversarial review, decisioni motivate e scarti.
- **Settings**: endpoint OpenAI-compatible multipli; models; router per attività e libro; budget, credenziali, provider cloud, PAT, privacy.
- **Import / Export**: ZIP contenuti/backup completo, password opzionale con avviso, test restore, stato remoto.

## Mobile

- Barra di navigazione sticky in alto con **tutte** le pagine, nome intero, separatori fra i gruppi; scorre di lato e tiene in vista la pagina aperta.
- Header compatto con stato autopilot persistente; barra “Sto facendo: [attività]” sticky con tap per dettagli.
- “Pausa”, “Intervieni” e “Riprendi” raggiungibili con un pollice; touch target minimo 44x44, form fullscreen e textarea con autosize.
- Lettore con tipografia adattiva, indice capitoli a drawer, revisione su dettaglio separato e tasto per tornare alla posizione di lettura.
- Log a timeline verticale filtrabile, non tabelle orizzontali.
- Se browser mobile diventa inattivo, spiegare lo stato sospeso e il resume da ultimo checkpoint.
- Tema chiaro/scuro/di sistema, aria-live sobrio, focus e navigazione tastiera, reduced motion, contrasto WCAG.

## Stati obbligatori visibili

`idle`, `planning`, `running`, `pause requested`, `paused`, `needs author`, `error`, `completed`, `offline`, `sync pending`, `sync conflict`.

Mai mostrare un finto completamento: distinguere task eseguito, testo generato ma non validato, testo canonizzato e commit sincronizzato.

## Server personale — UX proposta, non disponibile

Nuova scheda **Impostazioni → Server personale**: prima URL/token e pairing, poi stato/versione/aggiornamento, casella «Invia tutte le richieste al server», infine download Linux/Windows e guide di installazione/tunnel. Niente download o pulsanti di update fittizi finché gli artifact non esistono.

Spiegare autorità per libro e consenso per manoscritto/chiavi/PAT; connessione, adozione ed esecuzione sono azioni diverse. Scollegare non porta il libro in locale e un server offline non abilita il runner browser. Nuovo dispositivo non avvia automaticamente libri o AI.

Tre conferme di salvataggio separate: replica locale, checkpoint confermato dal server, commit GitHub. Mostrare ultima sincronizzazione, stato obsoleto/offline, bozze non inviate, conflitti e risultato reale dell'update dopo il riavvio. Il server esegue anche GitHub con il PAT delegato.

Admin solo locale sulla porta 24105, pairing approvato, rigenerazione/revoca e permesso update separato. I controlli remoti devono conservare gli stessi criteri mobile/accessibili; live provvisorio distinto dai dati confermati. [Flussi completi](personal-server.md) · [Accettazione F02](../features/F02-personal-server.md).
