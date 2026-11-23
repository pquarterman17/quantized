// The wizard's working segment and the one line that says what it analyses,
// split out of usePeakWizard.ts (500-line module ceiling). Pure: no store.
//
// The rows come from the shared resolver through `resolveFitInputs`
// (lib/fitselection, ROW_POLICY.selection, lean: the counts are not recounted
// per render; the line derives them by subtraction from rows it already has).
// This module adds the wizard's own narrowing: the recipe's fit range and the
// non-finite (gap) row drop, and states both.

import { dropGapRows } from "../../../lib/api/finitePairs";
import { analysisColumnName, rowStateCounts } from "../../../lib/analysisInputs";
import { resolveFitInputs } from "../../../lib/fitselection";
import { cutRange } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";

/** What the wizard's input line says (rendered by WizardInputLine). */
export interface WizardInputLine {
  /** "Input: sheet · X: … · Y: … · 840 of 1,200 rows · fit range 10–80 · 3 rows with gaps dropped". */
  text: string;
  /** The row policy in one sentence (the shared tools' note, for this policy). */
  note: string;
  /** Set when there is nothing to fit: the resolver's reason (or the empty fit range). */
  refusal: string | null;
}

export interface WizardSegmentResult {
  segment: {
    x: number[]; y: number[]; kept: number[]; yKey: number;
    binding: { yKey: number; xKey: number | null };
    gapCount: number; sourceCount: number;
  } | null;
  /** Null only when no worksheet is active. */
  line: WizardInputLine | null;
}

const TAIL = " Selected rows and the plot X range are not used; the fit range is.";
/** The shared note's wording and per-kind counts (analysisRowPolicyNote's, for
 *  this policy); the wizard can afford the counting pass, the live fit memos
 *  cannot. */
function noteFor(dataset: Dataset): string {
  const { excludedCount, filteredCount } = rowStateCounts(dataset);
  const of = (count: number, what: string) => `${count.toLocaleString()} ${what} row${count === 1 ? "" : "s"}`;
  const counts = excludedCount + filteredCount === 0 ? " (none at present)" : ` (${of(excludedCount, "excluded")}, ${of(filteredCount, "filtered-out")})`;
  return `Excluded and filtered-out rows are left out${counts}.${TAIL}`;
}
const fmt = (value: number) => Number(value.toPrecision(5)).toString();
const rowsWord = (n: number) => `${n.toLocaleString()} row${n === 1 ? "" : "s"}`;

/** The PLOTTED X + primary Y over the analysis rows (audit P1 #1), range-cut and
 *  gap-pruned, plus the line that states it. */
export function wizardSegment(
  active: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
  lo: number | null,
  hi: number | null,
): WizardSegmentResult {
  if (!active) return { segment: null, line: null };
  const resolved = resolveFitInputs(active, xKey, yKeys, seriesOrder);
  const note = noteFor(active);
  if (!resolved.ok) {
    return { segment: null, line: { text: `Input: ${active.name} · ${resolved.reason}`, note, refusal: resolved.reason } };
  }
  const sel = resolved.fit;
  const cut = cutRange(sel.x, sel.y, lo, hi);
  const pairs = dropGapRows(cut.x, cut.y);
  const segment = {
    x: pairs.x,
    y: pairs.y,
    kept: pairs.keep.map((i) => cut.kept[i]!),
    yKey: sel.yKey,
    binding: { yKey: sel.yKey, xKey: sel.xKey }, // what every wizard overlay is drawn against
    gapCount: pairs.n - pairs.keep.length,
    sourceCount: pairs.n,
  };
  const head = [
    `Input: ${active.name}`,
    `X: ${analysisColumnName(active, sel.xKey)}`,
    `Y: ${analysisColumnName(active, sel.yKey)}`,
  ];
  const refusal = segment.x.length === 0 ? "No finite rows fall inside the fit range." : null;
  if (refusal) return { segment, line: { text: `${head.join(" · ")} · ${refusal}`, note, refusal } };
  const parts = [...head, `${segment.x.length.toLocaleString()} of ${active.data.time.length.toLocaleString()} rows`];
  if (lo !== null || hi !== null) parts.push(`fit range ${lo === null ? "start" : fmt(lo)}–${hi === null ? "end" : fmt(hi)}`);
  if (segment.gapCount > 0) parts.push(`${rowsWord(segment.gapCount)} with gaps dropped`);
  return { segment, line: { text: parts.join(" · "), note, refusal: null } };
}
