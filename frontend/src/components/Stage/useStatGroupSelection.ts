// The Statistics stage's summary-table <-> row-selection link (P2.6 box 4):
// the React half of `statGroupSummary` — reads the app's ONE row selection
// (`store/rowState.selection`, honoured only while it names the dataset on
// the stage), turns table / plot gestures into `setRowSelection`, and puts
// the resulting marks onto the draws the canvas paints.
//
// The local pick (empty groups' selected state, see statGroupSummary's
// header) is DROPPED during render the moment the store's selection stops
// being the object the pick produced, or the axis it was made on is replaced
// (new picks, a dataset switch, an exclusion, a data edit) — React's
// "adjust state when a prop changes" pattern, as `peakSelection` uses, so no
// frame and no event ever sees a stale pick. Dropped rather than merely
// ignored: a selection that later returns to the same value (null again,
// after a worksheet brush and a clear) must not resurrect it.

import { useCallback, useMemo, useRef, useState } from "react";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import {
  applyGesture,
  buildGroupSummary,
  isPickLive,
  NO_PICK,
  selectedCount,
  selectionMarks,
  visibleSummaryRows,
  type GestureMods,
  type GroupPick,
  type GroupSummary,
  type PanelScope,
  type PickedKeys,
  type SummaryRow,
} from "./statGroupSummary";
import type { StatDrawData } from "./statRender";
import type { LevelAxes } from "./statStageLevels";
import type { FacetDraw } from "./useStatStageCompute";

const NO_ROWS: readonly number[] = [];

export interface StatGroupSelection {
  summary: GroupSummary | null;
  /** The table's rows, in axis order (the plot's visible slots). */
  visible: SummaryRow[];
  /** Per `visible` row, how many of its rows are selected. */
  counts: number[];
  /** `aria-selected` for a visible row: every row selected, or (an empty
   *  group) picked by the last gesture. */
  isSelected: (row: SummaryRow) => boolean;
  /** A table / plot gesture on the group `key`; `panel` scopes it to one
   *  facet panel's rows; `anchorHint` seeds a keyboard range. */
  select: (key: string, mods: GestureMods, panel?: string, anchorHint?: string) => void;
  clear: () => void;
  /** The draws with the selection marks attached (same objects when there is
   *  nothing to mark). */
  decorate: (draw: StatDrawData | null) => StatDrawData | null;
  decorateFacets: (facets: FacetDraw[] | null) => FacetDraw[] | null;
  /** Whether this dataset has anything of its own to clear — a live row
   *  selection, or a local empty-level pick (P2.6 review finding 3: the
   *  table's Escape must claim the key only when this is true, and must
   *  never wipe a selection belonging to another dataset). */
  hasSelection: boolean;
}

/** Whether `draw` paints a jittered raw-point overlay (box "points" / strip). */
function hasPointsOf(draw: StatDrawData): boolean {
  return (draw.mode === "box" && !!draw.points) || draw.mode === "strip";
}

/** Attaches the slot marks AND (P2.6 review finding 7) the raw selected-rows
 *  Set the box/strip point renderer checks DIRECTLY (`statRenderBox.
 *  drawJitteredPoints` reads `selectedRows`, never a copy riding inside
 *  `StatSelectionMarks`) — only when `marks` is non-null, so a draw with
 *  nothing marked on it (P2.6 review finding 4) stays the SAME object. */
function withMarks(
  draw: StatDrawData,
  marks: ReturnType<typeof selectionMarks>,
  selectedRows: ReadonlySet<number> | null,
): StatDrawData {
  if (draw.mode === "qq" || draw.mode === "histogram") return draw;
  return marks ? { ...draw, selection: marks, selectedRows: marks.ringPoints ? selectedRows : null } : draw;
}

export function useStatGroupSelection(
  active: Dataset | null,
  axes: LevelAxes | null,
  hideEmpty: boolean,
  /** Gates the table's mean/SD/median/min/max pass (P2.6 review finding 6):
   *  the plot link below needs only `.rows`/`.key`/`.n`, so a caller whose
   *  table is closed can default this false. Defaults true so every existing
   *  caller (and test) keeps computing stats unless it opts out. */
  tableOpen = true,
): StatGroupSelection {
  const selection = useApp((s) => s.selection);
  const setRowSelection = useApp((s) => s.setRowSelection);
  const clearRowSelection = useApp((s) => s.clearRowSelection);

  const summary = useMemo(
    () => (active && axes ? buildGroupSummary(active, axes, tableOpen) : null),
    [active, axes, tableOpen],
  );
  const visible = useMemo(() => (summary ? visibleSummaryRows(summary, hideEmpty) : []), [summary, hideEmpty]);
  const byKey = useMemo(() => new Map(visible.map((r) => [r.key, r] as const)), [visible]);
  const liveRows = active && selection?.datasetId === active.id ? selection.rows : NO_ROWS;
  const selected = useMemo(() => new Set(liveRows), [liveRows]);

  const [pick, setPick] = useState<GroupPick | null>(null);
  const anchor = useRef<string | null>(null);
  // The range anchor is seeded from a key of THIS `summary` (`byKey`), so a
  // stale one from a previous dataset/groupCol/mode must never survive a
  // summary-identity change (P2.6 review finding 2) — reset it here, in the
  // same "adjust state during render" pattern the pick-drop check below uses.
  const prevSummary = useRef<GroupSummary | null>(null);
  if (prevSummary.current !== summary) {
    prevSummary.current = summary;
    anchor.current = null;
  }
  const pickLive = isPickLive(pick, selection, summary);
  if (pick && !pickLive) {
    setPick(null);
    anchor.current = null;
  }
  const picked: PickedKeys = pickLive ? (pick as GroupPick) : NO_PICK;

  const counts = useMemo(() => visible.map((r) => selectedCount(r, selected)), [visible, selected]);
  const countOf = useMemo(() => new Map(visible.map((r, i) => [r.key, counts[i]] as const)), [visible, counts]);

  // P2.6 review finding 5: `axes.panelRows` already split each flat slot's
  // rows per panel ONCE (in `levelAxes`) — this is a lookup, not a
  // per-gesture/per-render facet-column walk.
  const panelScope = useCallback(
    (panel: string | undefined): PanelScope | undefined | null => {
      if (panel === undefined) return undefined;
      return axes?.panelRows?.get(panel) ?? null;
    },
    [axes],
  );

  const select = useCallback(
    (key: string, mods: GestureMods, panel?: string, anchorHint?: string) => {
      const scope = panelScope(panel);
      if (!summary || scope === null) return;
      const pickPanel = panel ?? null;
      // The range anchor: the last plain / toggle gesture's group while it is
      // still on the table, else the keyboard's starting row. A range never
      // moves it; anything else (or a range with no usable anchor, which
      // `applyGesture` treats as a plain pick) re-seats it.
      const known = (k: string | null | undefined): k is string => k != null && byKey.has(k);
      const from = known(anchor.current) ? anchor.current : known(anchorHint) ? anchorHint : null;
      const g = applyGesture(visible, key, mods, from, liveRows, picked, pickPanel, scope);
      if (!g) return;
      anchor.current = mods.range && from != null ? from : key;
      setRowSelection(g.rows);
      setPick({ keys: new Set(g.keys), panel: pickPanel, basis: useApp.getState().selection, summary });
    },
    [summary, visible, byKey, liveRows, picked, panelScope, setRowSelection],
  );

  const clear = useCallback(() => {
    anchor.current = null;
    clearRowSelection();
    setPick(null);
  }, [clearRowSelection]);

  const isSelected = useCallback(
    (row: SummaryRow) => (row.n > 0 ? countOf.get(row.key) === row.n : picked.panel === null && picked.keys.has(row.key)),
    [countOf, picked],
  );

  const hasSelection = selected.size > 0 || picked.keys.size > 0;
  const decorate = useCallback(
    (draw: StatDrawData | null): StatDrawData | null => {
      if (!draw || !hasSelection || !active) return draw;
      // Points carry ORIGINAL dataset rows (`IndexedPoint.rowIndex`, via
      // `resolveGroupsIndexed`'s `rowIds`), the selection's own index space —
      // so the rings are the selection itself, no translation. The renderer
      // reads `selected` DIRECTLY (`withMarks` attaches it as `selectedRows`
      // only when something is actually marked); `selectionMarks` itself no
      // longer takes a `points` argument (P2.6 review finding 4/7).
      const slots = "slots" in draw ? draw.slots : null;
      return withMarks(draw, selectionMarks(slots, byKey, selected, picked), hasPointsOf(draw) ? selected : null);
    },
    [hasSelection, active, byKey, selected, picked],
  );

  const decorateFacets = useCallback(
    (facets: FacetDraw[] | null): FacetDraw[] | null => {
      if (!facets || !hasSelection) return facets;
      return facets.map((f) => {
        const scope = panelScope(f.label);
        const slots = "slots" in f.draw ? f.draw.slots : null;
        if (!scope) return f;
        // P2.6 review finding 7: ring this panel's own selected points too.
        // Its points carry ORIGINAL rows like the flat draw's (a facet
        // slice's `FacetSlice.rows` composed with `analysisRowIds`, via
        // `lib/facet.facetSliceRowIds`), and hold only this panel's rows —
        // so the whole selection rings exactly them.
        const marks = selectionMarks(slots, byKey, selected, picked, f.label, scope);
        return { ...f, draw: withMarks(f.draw, marks, hasPointsOf(f.draw) ? selected : null) };
      });
    },
    [hasSelection, panelScope, byKey, selected, picked],
  );

  return { summary, visible, counts, isSelected, select, clear, decorate, decorateFacets, hasSelection };
}
