/** A manual editor is submitting a snapshot that is no longer current. */
export class BookRevisionConflict extends Error {
  constructor() {
    super("Il libro è cambiato in un'altra scheda: aggiorna i dati prima di salvare.");
    this.name = "BookRevisionConflict";
  }
}
/** The host cannot take exclusive locks at all, so no writer can be proven alone. */
export class LocksUnavailable extends Error {
  constructor() { super("Blocchi di scrittura non disponibili in questo ambiente."); this.name = "LocksUnavailable"; }
}
/** The book is not stored on this host (never imported, or removed meanwhile). */
export class BookNotFound extends Error {
  constructor() { super("Libro non trovato."); this.name = "BookNotFound"; }
}
