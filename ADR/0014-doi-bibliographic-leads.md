# ADR 0014 — Bibliografia DOI per capitolo: metadati Crossref separati dalle prove storiche

- **Stato:** Implementato e integrato in main (v0.9.1, PR #25 merged, CI desktop/mobile verde)
- **Data:** 2026-11-05
- **Issue:** [#23](https://github.com/KeyserDSoze/BookWriter/issues/23)
- **PR:** [#25](https://github.com/KeyserDSoze/BookWriter/pull/25)
- **Predecessori:** ADR 0011 (12 agenti), ADR 0012 (budget), ADR 0013 (dossier Wikipedia)

## Contesto

v0.9.0 permette all'autore di fornire al revisore storico estratti enciclopedici effettivamente recuperati, con source ID e citazioni letterali controllate. Questo, però, non identifica studi accademici e libri da consultare per verifiche approfondite. Un modello potrebbe citare una pubblicazione inesistente oppure confondere la presenza di un articolo con una prova dei fatti espressi nel manoscritto.

Crossref è un'infrastruttura di registrazione e distribuzione **di metadati DOI depositati dagli editori**. La sua REST API è pubblica, ma la scheda bibliografica **non** contiene necessariamente l'opera né dimostra la verità delle sue tesi. Anche una pubblicazione con DOI può essere una recensione, un preprint, un errore o un lavoro poi rettificato.

## Decisioni

1. **DOI soltanto, previa autorizzazione.** Nel capitolo l'autore inserisce da uno a cinque DOI, oppure relativi URL canonici \`https://doi.org/...\`. Un dialogo mostra gli identificativi normalizzati e avverte della consultazione esterna. Nessuna query viene inferita da segreti, scene, sinossi o memoria privata.
2. **Lookup browser-only Crossref.** Solo \`GET https://api.crossref.org/works/<doi>\`, con URL costruito da DOI con regex rigida, mai URL fornito direttamente dal servizio; \`credentials:omit\`, \`redirect:error\`, \`referrerPolicy:no-referrer\`, senza credenziali, cookie o headers sensibili. Max 5 DOI, richieste seriali, timeout 12 s e payload max 120 KB. Eventuali errori di rete o di formato bloccano **tutto** il salvataggio, senza dossier parziali. HTTP 404 viene marcato come non censito, non come inesistenza dell'opera.
3. **Metadati minimi, mai full text.** Persistiamo solo DOI, URL \`doi.org\` ricostruita, titolo, massimo otto autori, anno di pubblicazione, contenitore/rivista, editore, tipo di record, timestamp e ID di acquisizione. Non acquisiamo \`abstract\`, full text, link arbitrari del provider o dati di fatturazione. L'anno di pubblicazione di uno studio non è l'anno di un evento storico.
4. **Modello separato dalle prove.** \`ChapterHistoricalDossier.bibliography\` è opzionale e indipendente da \`sources\`/ \`activeSourceIds\` di Wikipedia. Gli ID \`crossref:...\` sono **piste bibliografiche**, non sono mai ammessi in \`HistoricalClaim.sourceIds\`. \`validateHistoricalClaim\` continua ad accettare soltanto estratti realmente recuperati e citazioni verificabili. L'agente e il giudice non possono simulare la lettura di un'opera dalla sua scheda DOI.
5. **Contesti separati.** Solo il revisore \`historical\` e, dopo, il direttore editoriale ricevono i metadati. Gli altri undici revisori, inclusi i cinque lettori ciechi, non vedono il nuovo catalogo. Le schede esterne sono trattate come dati ostili, non istruzioni.
6. **Storico e compatibilità.** Il dossier archivia snapshot con ID basati su DOI + timestamp, espone solo gli ID attivi e limita il numero di versioni. Una nuova ricerca Wikipedia preserva la bibliografia e viceversa. Progetti v0.9.0 senza \`bibliography\` continuano a funzionare; JSON del libro e ZIP/GitHub autorizzati preservano le nuove informazioni.
7. **Aggiornamento conservativo.** La ricerca non può iniziare durante l'autopilot o una review attiva. Dopo il fetch vengono acquisiti i Web Locks scrittore e outbox, e ricontrollato \`book.updatedAt\`. Se il capitolo era congelato, prima si recupera la sinossi globale precedente, poi si invalidano il congelamento del capitolo e dei successivi e si avvia la redazione. Si disabilita autosync e si elimina l'outbox vecchia. Nessun push forzato o aggiornamento del manoscritto derivato dai metadati.
8. **UI di provenienza e privacy.** La Dashboard mostra titolo, autori, editore, rivista, anno di pubblicazione, tipo e link DOI, indicando esplicitamente «metadati, NON fatto storico certificato». Il consenso avverte che gli stessi DOI digitati dall'autore possono rivelare interessi o intenzioni narrative. Non si dichiarano ricerche effettive nel testo delle pubblicazioni.

## Non scelto

- Autogenerare ricerche da interi capitoli o informazioni private: divulgazione non necessaria di narrativa inedita.
- Interpretare titolo/abstract come prova del contenuto dell'articolo: allucinazione potenzialmente dannosa, confonde metadati con citazioni.
- Recuperare PDF, abstract coperti da diritti o siti arbitrari direttamente dal browser: copyright, CORS, sicurezza e politiche di ciascun editore.
- Considerare automaticamente i DOI come pubblicazioni peer-reviewed: Crossref registra categorie diverse.
- Offrire una garanzia che il servizio funzioni offline o superi sempre le policy CORS/rate limit remote.

## Limiti e rischi residui

Crossref registra **metadati depositati**, non una valutazione indipendente dei contenuti; un DOI non garantisce qualità storiografica, peer review, accesso libero né disponibilità del testo. La REST API può essere limitata, indisponibile o non accessibile da alcuni browser per CORS. Occorre mostrare errori e preservare i dati esistenti. Per ogni affermazione importante l'autore dovrà comunque consultare una fonte primaria o secondaria attendibile e citarne un passaggio verificabile.

Le ricerche DOI sono senza crediti AI, ma i successivi turni del revisore storico e del giudice consumano token soggetti al budget v0.8.1. I DOI registrati nel progetto possono diventare visibili se l'autore sincronizza il libro in una repository GitHub pubblica.

## Verifica di accettazione

- DOI normalizzati ed esclusione di URL arbitrarie, token, frammenti, query e protocolli insicuri.
- API a host fisso, senza Authorization/cookie, input solo DOI; errori e risposte oversize non salvano dati parziali.
- Test dominio: bibliografia distinta dalle prove Wikipedia, preservazione reciproca, storico e attivazione della sola versione corrente.
- Test runner: solo storico/giudice ricevono bibliografia, titolo non usabile come \`sourceQuote\`.
- Test integrazione: writer/outbox locks, revisione locale, freeze/rewind senza perdite, DOI assenti e nessuna fuga di segreti.
- Playwright Chromium desktop/mobile: conferma esplicita, scheda bibliografica visibile, prompt storico, privacy dei cinque lettori, precedente review invariata.
- CI typecheck, Vitest, smoke, build, desktop/mobile verde prima del merge.

## Prossimi sviluppi

Aggiungere **fonti primarie e archivi istituzionali consultabili**, confronto di due fonti realmente lette, estratti con licenze/provenienza per pubblicazioni disponibili in modo lecito, supporto per ISBN/catologhi e screening di correzioni/retrazioni. Qualunque proposta automatica di termini di ricerca dovrà essere confermata prima dell'invio esterno.
