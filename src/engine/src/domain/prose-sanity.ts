/** Structural sanity of model-written scene prose, before it can become a scene or canon.
 * Deliberately lenient: it only rejects replies that are clearly not prose, or a rewrite that
 * silently dropped most of the scene. Quality judgments stay with the editorial board. */
const MIN_REWRITE_RATIO = 0.5;
const RATIO_APPLIES_FROM = 600;

export function assertScenePlausible(text: string, previous?: string): void {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("La risposta è vuota: nessuna scena applicata.");
  if (/^```/.test(trimmed))
    throw new Error("Il modello ha restituito un blocco di codice invece della scena: nessun testo applicato.");
  if (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed))
    throw new Error("Il modello ha restituito JSON invece della prosa della scena: nessun testo applicato.");
  const before = previous?.trim().length ?? 0;
  if (before >= RATIO_APPLIES_FROM && trimmed.length < before * MIN_REWRITE_RATIO)
    throw new Error(`La riscrittura è molto più corta della bozza (${trimmed.length} contro ${before} caratteri): probabile perdita di contenuto. Nessun testo applicato.`);
}
