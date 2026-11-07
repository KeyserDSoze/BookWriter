# Confronto fra scene precedenti senza attestazioni autore — v0.11.11

BookWriter ora può segnalare **possibili conflitti narrativi** anche quando il capitolo precedente è già congelato ma l'autore **non** ha creato un'annotazione esplicita di evento. Non confondere questi indizi con prove dell'accaduto: una frase del manoscritto può riportare un flashback, un sogno, una menzogna o un narratore inaffidabile.

### Cosa riceve la redazione

Solo i quattro specialisti **coerenza/causalità**, **timeline**, **segreti** e **voce dei personaggi** ricevono, nelle loro richieste già previste, un breve insieme di **fino a tre estratti letterali** da scene canoniche in capitoli precedenti congelati. Il software usa il recupero lessicale già disponibile (massimo 1600 scene scansionate e quattro selezionate internamente), non un modello semantico. Mostra capitolo, scena, offset, timbro locale e criteri lessicali; omissioni e limite di scansione vengono dichiarati. Nessuna scena futura, segreto privato o nota dell'autore è inclusa nel nuovo pacchetto. I cinque lettori ciechi non ricevono questo contesto.

Uno specialista può marcare un rilievo come **Confronto con prosa precedente NON attestata** soltanto se cita **due frasi autentiche**: la `evidence` dalla scena corrente e una `quote` dalla finestra precedente effettivamente fornita. Il software verifica frase, offset, capitolo e versione della fonte; non consente di usare citazioni inventate o da una scena diversa. La descrizione dell'ipotesi deve restare separata dai fatti canonici.

### Cosa decide il giudice critico

Il direttore deve analizzare quattro aspetti prima di accettare qualsiasi correzione collegata a queste fonti: **identità del soggetto**, **cronologia effettiva**, **causalità** e **possibili spiegazioni artistiche**. Può respingere il rilievo con ragioni leggibili, senza cambiare una parola. Per approvare un intervento deve indicare un conflitto supportato, lo stesso soggetto, nessuna spiegazione artistica plausibile e almeno un'incompatibilità cronologica o causale. Il software rivalida entrambe le citazioni **prima** della riparazione e di nuovo **quando sta per salvare** la prosa prodotta dall'AI.

Nella dashboard trovi la fonte precedente con offset e la motivazione del giudice. Ogni verdetto è una **valutazione fallibile**, non una conferma della cronologia reale o del fatto narrato. Le decisioni passate conservano i loro significati: lo storico dei conflitti da eventi attestati dell'autore rimane separato, e i finding generici non vengono trasformati automaticamente in confronti verificati.

L'archivio ZIP può contenere i nuovi campi, validati rigorosamente contro dati ostili, ma **un backup importato non firma né autentica l'autore**. L'estensione non richiede ulteriori chiamate AI, non modifica il canone, e può aumentare moderatamente i token dei controlli esistenti. La selezione copre solo una parte delle scene precedenti; l'assenza di un indizio non prova la coerenza del romanzo.

Riferimenti: [ADR 0044](../ADR/0044-unattested-prior-scene-witnesses.md), [giudice strutturato](structured-narrative-adjudication.md), [recupero mirato](targeted-continuity-retrieval.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
