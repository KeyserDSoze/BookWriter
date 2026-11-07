# Conferma degli eventi narrativi — BookWriter v0.11.4

Dopo la v0.11.3, che identifica alcune **menzioni letterali** di scoperte, consegne e cambi di stato, puoi ora entrare in **Redazione multi-agente → Indice eventi candidati** e aprire **Decisione autore** accanto a una menzione.

## Le tue tre scelte

- **Conferma fatto narrativo:** dichiari che la frase descrive un evento effettivamente avvenuto nel mondo del romanzo, non soltanto un dialogo, una menzogna o un sogno.
- **Respingi come fatto:** indichi che la frase è presente, ma non rappresenta un fatto narrativo canonico.
- **Ritira dichiarazione:** rettifichi una scelta precedente, senza cancellarne lo storico.

Ogni azione richiede una **motivazione di 24–400 caratteri** e una conferma che mostra il testo esatto e l'offset. Vengono salvati capitolo/scena, frase, data della scelta e riferimento alla versione congelata dell'intera scena. Le dichiarazioni sono un audit dell'intenzione dell'autore, non una firma digitale. Restano consultabili nello storico.

## Quando le conferme contano

La dichiarazione positiva viene considerata **attiva** solo finché la scena originale resta canonica, congelata e con lo stesso testo della versione confermata. Se riapri il capitolo o cambi una parola altrove nella stessa scena, la conferma diventa **obsoleta** e non entra più nei campioni della redazione finché non la riconfermi.

Gli specialisti della continuità e il direttore possono leggere le sole conferme positive attive **assieme alle scene precedenti già campionate**. Le motivazioni non vengono incluse nei nuovi dati dei prompt; i cinque lettori ciechi restano separati. Il giudice rimane critico: la conferma non prova che ogni interpretazione sia coerente con tutto il romanzo.

Quando confermi per la prima volta un fatto o ritiri/respinge una precedente conferma, i capitoli **successivi già scritti** perdono il freeze e richiedono una nuova review; il capitolo che contiene la frase **rimane congelato**, e il testo non viene modificato. Il sistema ripristina il riassunto precedente e mette in pausa il nuovo ciclo, da riprendere manualmente. Un semplice rifiuto di una menzione mai confermata **non** invalida capitoli.

La sincronizzazione automatica viene disattivata e la coda GitHub svuotata anche per una decisione senza rewind. **Nessuna chiamata AI o ricerca esterna** parte durante la dichiarazione. Le nuove review potranno consumare token soltanto quando deciderai di avviarle.

## Backup e sicurezza

Uno ZIP può essere modificato: le dichiarazioni importate vengono **conservate ma marcate come da riconfermare** sul dispositivo, invece di entrare automaticamente nel canone. L'importazione non è un'identificazione crittografica dell'autore.

Il campo motivazione potrebbe entrare nel backup e nella repository del libro se scegli una sincronizzazione manuale; non inserirvi password o segreti non necessari. L'indice estrae al massimo 80 menzioni per libro e al momento l'interfaccia mostra le prime 30: le altre necessitano ancora di paginazione.

**Limiti:** le conferme attestano soltanto interpretazioni umane di frasi riconosciute dal piccolo estrattore italiano; non aggiornano automaticamente conoscenze, possessi, cause ed effetti o verità storiche in `memory`. Il registro semantico completo è uno sviluppo successivo.

Riferimenti: [ADR 0037](../ADR/0037-explicit-author-event-decisions.md), [indice eventi candidati](narrative-event-candidates.md), [issue #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
