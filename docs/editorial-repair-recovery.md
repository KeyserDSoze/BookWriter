# Recupero di una remediation bloccata (v0.11.71)

Quando il giudice ha approvato una correzione, BookWriter controlla fonti e prove prima della richiesta al modello e ancora prima di applicare la prosa. Se una citazione storica è stata ritirata, una testimonianza precedente è obsoleta o il checkpoint non è riprendibile, `repair` si arresta.

Ora **Recupera checkpoint e ricomincia** è disponibile anche per queste remediation non valide. Una correzione ancora sana prosegue e non offre un riavvio superfluo.

## Procedura

1. Esporta prima un backup ZIP; l'operazione non ripristina una versione precedente della scena.
2. Metti in pausa l'autopilot, consulta la causa e premi **Recupera checkpoint e ricomincia**. Puoi annullare senza effetti.
3. Dopo conferma, il ciclo precedente viene archiviato integralmente: giudizio, report, cursor e tornate precedenti. Il nuovo ciclo riparte da zero **soltanto quando premi Riprendi**, con nuovi costi AI.
4. **Le remediation eventualmente già salvate rimangono nel testo corrente**, compreso lo stato draft delle scene. Non è un rollback: il giudice nuovo dovrà rivederle senza considerare il verdetto precedente approvazione automatica.
5. Autosync GitHub è disabilitato, outbox rimossa, Activity di audit e archivio del libro aggiornati atomicamente. Il backup ZIP conserva gli snapshot.

## Sicurezza e limiti

Web Locks writer/outbox, controllo ottimistico di concorrenza, conferma esplicita e massimo otto snapshot. I cicli `blocked` e `reconcile` seguono procedure diverse. Non vengono inviate richieste ai modelli o alle fonti durante il controllo o il recupero.

Se il problema nasce da prosa malformata, un contesto troppo lungo o fonti realmente assenti, è possibile che la nuova review richieda intervento umano. La provenienza di un documento non certifica la verità storica.

[ADR 0103](../ADR/0103-supervised-stale-repair-recovery.md) · [Issue #108](https://github.com/KeyserDSoze/BookWriter/issues/108) · [Epic #20](https://github.com/KeyserDSoze/BookWriter/issues/20).
