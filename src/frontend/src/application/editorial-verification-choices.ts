import type {Activity} from "../domain/types";
import {createEditorialVerificationChoice,
  type EditorialVerificationChoiceStatus}
  from "../domain/editorial-verification-choices";
import {getBook,getDb} from "../infrastructure/db";

/** Private author tracking only. Never updates findings, judgment, freezes,
 * repairs or canon. Serialize with the same local writer/outbox guards as
 * other author-origin decisions and stop any queued automatic GitHub push. */
export async function recordEditorialVerificationChoice(
  bookId:string,expectedUpdatedAt:string,chapterId:string,planKey:string,
  status:EditorialVerificationChoiceStatus,rationale:string,
):Promise<void>{
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessari per annotare la verifica.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Libro già in uso da un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione GitHub in corso.");
      const book=await getBook(bookId);
      if(!book||book.updatedAt!==expectedUpdatedAt)
        throw new Error("Libro modificato: aggiorna prima di annotare il controllo.");
      if(book.status==="running")
        throw new Error("Metti in pausa l'autopilot prima di annotare la verifica.");
      if(!book.editorialCycle||book.editorialCycle.stage!=="blocked")
        throw new Error("Attendi il blocco/conclusione del ciclo editoriale.");
      const now=new Date().toISOString();
      const decision=createEditorialVerificationChoice(
        book,chapterId,planKey,status,rationale,crypto.randomUUID(),now);
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const current=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!current||current.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Libro modificato in un'altra scheda: annotazione non salvata.");
      }
      book.editorialVerificationChoices=[
        ...(book.editorialVerificationChoices??[]),decision];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1))
        .toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),phase:"chapterReview",
        status:"succeeded",createdAt:now,endedAt:now,
        title:"Scelta privata sul controllo editoriale aggiornata",
        reason:"Annotazione autore, separata dal giudizio e dalle correzioni.",
        nextStep:"Il controllo suggerito non è stato eseguito automaticamente.",
        summary:"Scelta privata registrata; autosync sospeso e coda remota svuotata.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
