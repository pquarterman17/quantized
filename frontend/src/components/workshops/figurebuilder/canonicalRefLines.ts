// Pure reference-line canonical-draft helpers (F2.3d): derive a display row
// per reference line (axis-scoped label, e.g. "X reference 1", "Y reference 1")
// and add/patch/remove one line by id in the draft's `refLines` array. No
// React/store import -- unit-testable standalone, same shape as
// canonicalShapes.ts.
//
// `refLines` is a `PlotView` field (`decor.referenceLines`, see
// lib/figureContract.ts) with NO `FigureOverrides` equivalent -- exactly the
// F2.3b/F2.3c situation for seriesStyles and shapes -- so the hook writes it
// straight through `setCanonicalView`, not the publication-overrides delta
// bridge.
//
// Scope matches what the Stage already does, field for field, so the detached
// panel adds no capability the live plot lacks (the F2.3c consistency rule):
// `Inspector/RefLinesCard.tsx` adds a line (axis + value), removes one, and
// drag-on-canvas moves one (`updateRefLine`, value only). So VALUE is
// editable, remove and add exist, and AXIS is read-only per row -- nothing in
// this app flips an existing line's axis, and offering that only here would
// be a one-sided divergence. Unlike shapes (F2.3c), ADD belongs here: a
// reference line is fully specified by an axis and a number, so it needs no
// live canvas to draw on -- it is the same two-field form RefLinesCard uses.

import type { RefLine } from "../../../lib/types";

export interface RefLineRow {
  id: string;
  axis: RefLine["axis"];
  /** Axis-scoped, 1-based ACCESSIBLE label ("X reference 1", "Y reference 1").
   *  Axis-scoped rather than flat because the axis is the one property a row
   *  cannot change -- it identifies the line more usefully than draw order,
   *  and stays stable as same-axis siblings come and go. */
  label: string;
  /** What the row actually SHOWS ("X 1"). The panel is ~210px wide and the
   *  full label wraps mid-phrase there; "reference" is already said by the
   *  group title above every row, so the visible text drops it and `label`
   *  carries the full phrase to assistive tech. Same visible-vs-accessible
   *  split PropertyNumberField's own `ariaLabel` prop documents. */
  short: string;
}

/** One row per line, in the draft's own array order (reference lines have no
 *  separate display-order field). */
export function deriveRefLineRows(lines: readonly RefLine[]): RefLineRow[] {
  const seen = new Map<RefLine["axis"], number>();
  return lines.map((line) => {
    const n = (seen.get(line.axis) ?? 0) + 1;
    seen.set(line.axis, n);
    const axis = line.axis.toUpperCase();
    return { id: line.id, axis: line.axis, label: `${axis} reference ${n}`, short: `${axis} ${n}` };
  });
}

/** Merge `patch` into the one line matching `id`; every other line is returned
 *  unchanged (by reference). A no-op array for an unknown id -- callers don't
 *  special-case a missing line. */
export function patchRefLineList(
  lines: readonly RefLine[],
  id: string,
  patch: Partial<Omit<RefLine, "id">>,
): RefLine[] {
  return lines.map((line) => (line.id === id ? { ...line, ...patch } : line));
}

/** Drop the one line matching `id`. No-op (same-length array) for an unknown id. */
export function removeRefLineFromList(lines: readonly RefLine[], id: string): RefLine[] {
  return lines.filter((line) => line.id !== id);
}

/** Which draft line a preview hit element (`refline:N`) refers to, or null.
 *
 *  N is the RENDER REQUEST's array position, not the draft's: `figureSpec`'s
 *  `viewOverrides` builds `overrides.ref_lines` as
 *  `st.refLines.filter((r) => Number.isFinite(r.value))`, so a draft holding a
 *  non-finite value (reachable from a legacy `.dwk` — `appendRefLine` and the
 *  Stage's own add both reject one) shifts every later index by one. Applying
 *  the SAME filter here is the whole mapping; indexing `refLines[n]` directly
 *  would silently drag the wrong line.
 *
 *  Kept next to the filter's meaning rather than inlined at the call site so
 *  the two cannot drift apart unnoticed — if `viewOverrides` ever drops a
 *  different set, this function is the one place to follow it. */
export function refLineIdForHit(lines: readonly RefLine[], hitIndex: number): string | null {
  if (!Number.isInteger(hitIndex) || hitIndex < 0) return null;
  return lines.filter((line) => Number.isFinite(line.value))[hitIndex]?.id ?? null;
}

/** Id prefix for lines created inside a Publication Preview draft.
 *
 *  Deliberately NOT the store's `ref-` prefix. `useApp.ts` mints those from a
 *  module-global `_refSeq` counter that knows nothing about a detached draft;
 *  if this module also emitted `ref-N`, a draft could create `ref-5`, Apply it
 *  into the window document, and then a later Stage "Add" -- with `_refSeq`
 *  still at 2 -- would mint `ref-3`, `ref-4`, `ref-5` and collide with it.
 *  Ids only have to be unique within one array, so a separate namespace is
 *  the whole fix. */
const DRAFT_PREFIX = "pref-";

/** Append a line with a draft-namespaced id one past the highest existing
 *  draft id, so a remove-then-add cannot reuse a live id. Non-finite values
 *  are rejected (returns the list unchanged) -- an Inf/NaN reference line
 *  renders nowhere and would serialize as `null` through the export wire. */
export function appendRefLine(
  lines: readonly RefLine[],
  axis: RefLine["axis"],
  value: number,
): RefLine[] {
  if (!Number.isFinite(value)) return [...lines];
  const highest = lines.reduce((best, line) => {
    if (!line.id.startsWith(DRAFT_PREFIX)) return best;
    const suffix = Number(line.id.slice(DRAFT_PREFIX.length));
    return Number.isInteger(suffix) && suffix > best ? suffix : best;
  }, 0);
  return [...lines, { id: `${DRAFT_PREFIX}${highest + 1}`, axis, value }];
}
