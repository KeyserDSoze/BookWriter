# Wikisource: consultazione di trascrizioni storiche revisionate — v0.9.5

BookWriter ora può ottenere **brevi estratti testuali effettivamente restituiti da Wikisource**, con link alla **revisione** e data della consultazione. Non si tratta di una verifica autonoma dell'originale storico: Wikisource ospita *trascrizioni collaborative* e ogni opera può avere un differente stato dei diritti.

## Come funziona

1. Apri il libro e, nella Dashboard, la **Redazione multi-agente**. Prima della review apri la sezione **Trascrizioni Wikisource** del capitolo.
2. Scrivi **1–3 ricerche pubbliche** (una per riga, 5–110 caratteri ciascuna) che sei disposto a comunicare a `it.wikisource.org`. Non immettere passaggi inediti, password, token, nomi segreti dei personaggi o identificativi riservati.
3. Premi **Cerca trascrizioni Wikisource**. Viene mostrato un dialogo con **tutte le frasi da inviare**, il destinatario, la natura dei testi e il possibile effetto sull'approvazione dei capitoli. La ricerca parte **solo dopo conferma**.
4. Per ogni testo utile BookWriter salva titolo, ID pagina, ID revisione e data, breve estratto, query e timestamp. Il collegamento apre la revisione pubblicata. Puoi verificarne l'estratto nell'edizione originale e consultarne autori, cronologia, edizione e diritti.
5. Il revisore storico può associare una citazione letterale al riferimento `itws:<pageId>:<revisionId>`. Il software controlla che la frase citata compaia **nell'estratto effettivamente recuperato**, non in una scheda di catalogo né in un altro testo. Il direttore editoriale valuta pertinenza, affidabilità, data, possibili anacronismi e la remediation proposta, e può respingerla motivando.
6. Gli altri undici agenti non hanno accesso agli estratti. Come per le altre fonti, un aggiornamento dopo il freeze riapre quel capitolo e invalida i successivi; l'autosync viene spento e bisogna rieseguire la review.

## Distinzioni importantissime

| Identificatore | Che cosa indica | Che cosa NON prova |
| --- | --- | --- |
| `itwiki:...` | Estratto da una voce Wikipedia con riferimento di revisione | Fonte primaria o verità storica |
| `itws:...` | Estratto di **trascrizione collaborativa Wikisource** e ID revisione ricevuto dal servizio | Autenticità dell'originale, correttezza storica, pubblico dominio |
| `loc:...` | Scheda descrittiva Library of Congress | Contenuto del documento: non citabile come testo |
| `locex:...` | Trascrizione **inserita e attestata dall'autore**, non recuperata dall'app | Confronto indipendente con l'originale |
| `crossref:...` | Soli metadati bibliografici DOI | Testo letto o valutazione del contenuto |

**Diritti**: il riutilizzo di opere Wikisource può essere regolato da pubblico dominio oppure licenze e altre condizioni; non tutti gli originali sono automaticamente privi di copyright. Per qualsiasi frase destinata a un libro pubblicato, controlla le condizioni della **singola opera**, l'attribuzione degli autori/contributori e gli eventuali obblighi ShareAlike. Questo strumento non fornisce consulenza legale e non dichiara `public_domain` sulle trascrizioni.

## Privacy, limiti e conservazione

L'app usa soltanto `GET https://it.wikisource.org/w/api.php` dopo conferma, senza API key, cookies, redirect o invio di manoscritto e segreti privati. Max **due pagine per query**, tre query e **sei** estratti alla volta, risposta limitata a 150 KB e timeout 12 secondi. I risultati sono conservati in IndexedDB, negli ZIP e — se decidi di sincronizzare il libro — anche nel repository GitHub. Se il repository è pubblico anche le query e i riferimenti diventano pubblici; **la redazione AI invia gli estratti selezionati al modello storico e al giudice configurati dall'autore**.

Si conservano fino a 70 snapshot delle revisioni. Un nuovo aggiornamento disattiva le versioni precedenti non recuperate nella stessa ricerca, ma le lascia disponibili come storico per i giudizi già archiviati. Se il servizio non fornisce il plugin `TextExtracts`, non consente CORS, risponde 429 o la rete fallisce, **non viene salvato nessun risultato parziale**. L'assenza di estratti non dimostra che un documento non esista.

**Limite tecnico**: l'API può associare l'estratto corrente a metadati di revisione non atomicamente. Il software memorizza gli ID restituiti, ma non ha verificato sul server che l'estratto coincida esattamente con il testo storico della specifica revisione: confrontalo manualmente aprendo il link alla revisione, soprattutto prima di ripubblicare.

Per i dettagli: [ADR 0018](../ADR/0018-wikisource-versioned-transcriptions.md), [Fonti storiche](historical-sources.md), [Issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
