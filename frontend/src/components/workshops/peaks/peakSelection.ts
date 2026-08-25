// Peaks workshop — per-table row selection (UX-R6 follow-up; closes the gap
// PR #228 documented in usePeaks.ts's RULING 7 comment: "Label peaks" always
// labeled EVERY peak because the table had no row selection to build on).
//
// Interaction contract mirrors the ONE other place this codebase already
// does multi-row selection — DatasetRow.tsx's `onRowClick` + its backing
// store actions (store/useApp.ts's `toggleSelected`/`selectRange`): a plain
// click SELECTS (replaces the selection with just this row), ctrl/cmd-click
// TOGGLES this row into/out of the selection, shift-click EXTENDS a
// contiguous range from the last anchor (the anchor itself doesn't move,
// same as `selectRange`). The one deliberate difference: this selection is
// LOCAL to one peak table (index-based), not the app-wide `selectedIds` —
// see this hook's home in PeaksPanel.tsx for why (a peak isn't a Library
// entity the store models; store/libraryPanel.ts's own header already
// argues against a third parallel selection array for exactly this reason).
//
// RULING 2 (reset-on-result-change — the highest-risk part of this lane): a
// `Peak`/`FittedPeak` carries no id, and /api/peaks/find + /api/peaks/fit-multi
// both hand back a brand-new, unordered-by-identity array every run — so an
// index that was "peak #2" before a re-fit or re-detect can silently become
// a DIFFERENT peak after, even when the array length is unchanged (nothing
// about the shape of the response ties a later run's peaks to an earlier
// run's). The only identity that reliably survives is the ARRAY INSTANCE
// itself: usePeaks.ts always constructs a fresh `peaks` array (`setPeaks`,
// on every find) or a fresh `fitResult` object (`setFitResult`, on every
// fit), and resets both to `[]`/`null` first on every dataset switch/
// reimport (its dataset-change effect). Keying the reset off REFERENCE
// EQUALITY of the `source` array — not its length or contents, which a
// same-length re-fit could preserve — clears stale indices exactly when a
// new find/fit/dataset-switch/reimport could have invalidated them, with no
// false negatives (a genuinely unrelated re-render never gets a new array).
//
// The reset happens SYNCHRONOUSLY DURING RENDER — not in a `useEffect` —
// per React's own "adjusting state when a prop changes" pattern
// (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
// A `useEffect`-based reset only runs AFTER commit, strictly later than the
// render that first saw the new `source`; a red-first repro (this lane's own
// evidence) forced exactly that gap: an immediate next click could land in
// the window between "peaks changed" committing and the deferred effect
// actually wiping the selection, resurrecting a stale index-to-peak mapping
// for one more interaction. Resetting IN the render that observes a new
// `source` closes that window completely — by the time this render commits,
// `selected` already reflects the new table, with no intermediate frame (or
// event) where a stale selection is live.
import { useCallback, useRef, useState } from "react";

/** Mouse/keyboard modifier state a row selection reads — shared shape for
 *  both `onClick` (MouseEvent) and `onKeyDown` (KeyboardEvent), which both
 *  carry `shiftKey`/`ctrlKey`/`metaKey`. */
export interface SelectMods {
  shift: boolean;
  ctrlOrMeta: boolean;
}

export interface PeakTableSelection {
  selected: ReadonlySet<number>;
  /** Apply one row's click/keyboard selection gesture per `mods` — see the
   *  module header for the click/ctrl/shift contract. */
  select: (index: number, mods: SelectMods) => void;
}

/** `source` is whatever array currently backs the table's rows (`peaks` or
 *  `fitResult.peaks`) — pass the SAME array reference the table renders
 *  from, and pass a stable empty-array constant when there's nothing yet
 *  (a fresh `[]` literal on every render would spuriously reset on every
 *  keystroke elsewhere in the panel).
 *
 *  `governs` (K1 review finding — the two peak tables are mutually
 *  exclusive as a LABELING source: "Label peaks" only ever reads ONE of
 *  them, whichever `hasFit` currently names, see PeaksPanel.tsx). Without
 *  this, the NON-governing table kept a stale selection alive: it stayed
 *  clickable and highlighted while every click silently did nothing to
 *  what Label actually used, and — the sharper bug — that stale pick could
 *  resurrect and become live again the moment governance flipped BACK (a
 *  fit that lands zero peaks, `fitResult.peaks = []`, hands governance
 *  straight back to the detected table with whatever it was showing
 *  before). Default `true` so a table that never receives this argument
 *  (e.g. a future standalone use) behaves exactly as before. */
export function usePeakTableSelection(source: readonly unknown[], governs = true): PeakTableSelection {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  // Tracked via useState (not a ref) so React's own render-time bailout
  // machinery drives the reset, exactly as the pattern above prescribes.
  const [prevSource, setPrevSource] = useState(source);
  const [prevGoverns, setPrevGoverns] = useState(governs);
  // The shift-range anchor — like `selectRange`'s `activeId`, extending a
  // range never moves it; only a plain click or a ctrl-toggle does. A plain
  // ref is safe to reset here even though this runs during render: it's
  // never read as part of THIS render's output, only later from `select`'s
  // event handlers, so mutating it can't make the render itself impure.
  const anchorRef = useRef<number | null>(null);

  const sourceChanged = source !== prevSource;
  // Reset on LOSING governance (true -> false), not on gaining it: a table
  // that just regained governance already had its selection cleared the
  // moment it lost governance, so there is nothing left to resurrect — and
  // clearing again on the gain edge would also wipe a selection a caller
  // legitimately set while `governs` was true from the very first render.
  const lostGovernance = prevGoverns && !governs;
  if (sourceChanged || lostGovernance) {
    setSelected(new Set());
    anchorRef.current = null;
  }
  if (sourceChanged) setPrevSource(source);
  if (governs !== prevGoverns) setPrevGoverns(governs);

  const select = useCallback((index: number, mods: SelectMods) => {
    if (mods.shift) {
      const anchor = anchorRef.current ?? index;
      const [lo, hi] = anchor <= index ? [anchor, index] : [index, anchor];
      const range = new Set<number>();
      for (let i = lo; i <= hi; i++) range.add(i);
      setSelected(range);
      // Anchor unchanged — matches store/useApp.ts's `selectRange` contract.
    } else if (mods.ctrlOrMeta) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      anchorRef.current = index;
    } else {
      setSelected(new Set([index]));
      anchorRef.current = index;
    }
  }, []);

  return { selected, select };
}
