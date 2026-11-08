# Condivisione selettiva dei giudizi sulle piste — v0.11.21

Per impostazione predefinita, **nessun agente AI riceve i tuoi giudizi privati** sulle possibili comunicazioni fra personaggi. Dopo aver valutato una citazione e registrato una motivazione con la v0.11.20, puoi decidere se condividere **solo un estratto minimo** nelle prossime revisioni. I consensi preesistenti sulle conoscenze **non** valgono per queste valutazioni.

## Autorizzare una singola valutazione

Apri **Indice eventi candidati → Registro conoscenze autore → Collegare informazioni fra personaggi**, poi **Esamina piste possibili** su un collegamento «stessa informazione». Una frase con **Giudizio corrente** offre la voce **Condivisione AI specifica**.

Seleziona manualmente uno o più fra **Continuità**, **Timeline**, **Segreti**, **Voce dei personaggi** e **Giudice critico**: tutte le caselle partono vuote, anche quando hai condiviso in precedenza altre notizie. Inserisci una motivazione di 12–500 caratteri e premi **Autorizza ruoli selezionati**, confermando l'eventuale invio a provider AI esterni.

Il modello, solo nel ruolo autorizzato, vedrà **numero di capitolo/scena, offset, citazione letterale, mittente, destinatario e classificazione dell'autore** (`author_attested_report`, `possible_path` o `dismissed`). **Non** vengono condivisi il tuo motivo privato, le altre decisioni knowledge, le note di segreti, gli alias, i timestamp o la timeline. I cinque lettori ciechi non ricevono il pack. Il giudice vede l'estratto soltanto se deve valutare un finding **knowledge** già ancorato nella scena corrente, e può liberamente **respingere** le interpretazioni ricevute.

Si usano le chiamate AI della redazione già previste; non vengono create chiamate aggiuntive. I prompt possono tuttavia contenere più token. La classificazione dell'autore non diventa automaticamente canone né giustifica una riscrittura.

## Revoca e perdita della fonte

Per una valutazione autorizzata, scrivi una motivazione e premi **Revoca autorizzazione**. La revoca vale **solo per i futuri invii AI**; il contenuto eventualmente già ricevuto da un provider esterno non può essere ritirato. La scelta più recente prevale nello storico.

Se modifichi la citazione, riapri una scena, rettifichi il collegamento fra informazioni o cambi la valutazione del passaggio, la precedente autorizzazione **non si trasferisce** alla nuova interpretazione. Occorre una nuova decisione consapevole e un nuovo consenso. La ricerca di pertinenti estratti è parziale: al massimo **12 grant** approfonditi e **3 estratti** inseriti per richiesta, con conteggio degli omessi. L'assenza di un estratto non dimostra nulla sulla trama.

## Salvataggio, backup, sicurezza

I permessi vengono registrati localmente solo con Web Locks, CAS e autopilot/redazione non attiva. Ogni modifica **disabilita l'autosync GitHub e svuota l'outbox**. Il log non contiene nomi, citazioni, giudizi o motivazioni. Backup ZIP e push GitHub **manuali** possono comunque contenere spoiler.

I ZIP content/full possono includere lo storico, ma un'importazione **revoca tutti i consensi AI ancora attivi** delle valutazioni importate, oppure scarta completamente l'audit dei nuovi consensi se non può aggiungere le revoche entro il limite di 180. L'import non autentica l'autore. Archivi precedenti senza questo campo rimangono compatibili.

Riferimenti: [ADR 0054](../ADR/0054-transfer-consent-ai-role-gate.md), [valutazioni autore](author-transfer-assessments.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
