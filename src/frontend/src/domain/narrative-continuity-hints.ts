import type { BookProject } from "./types";
import { buildNarrativeEventLedger, type CurrentEventLedgerEntry } from "./narrative-event-ledger";

/** Navigational suggestions only. None of these is a verified narrative contradiction. */
export type NarrativeContinuityHintKind =
  "post_death_activity" | "repeated_death" | "declared_date_backtrack";

export interface NarrativeContinuityHint {
  kind: NarrativeContinuityHintKind;
  /** A human-selected alias preview is never a canonical identity claim. */
  identityBasis: "literal_name" | "alias_preview";
  actor: string;
  earlier: CurrentEventLedgerEntry;
  later: CurrentEventLedgerEntry;
  explanation: string;
}
export interface NarrativeContinuityHintIndex {
  method: "bounded_attested_literal_pairs_v1";
  hints: NarrativeContinuityHint[];
  omittedHintCount: number;
  inspectedAttestationCount: number;
  /** Only true for a valid, explicitly requested pair of attested names. */
  aliasPreviewActive: boolean;
}

export interface NarrativeAliasPreview {
  first: string;
  second: string;
}

export const MAX_NARRATIVE_CONTINUITY_HINTS = 40;
const LATER_ACTIONS = new Set(["parte", "arriva", "fugge", "ritorna", "scompare"]);

function isoSceneDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year! >= 1 && month! >= 1 && month! <= 12 &&
    day! >= 1 && day! <= days[month! - 1]! ? value : null;
}

function inLaterChapter(a: CurrentEventLedgerEntry, b: CurrentEventLedgerEntry): boolean {
  return b.candidate.chapterNumber > a.candidate.chapterNumber &&
    b.candidate.chapterId !== a.candidate.chapterId;
}

function sequenceOrder(a: CurrentEventLedgerEntry, b: CurrentEventLedgerEntry): number {
  return a.candidate.chapterNumber - b.candidate.chapterNumber ||
    a.candidate.sceneNumber - b.candidate.sceneNumber ||
    a.candidate.offset - b.candidate.offset ||
    a.decision.id.localeCompare(b.decision.id);
}

function nameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("it");
}

/** Emit only anchored literal comparisons. An alias preview emits CROSS-name
 * comparisons exclusively, so it can never suppress the original literal findings. */
function collectGroupHints(
  all: NarrativeContinuityHint[],
  group: CurrentEventLedgerEntry[],
  basis: NarrativeContinuityHint["identityBasis"],
): void {
  const sequence = [...group].sort(sequenceOrder);
  let lastDeath: CurrentEventLedgerEntry | undefined;
  let lastDated: CurrentEventLedgerEntry | undefined;
  const eligible = (a: CurrentEventLedgerEntry, b: CurrentEventLedgerEntry): boolean =>
    inLaterChapter(a, b) && (basis === "literal_name" ||
      nameKey(a.candidate.actor) !== nameKey(b.candidate.actor));
  const add = (kind: NarrativeContinuityHintKind, earlier: CurrentEventLedgerEntry,
    later: CurrentEventLedgerEntry, explanation: string): void => {
    if (!eligible(earlier, later)) return;
    all.push({kind, identityBasis: basis, actor: later.candidate.actor,
      earlier, later, explanation});
  };

  for (const entry of sequence) {
    const day = isoSceneDay(entry.candidate.sceneDate);
    if (day) {
      if (lastDated && day < isoSceneDay(lastDated.candidate.sceneDate)!) {
        add("declared_date_backtrack", lastDated, entry,
          "Le date ISO dichiarate nelle scene diminuiscono nell'ordine dei capitoli. " +
          "Flashback o una narrazione non lineare possono essere intenzionali.");
      }
      lastDated = entry;
    }
    if (entry.candidate.kind !== "state_change_mention") continue;
    const action = entry.candidate.detail.toLocaleLowerCase("it");
    if (action === "risorge") {
      // Hypothetical aliasing may include an intermediate resurrection from either name.
      // It suppresses only this overlay's subsequent comparisons, not literal findings.
      lastDeath = undefined;
    } else if (action === "muore") {
      if (lastDeath) {
        add("repeated_death", lastDeath, entry,
          "Due menzioni di morte potrebbero riferirsi alla stessa persona, senza una " +
          "menzione attestata di resurrezione intermedia. Verificare contesto e omonimie.");
      }
      lastDeath = entry;
    } else if (lastDeath && LATER_ACTIONS.has(action)) {
      add("post_death_activity", lastDeath, entry,
        "Dopo una menzione attestata di morte, una successiva azione potrebbe " +
        "riguardare la stessa persona. Flashback, omonimie o svolte fantastiche " +
        "possono spiegarla.");
    }
  }
}

/** Read-only, local, and bounded. Alias previews are author-selected, temporary,
 * non-transitive, and ADD only comparisons across the selected names. They never
 * create identity claims, change the base findings, or change the book. */
export function buildNarrativeContinuityHints(
  book: BookProject, aliasPreview?: NarrativeAliasPreview,
): NarrativeContinuityHintIndex {
  const attested = buildNarrativeEventLedger(book).currentAffirmed;
  const groups = new Map<string, CurrentEventLedgerEntry[]>();
  for (const entry of attested) {
    const key = nameKey(entry.candidate.actor);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const literalHints: NarrativeContinuityHint[] = [];
  for (const group of groups.values()) collectGroupHints(literalHints, group, "literal_name");
  const previewHints: NarrativeContinuityHint[] = [];

  const first = aliasPreview?.first?.trim() ?? "";
  const second = aliasPreview?.second?.trim() ?? "";
  const firstKey = nameKey(first), secondKey = nameKey(second);
  const aliasPreviewActive = firstKey.length > 0 && secondKey.length > 0 &&
    firstKey !== secondKey && groups.has(firstKey) && groups.has(secondKey);
  if (aliasPreviewActive) {
    // Exactly one explicit pair, no transitive or fuzzy expansion.
    collectGroupHints(previewHints, [...groups.get(firstKey)!, ...groups.get(secondKey)!],
      "alias_preview");
  }

  const priorities: Record<NarrativeContinuityHintKind, number> = {
    repeated_death: 0, post_death_activity: 1, declared_date_backtrack: 2,
  };
  const sortHints = (a: NarrativeContinuityHint, b: NarrativeContinuityHint): number =>
    sequenceOrder(a.later, b.later) ||
    priorities[a.kind] - priorities[b.kind] ||
    sequenceOrder(a.earlier, b.earlier) || a.actor.localeCompare(b.actor, "it");
  // The original 40 literal slots are protected: alias hypotheses never evict
  // a pre-existing finding merely because the overlay adds more suggestions.
  const all = [...literalHints.sort(sortHints), ...previewHints.sort(sortHints)];
  return {
    method: "bounded_attested_literal_pairs_v1",
    hints: all.slice(0, MAX_NARRATIVE_CONTINUITY_HINTS),
    omittedHintCount: Math.max(0, all.length - MAX_NARRATIVE_CONTINUITY_HINTS),
    inspectedAttestationCount: attested.length,
    aliasPreviewActive,
  };
}
