/** The book changed on this device while a GitHub save was being prepared. Not a failure of the
 * remote and not a conflict: the snapshot just taken is stale, so the save is simply tried again
 * a moment later. Kept apart from github-sync so the queue worker can recognise it. */
export class LocalBookChanged extends Error {
  constructor() {
    super("Il libro è cambiato mentre veniva preparato il salvataggio: riprovo tra poco con la versione più recente.");
    this.name = "LocalBookChanged";
  }
}
