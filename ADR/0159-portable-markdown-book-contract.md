# ADR 0159 — Contratto Markdown portabile, import esterno e divergenze esplicite

- Stato: accettato, implementazione locale non ancora pubblicata
- Data: 2026-11-14
- Versione preparata: 0.18.0
- Integra ADR 0003/0005/0008; non cambia autorizzazioni editoriali, lease o protocollo Git.

## Esigenza

L'autore vuole la stessa struttura dati dei propri libri Markdown, anche quando scritti a mano o con un'altra IA. Book.Bot alla revisione `f49441134a96d8f8285d4dc6a91f5721361c2612` è soltanto riferimento di cartelle e metadati: nessun contenuto o strumento va copiato. Prima BookWriter scriveva `type: paragraph`/`viewpoint`, non esportava i riassunti in Markdown e rileggeva soltanto il JSON, ignorando modifiche esterne ai file.

## Decisione

1. Profilo Markdown 1 documentato in `docs/markdown-book-format.md`: cartelle `chapters/NNN-slug/chapter.md` e `NNN-scena.md`, `type: scene`, `pov`, ID qualificati, riferimenti risolvibili, `timeline/events.md`, stato, schede, linee guida e riassunti in `reviews/`. La prosa è il corpo esatto, senza wrapper artificiale di titolo. JSON resta snapshot lossless dell'app, non l'unico formato leggibile.
2. Parser puro di un **sottoinsieme esplicito e sicuro di YAML**, senza nuove dipendenze, coercizioni, tag, alias, oggetti annidati o chiavi duplicate/prototipo. Rifiuto integrale di ambiguità di ID, numeri, cartelle o riferimenti. Frontmatter e documenti bounded. Lo scrittore verifica il proprio risultato con lo stesso lettore. Il proiettore legacy viene conservato solo per verificare i file già pubblicati.
3. Import additivo di repository senza JSON, albero non troncato e file regolari, blob a SHA fisse con verifica locale dell'impronta, UTF-8 strict e limiti cumulativi. Il preview contiene solo titolo, identità e HEAD. Identità locale UUIDv8 deterministica da namespace, owner/repo normalizzati, ramo esatto e ID del libro, mai dal titolo. Recheck HEAD e fencing UI prima della scrittura locale, `add` anti-collisione. Nessuna scrittura remota all'import.
4. `markdownSource?` conserva **soltanto documenti narrativi ammessi**, compresi metadati semplici e note extra, nello stesso libro e negli ZIP; schema validato anche in backup/import GitHub. L'export aggiorna i campi mappati conservando quelli aggiuntivi e i documenti non mappati; i file gestiti rimossi non risorgono dalla fonte. Gli originali possono conservare prosa vecchia e note private: dichiararlo. Non sono messaggi AI né consensi, non entrano automaticamente nei prompt o nel cloud.
5. Un libro Markdown importato è pausato, senza freeze, giudizi, attività AI, consensi o modelli ereditati, anche quando `canon: canon`. Gli usuali gate restano obbligatori. Solo un successivo push esplicito e autorizzato può adottare la repository originale con manifest/snapshot, dopo confronto esatto degli originali e baseline invariata. Nessun reset della redazione o pubblicazione implicita.
6. Se esiste JSON, il lettore confronta gli SHA Git dei documenti con la proiezione corrente o legacy. Modifiche, rimozioni o nuove scene/schede non sono nascoste dallo snapshot. Errore esplicito in snapshot/pull; nel picker stato `divergent` con import **confermato** dei soli Markdown come nuovo libro separato, non collegato e senza autorizzazioni/audit importati. Nessun merge, restore o sostituzione automatica. Un JSON legacy senza manifest e senza `book.md` rimane recuperabile senza dichiarare coerenza Markdown; togliere il solo manifest non aggira la verifica.
7. Richieste GitHub solo sull'API fissa, Bearer, no cookie/referrer/redirect; deadline totale per HTTP di 20 secondi, limite streaming e cleanup best effort senza corpo di errore. Errori e timeout non autorizzano retry di scritture. SHA Git verifica i byte letti, non autentica autore o significato; Web Locks/CAS e `force:false` restano invariati.

## Limiti e verifiche

Il contratto non promette YAML generale, lettura di allegati/script, esecuzione di istruzioni esterne, estrazione semantica di sinossi arbitrarie o compatibilità con qualunque operatore. Documenti non mappati sono conservati, non trasformati in memoria o consensi. Limiti: 1.200 file, 2 MiB/file, 12 MiB per sorgente, 64 KiB header, 20.000 entry di albero, 200 capitoli/scene per capitolo. Gli originali aumentano lo spazio locale, checkpoint e snapshot; il push conserva il proprio tetto di 12 MiB senza troncamento.

Vitest: parser, Unicode/CRLF/prosa esatta, round-trip, extra, rimozioni, ID/riferimenti, collisioni, identità, import additivo/fenced, HEAD cambiata, albero troncato/symlink/UTF-8 errato, divergenze nuove/legacy, primo push con gate, ZIP content/full/ostile, privacy dei ruoli e cloud, deadline HTTP. Playwright desktop/mobile: riconoscimento e import esplicito senza JSON, nessuna AI/scrittura remota, libro originale intatto, divergenza e copia con conferma/annullamento. Solo dati sintetici; nessuna prova sul libro reale né deploy implicito.
