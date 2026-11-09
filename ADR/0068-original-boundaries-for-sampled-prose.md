# ADR 0068 — Confini originali nelle porzioni di prosa campionate

- **Stato:** accettato per v0.11.35
- **Data:** 2026-11-09
- **Issue:** [#20](https://github.com/KeyserDSoze/BookWriter/issues/20)
- **Precedenti:** ADR 0035, 0063–0067

## Contesto

La ricerca locale dei nomi dichiarati in una scena corrente (ADR 0063) controlla ogni porzione precedente campionata individualmente, senza concatenarle per creare un'identità inventata. Tuttavia quando una scena supera 16.000 caratteri, `scanParts` tagliava il testo in tre segmenti e `containsWholeLiteral` considerava l'inizio o la fine del segmento come un **confine di parola valido**. Se la finestra centrale iniziava appena dopo la «V» di `Vivo`, il contenuto campionato appariva come `ivo`: un falso `literalEntities=["ivo"]` in una scena che non nominava affatto il personaggio. Analogo rischio alla fine della porzione, ad esempio `Ivoz` tagliato prima della «z», con lettere Unicode o segni combinanti. Anche i `terms` potevano essere falsamente incrementati a causa dei bordi artificiali.

## Decisione

1. Conservare le **tre porzioni non contigue** (inizio, centro, fine) per scene più lunghe di `MAX_SCAN_CHARS=16000`, con la stessa larghezza e gli stessi start/end del campionamento già in uso. Nessun allargamento del testo realmente letto per il ranking; nessuna chiamata API o nuova memoria.
2. Per ciascuna porzione rendere disponibili `text` e i due caratteri **immediatamente all'esterno** (`before`, `after`), ottenuti dal testo originale. Questi caratteri sono usati **esclusivamente** come verifica dei confini, non per ricomporre parole o citazioni attraverso il taglio. Le porzioni restano separate e non vengono unite per formare match di entità.
3. `containsWholeLiteral` conserva NFC/casefold italiano, nome completo e ricerca a parola intera. Al bordo del segmento controlla ora il carattere esterno originale; nelle posizioni interne continua a verificare i confini nel testo campionato. Contano come continuazione lettere, numeri, segni diacritici combinanti, underscore e surrogati Unicode quando la porzione taglia un carattere non-BMP. Se un nome completo termina sul bordo e il carattere esterno è uno spazio o altra separazione reale, resta un match.
4. I `terms` lessicali seguono la stessa regola: token lunghi almeno quattro caratteri, stopword e campionamento restano invariati, ma i token che iniziano o finiscono sulla porzione e continuano nel manoscritto originale **non entrano nel punteggio**. Nessun nuovo campo in `RetrievalMatch`; `method=local_structured_lexical_v1` e gli audit precedenti restano compatibili.
5. Mantenere max16 nomi espliciti, 8 riscontri per scena, 48 termini, 1.600 scene, 4 scene finali (2/capitolo), finestre originali con offset e gli stessi destinatari autorizzati. Non leggere alias/interpretazioni private per espandere il ranking, non aggiungere prompt né promuovere automaticamente il riscontro a fatto canonico.

## Verifiche e limiti

Vitest sui tre bordi (nome parziale dentro `Vivo`, parola con suffisso dopo la porzione, segni combinanti, token lessicali troncati), falsi riscontri con punteggio zero, casi realmente separati sul bordo, assenza di mutazioni e isolamento della memoria privata/dei cinque lettori ciechi. Playwright desktop/mobile sull'avviso di campionamento; TypeScript, Vitest, smoke, build, browser e deploy su `main`.

**Limite:** il rilevamento resta lessicale/strutturato, con porzioni del romanzo non analizzate. Escludere una falsa menzione non certifica che non esistano contraddizioni né che il canone sia completo.
