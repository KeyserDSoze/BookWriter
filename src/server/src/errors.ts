export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const badRequest = () => new ApiError(422, "invalid_request", "Richiesta non valida o consenso mancante.");
