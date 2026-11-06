# Trascrizioni Wikisource — v0.9.6: controllo della revisione esatta

Wikisource ospita **trascrizioni collaborative**. BookWriter può cercare piccoli passaggi testuali verificando che il frammento appartenga **al wikitesto restituito per un preciso ID revisione**, ma **non autentica l'opera storica né la sua licenza**.

## Nuova verifica della provenienza testuale

Dalla v0.9.6 la ricerca si svolge in **due passaggi**:

1. Dopo che l'autore ha confermato 1–3 query pubbliche, la ricerca MediaWiki restituisce **pagina, titolo, ID e timestamp della revisione**. Il sistema **non** usa più gli estratti `TextExtracts` della pagina corrente.
2. BookWriter chiama `GET https://it.wikisource.org/w/api.php` per leggere **l'esatta revisione numerica**, verificando che ID pagina, titolo, namespace, ID e data revisione siano gli stessi del primo risultato.
3. Il software seleziona una **sottostringa letterale contigua** da una riga semplice di wikitesto, non una rielaborazione HTML. Non esegue template e **non trasclude** pagine. Se la revisione contiene soltanto template/markup, non inventa testo leggibile: mostra nessun estratto utilizzabile.
4. Calcola il fingerprint **SHA-256 del wikitesto** ricevuto e salva posizione del frammento, lunghezza, timestamp e ID. La citazione del revisore deve combaciare con il frammento collegato a quella revisione.

**Attenzione:** SHA-256 e offset attestano un controllo **locale sui dati arrivati dall'API**, non una firma crittografica di Wikisource, non una verifica indipendente di documenti d'epoca e non un'assicurazione giuridica. I contenuti in backup JSON potrebbero essere stati modificati prima dell'importazione.

## Come usarlo

Apri **Dashboard → Redazione multi-agente → Trascrizioni Wikisource**, digita da una a tre ricerche storiche **pubbliche**, premi **Cerca trascrizioni Wikisource** e leggi il dialogo con tutte le stringhe esatte che stai per inviare. Conferma solo se non contengono indizi riservati o dati personali: l'app non genera ricerche dal testo privato del romanzo e non trasmette API key o segreti, ma invia integralmente le parole inserite.

Apri il link all'**esatta revisione** per confrontare il passo, la cronologia editoriale, gli autori, l'opera/edizione e i **diritti di citazione e riproduzione** prima di riutilizzarlo nel libro. La ricerca è conservata localmente (IndexedDB/ZIP) e può confluire in un repository GitHub **pubblico** se attivi la sincronizzazione. Gli estratti vengono inoltre inviati **solo** allo specialista storico e al direttore editoriale tramite il modello AI configurato: gli altri undici agenti non ricevono il testo.

L'aggiornamento di un capitolo congelato richiede una nuova review e invalida i freeze successivi. Autosync viene disattivato e l'outbox bloccata/cancellata nell'operazione atomica, come nelle altre ricerche.

## Nuovi identificativi e migrazione

| ID | Stato attuale |
| --- | --- |
| `itwsr:<pageId>:<revisionId>:<sha256-16>` | Nuovo frammento con wikitesto specifico letto e impronta SHA-256. **Citabile** solo se attivo e con `sourceEvidence` letterale per fonte |
| `itws:<pageId>:<revisionId>` | Legacy v0.9.5: l'estratto poteva riferirsi alla pagina corrente, non alla revisione. **Solo audit**: non citabile in nuove review; devi ripetere la ricerca col tuo consenso |
| `itwiki:` | Wikipedia terziaria, non autenticazione storica |
| `loc:` | Scheda LoC: metadati, **non citabile** come documento |
| `locex:` | Trascrizione dell'autore, non verificata indipendentemente |
| `crossref:` | Metadati DOI, non contenuto integrale consultato |

Le vecchie fonti v0.9.5 restano nello storico e nei backup per preservare gli audit. Il nuovo pannello le mostra come **non verificate rispetto alla revisione**. Solo la riacquisizione con consenso può creare una versione con prova di appartenenza, senza inventare un legame per quelle precedenti.

## Limiti e diritti

Il browser esegue fino a tre richieste di ricerca e sei richieste separate per revisione (massimo due candidati/query), con `origin=*`, nessun cookie, credenziale, redirect o referer, timeout 12 secondi, limite **150 KB per risposta** e lettura streaming limitata. Un errore CORS/HTTP 429/rete/JSON o una risposta con pagina, revisione o timestamp discordanti blocca **l'intera operazione**: i dati precedenti restano invariati. L'assenza di testo non prova l'inesistenza del documento; il markup trascluso potrebbe impedire estratti leggibili.

Le opere Wikisource possono avere licenze differenti; l'app mantiene `community_transcription_unverified` e `work_rights_not_verified`. Non pubblicare brani di terzi senza verificare pubblico dominio, attribuzione, obblighi editoriali e regole della giurisdizione applicabile. La disponibilità di una frase in un wikitesto **non prova che il fatto storico narrato sia vero**.

**Nuovo dalla v0.9.7:** puoi controllare di nuovo una revisione già presente, confrontandola online con l'hash salvato, e scegliere di escluderla in caso di discordanza; [guida alla riverifica remota](wikisource-reverification.md), ADR 0020.

Riferimenti: [ADR 0019](../ADR/0019-wikisource-exact-revision-proof.md), [ADR 0018](../ADR/0018-wikisource-versioned-transcriptions.md) e [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
