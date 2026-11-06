# Possibili divergenze storiche fra fonti — BookWriter v0.10.4

## Nuovo controllo del contesto (v0.10.4)

Il revisore storico deve confrontare il **contesto di ogni fonte citata** prima di proporre una divergenza. Nella redazione compare una scheda per fonte con il presunto evento, il periodo, il luogo, l'edizione/versione e le informazioni ancora incerte. Se un elemento non emerge dall'estratto, viene indicato **Non determinato**, non completato con una supposizione.

Il revisore distingue `same` (pensa che le fonti descrivano lo stesso evento), `unknown` (non è sicuro) e `different`. Se dichiara `different`, BookWriter rifiuta il finding come conflitto sullo stesso fatto e richiede una formulazione non verificata. La validazione protegge **solo la coerenza formale del report**: non può confermare se l'identità dell'evento sia stata classificata correttamente.

In seguito il direttore deve presentare una **seconda valutazione autonoma**, motivata per evento, cronologia, geografia, edizione e indipendenza delle fonti. Se stabilisce che sono eventi diversi, non può accettare la proposta di correzione. Una fonte senza data o luogo non diventa falsa: serve ulteriore verifica. Gli archivi delle vecchie review v0.10.3 restano visibili con un avviso, senza riscritture o migrazioni.

## Contesto precedente (v0.10.3)

## Cosa cambia per l'autore

Nella **Redazione multi-agente**, lo specialista storico può ora segnalare che **due o tre estratti documentali distinti sembrano descrivere in modo incompatibile lo stesso fatto**. Non è una nuova ricerca: le fonti devono essere già nel dossier del capitolo, acquisito tramite azioni esplicite dell'autore.

Per ogni possibile conflitto il report espone:

- L'affermazione narrativa in discussione.
- Da due a tre riferimenti attivi con una breve citazione *letterale* ciascuno.
- Una posizione proposta per fonte: `supports` (sembra sostenere), `disputes` (sembra smentire), `unclear` (contesto insufficiente), e una motivazione.
- La decisione del **direttore editoriale**, che può accettare una richiesta di correzione oppure respingere il falso conflitto.

Il software verifica gli identificatori e che **ogni citazione sia realmente presente nello snapshot associato**. Impedisce che due revisioni della stessa pagina o due trascrizioni dello stesso item LoC diventino fonti indipendenti. Non determina però se la frase rappresenti correttamente l'evento, la data, il luogo o il significato di una fonte.

## Come interpretare il risultato

Un esempio: un estratto colloca l'avvio di una linea telegrafica nel 1848 e un altro lo colloca nel 1853. Potrebbero riferirsi a linee diverse, a una fase sperimentale rispetto al servizio pubblico, o a edizioni e calendari diversi. Il revisore deve motivare le posizioni; **il direttore è tenuto a cercare questi falsi conflitti** prima di proporre modifiche al romanzo.

Le fonti possono avere qualità diverse: Wikipedia è terziaria, Wikisource è una trascrizione collaborativa, gli OCR possono contenere errori, i testi LoC trascritti dall'autore non sono autenticati. Una citazione letterale non convalida diritti, autenticità o verità. Cataloghi, DOI e metadati IIIF non diventano prove.

## Privacy, audit, compatibilità

- Nessuna query automatica, nuovo invio a Wikipedia/LoC/Crossref, download di immagini o nuove chiamate di rete.
- Solo il revisore storico e il direttore critico vedono il dossier; gli altri undici ruoli restano ciechi.
- Le nuove posizioni vengono archiviate **nei report editoriali**, già contenuti in IndexedDB, ZIP e nelle proiezioni GitHub quando l'autore le sincronizza. Non cambiano le fonti né il canone.
- I vecchi report `unverified`, `consistent_with_excerpt` e `contradicts_excerpt` continuano a funzionare senza conversioni.
- I report dello specialista sono proposte; il direttore può rifiutarle, non occorre correggere automaticamente alcuna scena.

Riferimenti: ADR 0026, issue #23, [dossier storico](historical-sources.md).
