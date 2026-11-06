# Redazione multi-agente di BookWriter — v0.8.0

Dopo la scrittura e il primo consolidamento delle scene di un capitolo, l'autopilot apre automaticamente una **redazione indipendente**. Il capitolo non viene considerato definitivo né sincronizzato su GitHub finché questo percorso non è concluso.

La schermata **Dashboard → Redazione multi-agente** mostra quali verifiche sono in corso, le criticità trovate, le correzioni suggerite, le decisioni dell'editor e lo stato di ogni capitolo.

## Chi controlla il capitolo

| Revisore | Controllo |
| --- | --- |
| Coerenza e causalità | Contraddizioni fra scene, informazioni, cause ed effetti |
| Segreti, indizi e spoiler | Rivelazioni premature, informazioni non conosciute dai personaggi e payoff |
| Timeline e cronologia | Durate, ordine degli eventi, spostamenti ed età |
| Plausibilità e accuratezza storica | Possibili anacronismi e affermazioni che richiedono una verifica documentale |
| Voce, dialoghi e motivazioni | Personaggi che parlano o agiscono fuori carattere |
| Stile e lingua | Ripetizioni, cliché, sintassi, registro e punto di vista |
| Struttura, ritmo e payoff | Funzione del capitolo, tensione e promesse narrative |
| Lettore esperto del genere | Originalità e aspettative del genere |
| Lettore generalista | Chiarezza, accessibilità e coinvolgimento |
| Lettore critico e scettico | Forzature, coincidenze e logica |
| Lettore delle relazioni | Empatia, conflitti e sfumature dei personaggi |
| Lettore di misteri e promesse | Suspense, curiosità e rivelazioni percepite dal lettore |

**Non sono dodici personaggi simulati nella stessa conversazione.** Ogni revisore usa una richiesta AI distinta; vede il proprio contesto e le proprie brevi note, non le conclusioni degli altri. I cinque lettori ricevono soltanto le informazioni già disponibili al lettore: **non vedono il registro dei segreti**, i dossier privati o gli archi futuri. Gli specialisti leggono le entità e la timeline pertinenti; il revisore dei segreti può leggere il registro privato.

## Come funziona il ciclo

1. **Scrittura e prima review delle scene:** il capitolo viene composto e controllato localmente, ma questo non equivale a congelamento.
2. **Analisi dei dodici agenti:** ciascuno legge tutti i segmenti del capitolo. Un rapporto può essere positivo oppure includere criticità con categoria, severità, citazione di prova, ragione e remediation.
3. **Direttore editoriale:** riceve i rapporti, valuta ogni critica, accetta ciò che ha fondamento e respinge con una spiegazione ciò che è una falsa pista o danneggerebbe una scelta artistica voluta.
4. **Remediation:** soltanto gli interventi approvati vengono applicati, riscrivendo le scene coinvolte. Le osservazioni respinte non diventano istruzioni all'autore.
5. **Riconciliazione:** viene aggiornato il canone, inclusi oggetti, conoscenze, timeline e segreti, dopo le modifiche.
6. **Nuova analisi:** gli stessi dodici ruoli riesaminano il capitolo, da capo, per trovare nuovi problemi o effetti collaterali delle correzioni.
7. **Esito:** quando il direttore non ritiene necessarie altre modifiche, il sistema aggiorna le sinossi del capitolo e del libro, archivia i rapporti e marca il capitolo **congelato**. Soltanto ora l'autopilot passa al prossimo capitolo.

Un rilievo respinto con motivazione non obbliga a riscrivere una buona scena. Il direttore non deve basarsi soltanto sull'opinione del revisore: vede anche **estratti originali della scena e il canone pertinente**, e viene avvisato quando una citazione non è trovata nel testo. Il registro conserva il **perché** della decisione. Questo è consenso editoriale **risolto criticamente**, non l'obbligo di obbedire a qualunque commento.

## Cosa succede se i revisori non si accordano

L'autopilot può tentare fino a **tre cicli completi di remediation**. Se continuano a emergere correzioni accettate, si mette **in pausa** e indica che serve l'autore; **non inventa un'approvazione**. Nel pannello apri i resoconti, leggi le proposte accettate e respinte e scrivi la tua nuova istruzione: il vincolo verrà salvato e potrai avviare una nuova tornata dal pulsante **Riprendi**.

Se nel frattempo l'autore cambia il libro, un output AI appartenente alla revisione precedente viene scartato invece di prevalere sul nuovo testo. Il browser salva un checkpoint dopo **ogni chiamata**; un riavvio riprende dal punto successivo, non dalla prima lettura. Chiusura e sospensione del browser **non** permettono al sistema di lavorare in background.

## Riaprire un capitolo dopo averne scritti altri

Dalla stessa Dashboard, il pulsante **Rivaluta** riapre un capitolo già congelato, con conferma esplicita. L'operazione:

- disattiva autosync e cancella la vecchia coda di pubblicazione;
- toglie il congelamento al capitolo scelto **e a quelli successivi**, perché una nuova battuta o un segreto introdotto prima può cambiare il significato delle scene più avanti;
- conserva i rapporti precedenti nell'archivio e avvia un nuovo ciclo;
- richiede che ogni capitolo toccato venga nuovamente congelato prima che l'autopilot avanzi.

Le revisioni impartite da **Intervieni sull'autopilot** possono analizzare l'impatto sui capitoli precedenti e successivi. La sequenza di approvazioni non si presume più valida dopo modifiche retroattive. Per evitare perdite di contesto, ogni capitolo congelato conserva anche una **fotografia del riassunto globale** a quel punto del romanzo. Riavviando il capitolo 3, il contesto riparte dalla fotografia del capitolo 2: non viene tagliato arbitrariamente. Per vecchi libri importati che non possiedono fotografie, se le sinossi precedenti non sono ricostruibili integralmente l'operazione viene **bloccata prima di alterare dati o sincronizzazione**, con invito a fare un backup e riassumere.

## Contesti, riassunti e crediti

Ogni ruolo riceve il segmento del capitolo, una sinossi progressiva del libro, il contesto pertinente e una memoria breve **solo propria** delle osservazioni precedenti. Il libro aggiorna il proprio riassunto dopo il congelamento, invece di trascinare l'intero manoscritto in ogni chiamata. Un capitolo lungo viene spezzato in blocchi che ogni revisore leggerà, senza eliminare porzioni di prosa. Se il canone privato eccede i limiti disponibili, l'app si ferma: la compattazione automatica completa del registro segreti/entità è un lavoro successivo.

Il costo può essere **elevato**: per N segmenti di testo, ci sono almeno **12 × N** richieste di revisione, una chiamata del direttore e una o più di sinossi, oltre alle riscritture e ai nuovi giri. In **Impostazioni** puoi scegliere modelli differenti per **Specialisti capitolo**, **Cinque lettori**, **Direttore editoriale**, **Remediation mirata**, **Consolidamento** e **Riassunti**, anche per singolo libro. La Dashboard mostra i token comunicati dagli endpoint, ma **non** conosce universalmente il credito residuo e non impone ancora un budget di spesa. Verifica i crediti sul portale provider: [issue #17](https://github.com/KeyserDSoze/BookWriter/issues/17).

## Citazioni per fonte e confronto critico — v0.9.2 (PR #27)

Un nuovo rilievo dello storico può indicare fino a tre fonti, ma **deve citare una frase effettivamente presente nell'estratto di ciascuna fonte**. Non basta una frase corretta per attribuire supporto a tre articoli diversi. Nel pannello ogni citazione è affiancata alla propria fonte, con la revisione utilizzata; il giudice verifica gli abbinamenti, la pertinenza e l'eventuale contraddizione, potendo respingere rilievi non fondati. Due revisioni della stessa voce non sono due prove indipendenti. I vecchi report che contengono una sola citazione su una sola fonte restano leggibili; quelli più ambigui non vengono automaticamente certificati. Corrispondenza testuale non equivale a verità storica. Vedi [ADR 0015](../ADR/0015-per-source-historical-evidence.md).

## Bibliografia accademica DOI — v0.9.1

Oltre agli estratti Wikipedia, ogni capitolo può memorizzare da uno a cinque DOI di pubblicazioni e studi tramite **Crossref**, dopo conferma esplicita dell'autore. I metadati (titolo, autori, anno, editore e collegamento) sono visibili **solo allo storico e al direttore** come riferimenti bibliografici da consultare. **Non vengono letti gli articoli originali**: il software non permette di usare titolo o DOI come prova di una proposizione storica. Fonte registrata ≠ fatto verificato.

Le informazioni restano in IndexedDB e backup, e una nuova consultazione su un capitolo congelato richiede nuova redazione. Guida [Bibliografia DOI](crossref-bibliography.md) e [ADR 0014](../ADR/0014-doi-bibliographic-leads.md).

## Dossier storico consultabile — v0.9.0

Prima di una redazione puoi preparare un dossier per capitolo con fino a cinque **ricerche storiche pubbliche**. L'autore deve confermare le stringhe esatte prima di inviarle a Wikipedia italiana; nessun manoscritto, segreto o timeline privata viene utilizzato come query. Il revisore storico riceve il dossier di estratti con titolo, URL, data e revisione della voce, ma gli altri undici agenti restano indipendenti.

Il report storico distingue **coerente con l'estratto**, **potenziale contraddizione** e **non verificato**. Le prime due categorie richiedono una citazione letterale realmente presente nell'estratto e un ID fonte validato dal software. Il direttore può respingere motivatamente una proposta anche quando cita Wikipedia: una fonte terziaria non certifica un fatto storico. Aggiornare le fonti di un capitolo congelato lo riapre e invalida le approvazioni successive.

Guida: [Dossier storico](historical-sources.md), [ADR 0013](../ADR/0013-historical-source-dossiers.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).

## Controlli storici e fattuali

Il revisore storico ora può leggere gli estratti cercati e approvati dall'autore su Wikipedia italiana, una fonte **terziaria**. La verifica approfondita tramite fonti primarie, archivi istituzionali e bibliografia critica resta da implementare nell'[issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).

## Limiti dichiarati

I modelli possono sbagliare e un giudice può respingere una critica valida; il rapporto resta disponibile per la tua verifica. Il sistema non esegue merge semantico automatico a livello di frammenti senza approvazione, non funziona da browser chiuso, non garantisce un hard cap economico, non certifica fatti storici e non ha ancora un motore completo di retrieval semantico per migliaia di entità. La capacità di blocco multi-dispositivo rimane best effort (ADR 0007).

**Riferimenti:** [ADR 0011](../ADR/0011-independent-editorial-board-and-chapter-freeze.md), [Issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20), [Issue #17](https://github.com/KeyserDSoze/BookWriter/issues/17).
