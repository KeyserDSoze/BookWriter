# ADR 0019 — Wikisource: prova locale di appartenenza all'esatta revisione MediaWiki

- **Stato:** Accettato per v0.9.6 (PR #31)
- **Data:** 2026-11-06
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **Predecessore:** ADR 0018 (v0.9.5)

## Problema di integrità risolto

Nella v0.9.5 `generator=search&prop=extracts|revisions` accoppiava un `extract` della **pagina corrente** ai metadati di una revisione. La risposta non dimostra che le parole appartengano all'ID di revisione citato. Non dobbiamo presentare questa associazione come controllo della revisione, né mantenere i vecchi record automaticamente citabili nei nuovi rilievi.

La documentazione ufficiale [API:Revisions](https://www.mediawiki.org/wiki/API:Revisions) permette l'accesso **per `revids`**, con `rvslots=main` e `rvprop=ids|timestamp|content`, cioè al wikitesto di una revisione specifica.

## Decisione

1. Ricerca dopo consenso dell'autore come in v0.9.5: 1–3 query pubbliche di massimo 110 caratteri; nessun manoscritto, segreto, PAT, API key o testo di scena lascia il browser. Il primo GET usa `generator=search`, namespace 0, massimo due risultati/query, **soltanto metadati `prop=revisions&rvprop=ids|timestamp`**, mai `extracts`.
2. Per ciascun candidato ammissibile, un **secondo GET** a host/API fissi con `revids=<numero>`, `rvprop=ids|timestamp|content` e `rvslots=main`. La risposta deve identificare esattamente la **stessa** pagina (ID, namespace, titolo) e lo **stesso** ID e timestamp di revisione. Qualsiasi divergenza, assenza o contenuto principale non di modello `wikitext` fa **fallire tutto il batch**, non viene salvato alcun risultato parziale.
3. Il testo acquisito è il **wikitesto grezzo di quella revisione**; non si utilizza più il plugin opzionale `TextExtracts`. Una funzione deterministica seleziona una **porzione letterale contigua** di massimo 1000 caratteri da una riga di prosa semplice (minimo 36 caratteri e 7 parole), escludendo righe con markup, tag, template, codice o testo soltanto trascluso. Se una pagina contiene soltanto template/trasclusioni, non viene inventata una trascrizione: nessuna prova attiva da quella pagina.
4. Il browser calcola `SHA-256` dell'intero wikitesto ricevuto con WebCrypto, salva `contentSha256`, `contentLength`, `excerptOffset` e `method=exact_revid_wikitext` insieme alla citazione. Il nuovo ID `itwsr:<pageId>:<revid>:<primi16hexSHA256>` lega la versione indicata a quel digest di contenuto. Il codice confronta la sottostringa col **wikitesto appena letto** prima di salvare. La stringa hash è un fingerprint di audit **locale** e non una firma dell'editore/ente archivistico o un attestato dell'opera originale.
5. I vecchi snapshot v0.9.5 `itws:<pageId>:<revid>`, non accompagnati da contenuto di revisione esatto, rimangono in `allWikisourceExcerpts` visibili negli audit e backup **ma non in `activeWikisourceExcerpts`**, anche se il vecchio dossier li marca attivi. Un nuovo `sourceEvidence` storico può citare soltanto gli ID nuovi `itwsr:` verificati nel processo di acquisizione. La riacquisizione consensuale conserva vecchi snapshot e aggiunge quelli nuovi senza sovrascrivere lo storico.
6. Richieste sempre GET senza cookie/credenziali, niente redirect/referrer, `origin=*`, tempo massimo 12 secondi per chiamata, 150 KB per risposta e lettura **streaming limitata** per evitare payload illimitati in memoria. Le query fallite o CORS/429 interrompono il batch, non alterano il dossier. Timeout, CAS `updatedAt`, Web Locks, rewind frozen, outbox e autosync restano quelli di ADR 0018.
7. Solo lo specialista storico e il giudice ricevono frammento, revisionProof, data e origine; gli altri 11 revisori restano indipendenti. Il giudice confronta quote con il frammento esatto, ma deve ancora ragionare su attendibilità, data reale, indipendenza, diritti e pertinenza: non accettare automaticamente una remediation. Nessun testo esterno viene inserito di nascosto nella prosa.

## Limiti non risolti

- **Non è un'autenticazione** dell'originale storico: prova soltanto che durante la consultazione il servizio MediaWiki ha restituito un certo wikitesto per un certo ID di revisione. Non si attesta che l'opera, il manoscritto originale, la data storica o l'edizione siano autentici.
- **Non è una verifica della licenza**: `work_rights_not_verified` rimane obbligatorio. I documenti di terzi potrebbero avere limiti sul diritto di citazione e obblighi di attribuzione. Non è lecito dichiararli automaticamente pubblico dominio.
- **Hash non autenticato:** i backup importati potrebbero contenere campi falsificati; senza rifare il fetch non è possibile provare crittograficamente la provenienza del contenuto. L'interfaccia mostra l'ID e la SHA-256, non dichiara verifica terza indipendente. Un futuro controllo remoto su richiesta potrebbe confrontare il digest con la revisione online.
- Alcune opere Wikisource contengono solo template o trasclusioni da altre pagine: **nessun frammento** utilizzabile invece di un estratto inventato. Se l'API CORS non è disponibile, l'app fallisce senza proxy. I mock Vitest/Playwright non dimostrano raggiungibilità live.
- Una pagina wikimedia e un'altra pagina che deriva dal medesimo documento potrebbero non essere **fonti indipendenti**. Il giudice deve valutarlo.

## Requisiti di accettazione

- Due fasi; zero `extracts` di pagina corrente; ID, pagina, timestamp e slot wikitext **coincidenti**; substring letterale con SHA-256/offset verificati durante il fetch.
- Vecchi record consultabili per audit, disattivati dai nuovi report; fresh consent prima di migrare.
- Test di identità contraffatta, mismatch, omissione contenuto, solo template, risposta troppo grande, 429, CORS e seconda query fallita senza salvataggi parziali.
- Test di privacy e cecità agenti, TypeScript/Vitest/smoke/build e Playwright desktop/mobile sulla HEAD prima del merge. Verifica del deploy Pages e del cleanup dopo merge.
