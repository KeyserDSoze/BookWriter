# Testimoni narrativi precedenti: rivalidazione durante la redazione (v0.11.70)

Quando un revisore segnala una possibile contraddizione con un capitolo precedente, BookWriter distingue due tipi di riferimento: un evento menzionato nella prosa e **attestato dall'autore** (`narrativeConflict`), oppure una citazione letterale di scena precedente congelata, **non attestata** (`priorSceneConflict`). Nessuno dei due dimostra da solo un errore narrativo.

Anche se il testo della scena in revisione non cambia, una testimonianza precedente può diventare obsoleta. Può essere revocata una decisione autore, modificato un collegamento di nomi, riaperto il capitolo da cui proviene la citazione o cambiata la selezione dei passi pertinenti. Le citazioni originarie restano conservate per audit, ma **non possono più autorizzare il passaggio al giudice** sulla base di un checkpoint ancora numericamente completo.

## Comportamento

Il gate ricalcola in locale, per ogni rapporto marcato, il pacchetto di testimoni che il relativo specialista avrebbe potuto vedere **ora**, sull'esatto segmento della scena corrente. Soltanto continuità, cronologia, segreti e voce dei personaggi possono riportare queste marche e soltanto una per rilievo. I riferimenti non più attuali impediscono di continuare con i revisori successivi, il giudice e il freeze. Non vengono interrogati modelli o servizi esterni durante questa verifica.

In review `review`, `adjudicate` o `summary`, il pannello mostra il motivo e offre **Recupera checkpoint e ricomincia**. È un'azione esplicita: archivia integralmente i rapporti precedenti e ricomincia dal primo revisore senza modificare il romanzo; l'autore dovrà poi premere **Riprendi**. Le remediation accettate conservano anche i propri controlli live, per non usare testimonianze ritirate in una riparazione importata o ripresa.

La rivalidazione prova soltanto che il riferimento è ancora presente e autorizzato nel campione locale. Non verifica automaticamente identità dei personaggi, verità degli eventi, interpretazione delle scene o fatti storici. Il giudice deve valutare spiegazioni alternative (flashback, sogni, narratori inaffidabili, omonimie) e può respingere un rilievo.

[ADR 0102](../ADR/0102-live-prior-narrative-witnesses.md) · [Issue #107](https://github.com/KeyserDSoze/BookWriter/issues/107) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
