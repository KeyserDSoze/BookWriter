# Quando cambi una fonte storica: rivalidazione dei capitoli

Dalla **v0.11.1**, modificare un dossier storico di un capitolo già congelato non si limita a cancellare il freeze dei capitoli successivi: BookWriter conserva anche l'**origine della rivalidazione**. Per esempio, se escludi una trascrizione OCR nel capitolo 2, i capitoli 3 e 4 già scritti mostreranno un avviso **«dossier storico modificato nel capitolo 2»**.

Il meccanismo vale per aggiunta di fonti Wikipedia/Wikisource, bibliografia, catalogo e ispezioni LoC, riferimenti IIIF, OCR e collazioni, trascrizioni manuali, quarantene di fonti e relazioni di provenienza dichiarate dall'autore. La scelta di quali query pubbliche consultare e la conferma dei diritti **rimangono esplicite e separate**.

## Come procede la redazione

- **Capitolo d'origine:** la fonte viene aggiunta/aggiornata/esclusa nella sua struttura locale; il capitolo congelato si riapre per la normale review a dodici agenti. Nessuna prosa viene modificata automaticamente dalla sola operazione sul dossier.
- **Capitoli successivi già scritti:** perdono approvazioni e sinossi con le regole esistenti; il marker `historical_evidence` ne registra origine, data e causa, senza copiare segreti o testo delle fonti.
- **Review in ordine:** per esaminare un capitolo successivo, tutti i precedenti devono essere scritti, canonici e congelati.
- **Contesto dei controlli:** specialisti continuità, timeline, segreti, voce e, soltanto per questa causa, storico, più il direttore, confrontano un campione di scene pubbliche precedenti. Le finestre riportano identificativi, offset e limiti; i cinque lettori ciechi non vedono la nuova documentazione.
- **Decisione:** il direttore valuta criticamente ogni rilievo, senza assumere che un estratto del romanzo confermi un fatto storico. Soltanto dopo la review completa il capitolo viene nuovamente congelato, con audit della rivalidazione.

## Ciò che non è verificato

Un documento nuovo può essere irrilevante, una fonte esclusa può non cambiare nulla e un modello può sbagliare. Il marker non è una diagnosi di errore storico; nemmeno l'approvazione del direttore certifica la verità del documento o la coerenza semantica dell'intero libro. I campioni sono limitati, non tutti i capitoli vengono letti integralmente. Restano validi il consenso sui query pubblici, i Web Locks, la disattivazione dell'autosync e il divieto di sincronizzare capitoli non riapprovati.

Riferimenti: [ADR 0034](../ADR/0034-historical-dossier-revalidation-convergence.md), [catena cross-chapter](cross-chapter-continuity.md), [dossier storico](historical-sources.md), issue #20 e #23.
