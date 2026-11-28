// Significance marks from p-values the user SUPPLIES (plan item 23): brackets
// with a star mark (or the p-value itself) between groups of a box / violin /
// strip / bar plot. Pure: no DOM, no store, no fetch.
//
// Unlike `statComparisons` (which runs Tukey or Dunnett itself, at a fixed
// alpha), nothing here tests anything. The user picks WHERE the p-values come
// from -- a saved post-hoc statistics result, or three worksheet columns
// (group A, group B, p) -- and there is no default source. What is drawn is
// fully determined by the persisted `SigMarks`:
//   * a pair's mark is the strictest level whose cut-off the p is STRICTLY
//     below (`* < 0.05`: p = 0.05 is not significant);
//   * a pair below no level is "ns", drawn only when `showNs`;
//   * `showP` writes the p-value (`p = 0.012`) in place of the mark.
// The laid-out brackets use `statCompareLayout` and the export posts them
// verbatim, so screen and figure agree (`tests/fixtures/wire/sig_marks.json`).

import { formatP } from "./statComparisons";

export interface SigLevel {
  /** What is drawn for a pair below `below`: "*", "**", "***", "†" ... */
  mark: string;
  below: number;
}

export type SigSource =
  | { kind: "result"; /** An analysis result's id; "" until one is picked. */ resultId: string }
  | {
      kind: "sheet"; datasetId: string;
      /** Channel indices of the group A, group B and p-value columns; -1 = not picked yet. */
      a: number; b: number; p: number;
    };

export interface SigMarks {
  source: SigSource;
  levels: SigLevel[];
  showP: boolean;
  showNs: boolean;
}

export const DEFAULT_SIG_LEVELS: readonly SigLevel[] = [
  { mark: "*", below: 0.05 }, { mark: "**", below: 0.01 }, { mark: "***", below: 0.001 },
];
export const MAX_SIG_LEVELS = 4;
export const MAX_MARK_LENGTH = 6;

/** Why `levels` cannot be used, or null. Cut-offs must lie in (0, 1] and fall
 *  strictly as the marks add stars; every mark is 1..6 printable characters. */
export function levelsProblem(levels: readonly SigLevel[]): string | null {
  if (levels.length < 1 || levels.length > MAX_SIG_LEVELS) return `Use 1 to ${MAX_SIG_LEVELS} thresholds`;
  for (const [i, l] of levels.entries()) {
    if (!(l.below > 0 && l.below <= 1)) return `Threshold ${i + 1}: the cut-off must be above 0 and at most 1`;
    if (l.mark.length < 1 || l.mark.length > MAX_MARK_LENGTH || l.mark.trim() !== l.mark || [...l.mark].some((c) => c.charCodeAt(0) < 32)) {
      return `Threshold ${i + 1}: the mark must be 1 to ${MAX_MARK_LENGTH} characters, with no space at either end`;
    }
    if (i > 0 && !(l.below < levels[i - 1].below)) return `Threshold ${i + 1}: cut-offs must fall (each below the one before)`;
  }
  return null;
}

/** A persisted `sig`, or null when it is not a well-formed one. Absent
 *  `levels` / flags take their defaults; a bad value rejects the whole object
 *  (fail closed: nothing is drawn rather than something half-right). */
export function normalizeSig(raw: unknown): SigMarks | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const s = o.source as Record<string, unknown> | null | undefined;
  let source: SigSource;
  if (s?.kind === "result" && typeof s.resultId === "string") source = { kind: "result", resultId: s.resultId };
  else if (s?.kind === "sheet" && typeof s.datasetId === "string" && [s.a, s.b, s.p].every((c) => Number.isInteger(c))) {
    source = { kind: "sheet", datasetId: s.datasetId, a: s.a as number, b: s.b as number, p: s.p as number };
  } else return null;
  let levels: SigLevel[] = DEFAULT_SIG_LEVELS.map((l) => ({ ...l }));
  if (o.levels !== undefined) {
    if (!Array.isArray(o.levels)) return null;
    levels = [];
    for (const l of o.levels as unknown[]) {
      const e = l as { mark?: unknown; below?: unknown } | null;
      if (typeof e?.mark !== "string" || typeof e.below !== "number") return null;
      levels.push({ mark: e.mark, below: e.below });
    }
    if (levelsProblem(levels)) return null;
  }
  for (const f of [o.showP, o.showNs]) if (f !== undefined && typeof f !== "boolean") return null;
  return { source, levels, showP: o.showP === true, showNs: o.showNs === true };
}

/** The mark of the strictest level `p` is strictly below, or null (ns). */
export function markFor(p: number, levels: readonly SigLevel[]): string | null {
  let best: SigLevel | null = null;
  for (const l of levels) if (p < l.below && (best === null || l.below < best.below)) best = l;
  return best ? best.mark : null;
}

/** `p = 0.012`, or `p < 0.0001` below that. ASCII. */
export function pText(p: number): string {
  return p < 0.0001 ? "p < 0.0001" : `p = ${formatP(p)}`;
}

/** What a pair's bracket says, or null when it is not drawn (ns, hidden). */
export function sigLabel(p: number, sig: Pick<SigMarks, "levels" | "showP" | "showNs">): string | null {
  const mark = Number.isFinite(p) ? markFor(p, sig.levels) : null;
  if (mark === null && !sig.showNs) return null;
  return sig.showP ? pText(p) : (mark ?? "ns");
}

/** The footnote: where the p-values came from, and what the marks mean. */
export function sigNote(from: string, sig: Pick<SigMarks, "levels" | "showP" | "showNs">): string {
  const cut = (l: SigLevel) => `${l.mark} p<${l.below}`;
  const asc = [...sig.levels].sort((x, y) => y.below - x.below);
  const key = sig.showP ? "p-values shown" : asc.map(cut).join(" ");
  const tail = sig.showNs ? "ns = not significant" : "ns not drawn";
  const head = `p-values from ${from.length > 80 ? `${from.slice(0, 79)}...` : from}`;
  return `${head}; ${key}; ${tail}`.slice(0, 300);
}
