# Confronto critico sulle piste condivise — v0.11.22

Quando hai autorizzato il ruolo **Giudice critico** a consultare una valutazione di possibile comunicazione (v0.11.21), il direttore editoriale deve **riesaminarla esplicitamente** prima di concludere un giudizio su un possibile conflitto di conoscenze.

## Cosa fa

Se esiste almeno un rilievo sulla conoscenza di un personaggio con prova testuale ancora valida, il giudice riceve fino a **tre brevi citazioni** già autorizzate. Per ciascuna deve restituire:

- Identificazione esatta della fonte: capitolo, scena, offset, citazione, mittente, destinatario e classificazione dell'autore.
- **Lettura propria**: accesso possibile, fonte inattendibile/non pertinente oppure accesso indeterminato.
- **Posizione rispetto all'autore**: concorda, contesta oppure non decide, con spiegazione autonoma di almeno 30 caratteri.
- Conclusione complessiva motivata.

BookWriter confronta nuovamente tutte le fonti con il testo congelato e il consenso attuale. Se ne manca una o compaiono citazioni inventate, duplicate abusivamente, modificate o revocate, il giudizio è respinto. **Senza consenso o senza finding knowledge valido, questa analisi non può comparire**. Una citazione condivisa non prova che il destinatario abbia ascoltato, creduto o acquisito una notizia.

## Sicurezza della remediation

Quando il giudice conclude che **un passaggio resta possibile o incerto**, non può approvare una correzione narrativa motivata dall'impossibilità di accesso all'informazione. La revisione non può però essere approvata automaticamente neanche se il giudice considera tutte le piste inattendibili: servono sempre le altre prove e verifiche richieste dai gate di continuità e conoscenza.

In caso di revoca o modifica della fonte, BookWriter rivalida anche il giudizio già registrato **prima di inviare una scena alla riparazione AI**. Se la prova non è più corrente, non riutilizza la vecchia autorizzazione.

## Dove si vede

Nel riepilogo della **Redazione multi-agente → Decisione finale**, compare un riquadro **Confronto indipendente con le piste autorizzate**, con citazioni, classificazione dell'autore, lettura del giudice, eventuali obiezioni e conclusione.

Il confronto non riscrive automaticamente nulla, non cambia il canone o i segreti, non produce nuove chiamate AI e resta escluso dai cinque lettori ciechi. Le vecchie autorizzazioni delle conoscenze non sostituiscono il consenso specifico sulle piste. ZIP e push GitHub manuali possono comunque contenere citazioni e spoiler, e un archivio non autentica le decisioni.

Riferimenti: [ADR 0055](../ADR/0055-critical-judge-transfer-challenge.md), [consenso sulle piste](transfer-consent-ai.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
