import type { BookProject } from "./types";
import { buildNarrativeEventLedger, type CurrentEventLedgerEntry } from "./narrative-event-ledger";

/** Navigational suggestions only. None of these is a verified narrative contradiction. */
export type NarrativeContinuityHintKind =
  "post_death_activity" | "repeated_death" | "declared_date_backtrack";

export interface NarrativeContinuityHint {
  kind: NarrativeContinuityHintKind;
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

/** Read-only and local: never infer aliases, private memory, possessions or causal truth.
 * Date comparisons use ONLY valid YYYY-MM-DD scene labels, never the narrative's actual clock. */
export function buildNarrativeContinuityHints(book: BookProject): NarrativeContinuityHintIndex {
  const attested = buildNarrativeEventLedger(book).currentAffirmed;
  const groups = new Map<string, CurrentEventLedgerEntry[]>();
  for (const entry of attested) {
    const key = entry.candidate.actor.normalize("NFC").toLocaleLowerCase("it");
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const all: NarrativeContinuityHint[] = [];
  for (const group of groups.values()) {
    group.sort(sequenceOrder);
    let lastDeath: CurrentEventLedgerEntry | undefined;
    let lastDated: CurrentEventLedgerEntry | undefined;
    for (const entry of group) {
      const day = isoSceneDay(entry.candidate.sceneDate);
      if (day) {
        if (lastDated && inLaterChapter(lastDated, entry) &&
            day < isoSceneDay(lastDated.candidate.sceneDate)!) {
          all.push({
            kind: "declared_date_backtrack", actor: entry.candidate.actor,
            earlier: lastDated, later: entry,
            explanation: "Le date ISO dichiarate nelle scene diminuiscono nell'ordine dei capitoli. " +
              "Un flashback o una narrazione non lineare possono essere intenzionali.",
          });
        }
        lastDated = entry;
      }
      if (entry.candidate.kind !== "state_change_mention") continue;
      const action = entry.candidate.detail.toLocaleLowerCase("it");
      if (action === "risorge") {
        // An explicit resurrection between two attestations explains the literal sequence;
        // this still does not prove anyone actually came back to life.
        lastDeath = undefined;
      } else if (action === "muore") {
        if (lastDeath && inLaterChapter(lastDeath, entry)) {
          all.push({
            kind: "repeated_death", actor: entry.candidate.actor,
            earlier: lastDeath, later: entry,
            explanation: "Due menzioni di morte dello stesso nome compaiono in capitoli distinti, " +
              "senza una menzione attestata di resurrezione intermedia. Verificare contesto e omonimie.",
          });
        }
        lastDeath = entry;
      } else if (lastDeath && LATER_ACTIONS.has(action) &&
                 inLaterChapter(lastDeath, entry)) {
        all.push({
          kind: "post_death_activity", actor: entry.candidate.actor,
          earlier: lastDeath, later: entry,
          explanation: "Dopo una menzione attestata di morte, lo stesso nome compie un'altra " +
            "azione in un capitolo successivo. Flashback, omonimie o svolte fantastiche possono spiegarlo.",
        });
      }
    }
  }
  const priorities: Record<NarrativeContinuityHintKind, number> = {
    repeated_death: 0, post_death_activity: 1, declared_date_backtrack: 2,
  };
  all.sort((a, b) => sequenceOrder(a.later, b.later) ||
    priorities[a.kind] - priorities[b.kind] ||
    sequenceOrder(a.earlier, b.earlier) || a.actor.localeCompare(b.actor, "it"));
  return {
    method: "bounded_attested_literal_pairs_v1",
    hints: all.slice(0, MAX_NARRATIVE_CONTINUITY_HINTS),
    omittedHintCount: Math.max(0, all.length - MAX_NARRATIVE_CONTINUITY_HINTS),
    inspectedAttestationCount: attested.length,
  };
}
