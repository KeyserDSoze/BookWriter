# Proposte locali di ricerca storica — BookWriter v0.10.6

## Come preparare una ricerca dal capitolo

1. Apri **Redazione multi-agente** e la sezione **Dossier storico** del capitolo. Le scene devono già contenere il testo che vuoi analizzare.
2. Premi **Genera proposte locali**. BookWriter riconosce in memoria del browser alcuni temi del suo vocabolario storico (come telegrafo elettrico, trasporti ferroviari, fotografia, illuminazione a gas), e, quando è scritto sufficientemente vicino al tema, un anno. Non chiama Wikipedia o un modello di IA e non salva il testo.
3. Esamina ciascuna proposta. Premi **Aggiungi alla bozza** soltanto per gli argomenti che vuoi considerare. La textarea delle ricerche rimane **modificabile** e può includere massimo cinque argomenti. Questa operazione non avvia la ricerca.
4. Correggi termini, epoca o formulazioni, verificando che **nessun dettaglio segreto o inedito** si possa dedurre dal tema o dalla data.
5. Se vuoi consultare fonti pubbliche, premi **Cerca fonti pubbliche**. Il browser mostra le **query esatte** che invierebbe a Wikipedia italiana. Puoi annullare: nessuna chiamata viene effettuata. Solo confermando si avvia la normale ricerca storica, con audit, limiti e riapertura dei capitoli congelati quando necessario.

## Cosa viene analizzato

Il riconoscitore è una funzione deterministica locale, non un modello generativo. Non estrae nomi di personaggi, luoghi, citazioni né testi liberi dal manoscritto. Converte un insieme ridotto di parole riconosciute in etichette storiche predefinite, ad esempio `telegrafo` → `Telegrafo elettrico`, e usa soltanto anni di quattro cifre espliciti e vicini nel testo. Senza un anno non tenta di indovinarlo: scrive `storia`.

Scansiona un numero e una lunghezza limitati di scene e restituisce al massimo cinque proposte, senza duplicare lo stesso tema. Questi vincoli riducono i dati esposti, ma limitano la copertura: per romanzi di epoche o discipline non riconosciute l'autore deve scrivere manualmente il tema.

## Sicurezza e responsabilità

- **Nessuna richiesta esterna** durante generazione, anteprima e aggiunta alla bozza. Neanche una chiamata al provider AI: nessun consumo token aggiuntivo.
- **Nessuna scrittura nel dossier** finché non confermi la ricerca. Le proposte non diventano automaticamente prove documentali o canon.
- **Consenso separato** e verificabile sulla query esatta prima che un dato esca dal browser.
- Nonostante la whitelist, anche `Telegrafo elettrico 1848` può rivelare un dettaglio inedito: valuta sempre se la query sia innocua prima di confermarla.
- La ricerca esistente continua a trattare Wikipedia come fonte terziaria, verificando le citazioni letterali ma non l'autenticità o la verità del contenuto.

Riferimenti: [ADR 0029](../ADR/0029-local-historical-query-proposals.md), [dossier storico](historical-sources.md), [issue #23](https://github.com/KeyserDSoze/BookWriter/issues/23).
