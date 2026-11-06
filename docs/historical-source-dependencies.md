# Provenienza e dipendenze documentali — BookWriter v0.10.5

## Perché serve

Due estratti possono appartenere a **due pagine distinte** ma riprodurre la stessa testimonianza. Contarli come due conferme indipendenti produrrebbe una sicurezza artificiale. BookWriter permette ora all'autore di dichiarare relazioni note fra fonti già presenti nel dossier del capitolo. **È un'annotazione dell'autore, non un'autenticazione dell'archivio.**

## Come registrare una relazione

1. Prima di iniziare la redazione, apri il capitolo nella **Redazione multi-agente** e la sezione **Provenienza e dipendenze fra fonti**.
2. Scegli due riferimenti distinti nell'elenco di fonti **attive e citabili**: Wikipedia, Wikisource con prova della revisione, estratti OCR LoC o trascrizioni dell'autore. Le schede di catalogo, ISBN/DOI e metadati IIIF non sono fonti testuali citabili.
3. Se conosci un legame, seleziona **Stesso originale** oppure **Una fonte deriva dall'altra**. Motivalo brevemente indicando quali attribuzioni hai confrontato (24–400 caratteri), senza inserire segreti, credenziali o passaggi inediti del romanzo.
4. Premi **Registra relazione di provenienza**. Il dialogo mostra i due ID precisi, la motivazione e le conseguenze: niente richiesta di rete ad archivi, ma nota locale, possibili future chiamate AI per i ruoli storico/giudice, backup e repository GitHub collegata.
5. Dopo conferma, la dichiarazione viene registrata. I nuovi controlli storici non possono più considerare quei documenti come prove indipendenti, **anche tramite una catena di dipendenze**. La presenza della citazione è verificata come prima, ma la verità storica resta da dimostrare.

## Rettifiche, aggiornamenti e sicurezza

Per rivedere una dichiarazione, seleziona la stessa coppia e scegli **Relazione non stabilita** con una nuova motivazione: il collegamento attivo viene ritirato, ma lo storico precedente non viene eliminato. Questo NON certifica che i documenti siano indipendenti.

I riferimenti sono legati all'**ID dello snapshot**. Se la ricerca recupera una revisione diversa, il vecchio collegamento resta nell'archivio di audit ma non vale automaticamente per la nuova versione. Registrane uno nuovo solo dopo averla controllata.

Non è possibile modificare le relazioni mentre l'autopilot o il ciclo editoriale sono in esecuzione. Come per le altre ricerche, l'app usa blocchi tra schede e controllo della revisione locale, disabilita autosync e cancella l'outbox obsoleta. Se il capitolo era congelato, lo riapre insieme ai successivi e ripristina il punto di sinossi precedente. I backup e la sincronizzazione GitHub **opt-in** possono includere le annotazioni: evita contenuti che non vuoi condividere.

## Cosa il sistema non può garantire

- Non verifica provenienza, indipendenza o diritti d'autore su originali non consultati.
- Non classifica automaticamente due fonti come indipendenti perché hanno URL o numeri di pagina differenti.
- Non interpreta l'assenza di una relazione registrata come conferma di indipendenza.
- Non riscrive scene o canone per una dichiarazione dell'autore senza il normale giudizio e la remediation autorizzata.

Riferimenti: [ADR 0028](../ADR/0028-author-attested-source-dependencies.md), [dossier storico](historical-sources.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
