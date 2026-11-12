/**
 * Generation fence for sensitive asynchronous local trace lookups.
 * Selection, book, consent or unmount invalidates all earlier reads.
 */
export class AiTraceReadFence {
  private generation=0;

  begin():number{return ++this.generation;}

  invalidate():void{this.generation++;}

  isCurrent(ticket:number):boolean{
    return Number.isSafeInteger(ticket) && ticket>0 && ticket===this.generation;
  }
}
