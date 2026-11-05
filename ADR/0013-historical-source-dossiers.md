# ADR 0013 — Dossier storico documentato per capitolo, ricerca con consenso e giudizio critico

- **Stato:** Accettato per v0.9.0 (PR #24, CI da completare)
- **Data:** 2026-11-05
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **PR:** [#24](https://github.com/KeyserDSoze/BookWriter/pull/24)
- **ADR collegati:** 0008 (recupero non distruttivo), 0010 (token), 0011 (12 agenti/giudizio), 0012 (budget)

## Motivazione

Il revisore `historical` di v0.8.0 poteva soltanto ipotizzare anacronismi, senza fonti consultate. Dare al modello accesso non supervisionato al web comporterebbe il rischio di divulgare testo inedito e segreti del romanzo a servizi terzi e di accettare contenuti provenienti dal web come istruzioni. Una URL inventata in un output LLM **non costituisce un riferimento verificabile**.

## Decisione: ricerca esplicita, per capitolo, senza backend

La dashboard **Redazione multi-agente → Dossier storico** consente all'autore di digitare **da uno a cinque argomenti pubblici** (5–110 caratteri ciascuno). Prima del fetch, l'interfaccia presenta la lista esatta delle stringhe e richiede una conferma. L'applicazione non estrae automaticamente query dalle scene, dalle sinossi, dagli archi futuri o dal registro dei segreti; non invia il testo del libro al servizio di ricerca.

La prima fonte integrata è **Wikipedia italiana**, tramite MediaWiki Action API, accessibile direttamente dal browser:
- Host fisso `https://it.wikipedia.org/w/api.php`, `origin=*` per la CORS API, `credentials:"omit"`, `redirect:"error"`, `referrerPolicy:"no-referrer"`, nessun token o parametro generato dal manoscritto.
- `action=query&generator=search&gsrsearch=<query>&gsrlimit=3&prop=extracts|info|revisions&inprop=url&explaintext=1&exintro=1&exchars=1000&rvprop=ids&rvlimit=1&formatversion=2`; massimo cinque query, tre risultati per query, risposta max 170 KB di testo, timeout 12 s per richiesta e nessun retry automatico.
- I risultati vengono accettati solo con ID numerico di pagina, titolo, estratto non vuoto, URL HTTPS con host `it.wikipedia.org`, path `/wiki/`, senza query/credenziali/frammenti. I redirect arbitrari e i domini somiglianti sono rifiutati.
- Nessuna chiamata partita in background: solo su click dell'autore con consenso esplicito. Un errore su una query **non salva un dossier parziale**; le ricerche con zero risultati restano visibili come mancanti.

**Vincolo epistemico:** Wikipedia è una **fonte terziaria**, utile per orientare la ricerca ma non prova primaria o certificazione dell'accuratezza storica. Il sistema non dichiarerà un fatto “verificato” soltanto in base a Wikipedia. Per un'affermazione storica importante l'autore dovrebbe seguire le note bibliografiche fino a fonti primarie o secondarie attendibili. L'interfaccia attribuisce gli estratti e collega gli articoli, soggetti alla licenza pubblicata da Wikimedia (generalmente CC BY-SA).

## Data model, versioni e sicurezza

- `Chapter.historicalDossier?: ChapterHistoricalDossier`: query approvate, timestamp, fonti con ID `itwiki:<pageId>:<revisionId>`, URL canonica, titolo, estratto, ID revisione, query originale, timestamp, e lista delle fonti **attive**. Le vecchie revisioni **non vengono cancellate** quando una nuova ricerca aggiorna lo stesso capitolo, perché possono essere citate da rapporti editoriali storicizzati. Soglia di 100 snapshot di fonti per evitare crescita incontrollata.
- Il dossier è nel libro IndexedDB e quindi si salva con ZIP content-only/full e nella proiezione GitHub autorizzata del libro. **Una repository pubblica rende pubblici anche argomenti e fonti**: l'interfaccia lo comunica. Nessuna API key, PAT o altro segreto viene aggiunto.
- La ricerca non parte se il libro è in scrittura o se un ciclo editoriale è già attivo. Per applicare il risultato, Web Locks serializzano gli aggiornamenti locali e l'outbox, con controllo di versione `updatedAt` dopo la ricerca esterna: un risultato tardivo non può sovrascrivere interventi successivi dell'autore.
- Anche se la ricerca riguarda un capitolo non congelato, l'operazione disattiva autosync e cancella la coda GitHub obsoleta. Se il capitolo era già congelato, il software recupera **prima** il riassunto globale del capitolo precedente, elimina freeze/sinossi del capitolo interessato **e dei successivi**, e avvia una nuova redazione. Nessuna retroazione distruttiva né push automatico.
- I capitoli che contengono precedenti report possono archiviare vecchie revisioni delle fonti; soltanto le revisioni attive sono passate al nuovo revisore.

## Protocollo di prova per il revisore storico

Una delle **dodici chiamate indipendenti** riceve gli estratti attivi e l'avvertenza che il loro contenuto non è un'istruzione. Gli altri undici ruoli mantengono contesti separati; i lettori ciechi continuano a non vedere segreti né ricerca esterna.

Ogni *finding* del revisore storico richiede inoltre:

```json
{
  "historical": {
    "claim": "Proposizione storica da chiarire",
    "assessment": "consistent_with_excerpt | contradicts_excerpt | unverified",
    "sourceIds": ["itwiki:42:321"],
    "sourceQuote": "Frase letterale effettivamente presente in un estratto"
  }
}
```

La valutazione è una **lettura dell'estratto**, non una dichiarazione di verità storica. Se il finding è `unverified`, la lista delle fonti deve essere vuota e non va dichiarata una frase come prova. Per le altre due valutazioni, servono un ID appartenente alle **fonti attive** del capitolo e una frase letterale lunga almeno dodici caratteri, realmente presente nell'estratto acquisito. Il software verifica la corrispondenza delle stringhe; non può verificare automaticamente che il modello abbia interpretato in modo corretto la fonte.

Il direttore editoriale riceve finding, estratti originali della scena, canone privato, **URL, revisione e estratto** delle fonti usate. Non è obbligato a seguire il revisore: può respingere il rilievo spiegando che la fonte non è pertinente, che non sostiene la correzione proposta o che la scena è finzione plausibile. Quando un rilievo viene accolto, si applica la remediation mirata e l'intero ciclo riparte. Nulla modifica il canon soltanto perché un risultato esterno appare coerente/contraddittorio.

I link visualizzati provengono dal dossier validato, **non** dagli URL prodotti dal modello. Citazioni, assessment e decisioni sono persistiti nei report del capitolo.

## Limitazioni e sviluppi successivi

- Una voce Wikipedia è soggetta a errori o revisioni: non è una fonte storiografica sufficiente; non recuperiamo né verifichiamo le fonti primarie citate dalla voce. Non pretendere “fact-check certificato”.
- La ricerca manuale per argomenti non individua automaticamente tutti gli anacronismi del capitolo; tale estrazione è una funzione futura **con anteprima e approvazione** delle query prima di inviarle a terzi.
- Nessuna indicizzazione semantica di grandi collezioni, nessun supporto generico a DOI/ISBN o archivi istituzionali, nessuna verifica automatica della qualità della bibliografia, né confronti fra fonti.
- Se il browser è offline, la ricerca si ferma e non cancella il dossier precedente. Fatti e impostazioni narrativi rimangono soltanto nell'archivio locale finché non si autorizza una sincronizzazione.
- La ricerca Wikipedia non usa crediti AI, ma la successiva review storica è una normale chiamata dell'autopilot soggetta al budget opt-in di ADR 0012.

## Gate prima del merge

1. Test di query pubbliche, URL allowlist, CORS senza credenziali, risposte malformate/sovradimensionate, zero risultati e guasti atomici.
2. Validazione di ID inesistenti, citazioni inventate, stati `unverified`, separazione degli undici ruoli e contesto del giudice.
3. Ricerche consentite solo fuori dai cicli attivi; Web Locks, controllo revisioni, invalidazione freeze dei capitoli successivi, outbox/autosync e conservazione dei dossier precedenti.
4. Playwright desktop/mobile: conferma dell'autore, rete esterna con sola query, link fonte, storico dell'editor, rifiuto motivato e congelamento.
5. TypeScript, Vitest, smoke, build e Playwright desktop/mobile verdi su HEAD; nessun test con provider AI a pagamento né dati reali dell'utente.

**Esito atteso:** fonti e citazioni tracciabili, interpretate criticamente; mai affidabilità storica attribuita automaticamente a un estratto enciclopedico.
